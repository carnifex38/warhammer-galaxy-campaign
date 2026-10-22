import type * as THREE from 'three'
import { useSyncExternalStore } from 'react'
import { PlanetBake, SIZE_HIGH, SIZE_LOW, canBake, type BakedSurface } from './planetBake'

// Keeps every planet's baked surface, in two sizes:
//   - the SOFT one (512x256, about 4 MB) is baked for every planet quietly in the background, only while the player is not busy
//     moving around, and stays for good, so any planet you pick already has a surface to show;
//   - the SHARP one (1024x512, about 16 MB) is baked when you pick a planet and swaps in as soon as it is done. The last few
//     sharp ones are kept so going back to a planet is instant; older ones are freed.
// One band of one planet is drawn per frame at most, so nothing ever freezes (see planetBake.ts).

type Uniforms = Record<string, { value: unknown }>

interface Config {
  makeUniforms: (name: string, era: string) => Uniforms
  heroOf: (name: string, era: string) => number
}

interface Entry {
  key: string
  name: string
  era: string
  low: PlanetBake | null // finished soft bake
  high: PlanetBake | null // finished sharp bake
  wanted: number // how many planet views are showing this one right now
}

interface Job { entry: Entry; level: 'low' | 'high'; bake: PlanetBake; compiled: boolean; priority: boolean }

const KEEP_HIGH = 3
const PRIORITY_BUDGET_MS = 24

let config: Config | null = null
let gl: THREE.WebGLRenderer | null = null
let prebakeOn = false
let prebakeOrder: string[] = []
let current: Job | null = null
let lastBusy = -1e9
const entries = new Map<string, Entry>()
const highOrder: string[] = [] // oldest first
const listeners = new Set<() => void>()
const bump = () => {
  listeners.forEach((l) => l())
  // dev only: a look at what is baked, from the console (`__surf`)
  if (import.meta.env.DEV) {
    const all = [...entries.values()]
    ;(window as unknown as { __surf: unknown }).__surf = { entries: all.length, soft: all.filter((e) => e.low).length, sharp: all.filter((e) => e.high).length, wanted: all.filter((e) => e.wanted > 0).map((e) => e.key) }
  }
}

export const surfaceKey = (name: string, era: string) => `${name}|${era}`

export function configureSurfaces(c: Config) {
  config = c
}

let busyHooked = false

/**
 * Called when a renderer exists. If it is a NEW one (the galaxy view was closed, for example by switching to the Host tab, and opened
 * again, which makes a new canvas), everything baked for the old one is gone with its graphics memory: forget it, keep who is
 * waiting for what, and bake again. Also starts noticing when the player is moving around, so background baking can wait.
 */
export function attachSurfaces(renderer: THREE.WebGLRenderer) {
  if (gl === renderer) return
  if (gl) {
    current = null
    highOrder.length = 0
    for (const e of entries.values()) { e.low = null; e.high = null }
    bump()
  }
  gl = renderer
  if (busyHooked) return
  busyHooked = true
  const busy = () => { lastBusy = performance.now() }
  for (const ev of ['pointermove', 'wheel', 'pointerdown', 'touchmove', 'keydown']) addEventListener(ev, busy, { passive: true })
}

const entryFor = (name: string, era: string): Entry => {
  const key = surfaceKey(name, era)
  let e = entries.get(key)
  if (!e) { e = { key, name, era, low: null, high: null, wanted: 0 }; entries.set(key, e) }
  return e
}

/** The best surface there is for this planet right now (sharp, else soft, else none yet). */
function bestOf(key: string): BakedSurface | null {
  const e = entries.get(key)
  return e?.high?.surface ?? e?.low?.surface ?? null
}

/** A planet view asks for its surface. The soft one is made first if it is not there yet, then the sharp one. */
export function wantSurface(name: string, era: string): () => void {
  const e = entryFor(name, era)
  e.wanted++
  bump()
  return () => {
    e.wanted = Math.max(0, e.wanted - 1)
    if (e.wanted === 0 && current && current.entry === e && current.priority) dropCurrent() // nobody is waiting for it any more
  }
}

/** The surface to draw this planet with; re-renders the planet when a better one arrives. */
export function useSurface(name: string, era: string): BakedSurface | null {
  const key = surfaceKey(name, era)
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => bestOf(key),
  )
}

/** Which planets to bake softly in the background (in this order). Planets not listed lose their soft surface, to free memory. */
export function setPrebake(list: { name: string; era: string }[]) {
  const keep = new Set<string>()
  prebakeOrder = []
  for (const p of list) { const e = entryFor(p.name, p.era); keep.add(e.key); prebakeOrder.push(e.key) }
  for (const [k, e] of entries) {
    if (keep.has(k) || e.wanted > 0) continue
    free(e)
    entries.delete(k)
  }
  bump()
}

/** For the stutter panel: what is baked, what the picked planet is showing, and what is being baked right now. */
export function describeSurfaces(): string {
  const all = [...entries.values()]
  const shown = all.filter((e) => e.wanted > 0).map((e) => `${e.name}:${e.high ? 'sharp' : e.low ? 'soft' : 'none'}`).join(',') || '-'
  const job = current ? `${current.entry.name} ${current.level}${current.compiled ? '' : ' (compiling)'}` : '-'
  return `baked ${all.filter((e) => e.low).length}/${all.length} soft, ${all.filter((e) => e.high).length} sharp | showing ${shown} | job ${job} | prebake ${prebakeOn ? 'on' : 'off'}`
}

export function setPrebakeAllowed(on: boolean) {
  prebakeOn = on
}

function free(e: Entry) {
  for (const b of [e.low, e.high]) { b?.disposeSurface(); b?.disposeWork() }
  e.low = e.high = null
  const i = highOrder.indexOf(e.key)
  if (i >= 0) highOrder.splice(i, 1)
}

function dropCurrent() {
  if (!current) return
  current.bake.disposeSurface()
  current.bake.disposeWork()
  current = null
}

/** What to bake next: what a planet view is waiting for first, then (if the player is idle) the background list. */
function pickNext(idle: boolean): { entry: Entry; level: 'low' | 'high'; priority: boolean } | null {
  for (const e of entries.values()) {
    if (e.wanted > 0) {
      if (!e.low) return { entry: e, level: 'low', priority: true }
      if (!e.high) return { entry: e, level: 'high', priority: true }
    }
  }
  if (prebakeOn && idle) {
    for (const k of prebakeOrder) {
      const e = entries.get(k)
      if (e && !e.low) return { entry: e, level: 'low', priority: false }
    }
  }
  return null
}

/** Called every frame (from inside the 3D scene): do one small band of baking, or start/finish a job. */
export function tickSurfaces() {
  if (!gl || !config || !canBake(gl)) return
  const idle = performance.now() - lastBusy > 250

  // a planet view is waiting but a background job is running: drop the background one (it is small, and soon redone)
  if (current && !current.priority && pickNext(false)?.priority) dropCurrent()
  // a sharp bake nobody wants any more
  if (current && current.level === 'high' && current.entry.wanted === 0) dropCurrent()

  if (!current) {
    const next = pickNext(idle)
    if (!next) return
    const bake = new PlanetBake(gl, config.makeUniforms(next.entry.name, next.entry.era), config.heroOf(next.entry.name, next.entry.era), next.level === 'low' ? SIZE_LOW : SIZE_HIGH)
    const job: Job = { ...next, bake, compiled: false }
    current = job
    void (async () => {
      try { await bake.compile() } catch { /* it will compile when first drawn instead */ }
      job.compiled = true
    })()
    return
  }

  const job = current
  if (!job.compiled) return
  if (!job.priority && !idle) return // background work waits while the player is busy
  // a planet someone is waiting for gets a few bands per frame (about 24 ms), so it is ready in a handful of frames even when the
  // page runs slowly; background work stays at one small band per frame
  const t0 = performance.now()
  do job.bake.step()
  while (job.priority && !job.bake.done && performance.now() - t0 < PRIORITY_BUDGET_MS)
  if (!job.bake.done) return

  current = null
  const e = job.entry
  if (job.level === 'low') e.low = job.bake
  else {
    e.high = job.bake
    highOrder.push(e.key)
    // free the oldest sharp surfaces nobody is showing
    for (let i = 0; i < highOrder.length && highOrder.length > KEEP_HIGH; ) {
      const old = entries.get(highOrder[i])
      if (old && old.wanted === 0 && old !== e) { old.high?.disposeSurface(); old.high?.disposeWork(); old.high = null; highOrder.splice(i, 1) } else i++
    }
  }
  bump()
}

