import { useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { ATMO_FRAG, ATMO_VERT, PLANET_RADIUS, fragmentFor, makePlanetUniforms } from './galaxy/PlanetBody'
import { isHulkName } from './galaxy/data'
import { PLANET_VERT } from './galaxy/planetShaders'
import { lookFor, lookNameFor, seedFor, type Era } from './galaxy/planetLooks'

// Planet portraits for the calendar: a small picture of the real planet, drawn once with the same look the galaxy uses (in a hidden
// graphics context, one planet at a time, when the calendar needs it) and remembered in this browser, so the next visit shows it at
// once. Worlds that are not round (the Rock, a shattered or burst world, a space hulk) get a painted wreck instead. Until a
// portrait is ready the calendar shows a plain disc in the planet's colours.

const SIZE = 144
const CACHE_KEY = 'galaxy-portraits-v1'
const BACKGROUND = '#070a14'

const pictures = new Map<string, string>()
const wanted = new Set<string>()
const listeners = new Set<() => void>()
let version = 0
let busy = false

try {
  const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, string>
  for (const [k, v] of Object.entries(saved)) if (typeof v === 'string' && v.startsWith('data:image/')) pictures.set(k, v)
} catch { /* nothing remembered */ }

let saveTimer: ReturnType<typeof setTimeout> | undefined
/** Saves the finished portraits: once, a moment after the last one is drawn, not after every picture. */
function remember() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(pictures))) } catch { /* too big or private mode: just not remembered */ }
  }, 600)
}

const keyOf = (name: string, era: Era) => `${name}|${era}`

// ---------- round worlds: drawn with the planet's own shader ----------

let drawing: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; sphere: THREE.Mesh; atmo: THREE.Mesh } | null = null

function setup() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(SIZE, SIZE, false)
  renderer.setClearColor(BACKGROUND, 1)
  const scene = new THREE.Scene()
  const half = PLANET_RADIUS * 1.28
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 10)
  camera.position.set(0, 0, 3)
  const geometry = new THREE.SphereGeometry(PLANET_RADIUS, 96, 64)
  const sphere = new THREE.Mesh(geometry)
  const atmo = new THREE.Mesh(geometry)
  atmo.scale.setScalar(1.17)
  scene.add(sphere, atmo)
  return { renderer, scene, camera, sphere, atmo }
}

async function drawRound(name: string, era: Era): Promise<string> {
  drawing ??= setup()
  const { renderer, scene, camera, sphere, atmo } = drawing
  const look = lookFor(name, era)
  const uniforms = makePlanetUniforms(name, era)
  uniforms.uArrive = { value: 1 }
  // turned a little differently for each planet, so two with the same look show different faces
  sphere.rotation.set(0, 0.5 + (seedFor(name) % 6) * 0.6, 0)
  sphere.updateMatrixWorld()
  uniforms.uModelRot.value.setFromMatrix4(sphere.matrixWorld)
  const surface = new THREE.ShaderMaterial({ uniforms, vertexShader: PLANET_VERT, fragmentShader: fragmentFor(look.hero), transparent: true })
  const haze = new THREE.ShaderMaterial({
    uniforms: { uAtmo: { value: new THREE.Color(look.atmo) }, uStrength: { value: look.atmoStrength * (look.hero > 0 ? 0.5 : 0.3) }, uArrive: { value: 1 } },
    vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
  })
  sphere.material = surface
  atmo.material = haze
  try { await renderer.compileAsync(scene, camera) } catch { /* it compiles when drawn instead */ }
  renderer.render(scene, camera)
  if (renderer.getContext().isContextLost()) { drawing = null; throw new Error('the graphics were lost') }
  const url = renderer.domElement.toDataURL('image/jpeg', 0.88)
  surface.dispose()
  haze.dispose()
  return url
}

// ---------- worlds that are not round: a painted wreck ----------

function drawWreck(name: string): string {
  const cv = document.createElement('canvas')
  cv.width = cv.height = SIZE
  const c = cv.getContext('2d')!
  c.fillStyle = BACKGROUND
  c.fillRect(0, 0, SIZE, SIZE)
  const glow = c.createRadialGradient(SIZE / 2, SIZE / 2, 4, SIZE / 2, SIZE / 2, SIZE / 2)
  glow.addColorStop(0, 'rgba(255,150,70,0.55)')
  glow.addColorStop(0.35, 'rgba(160,80,40,0.25)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = glow
  c.fillRect(0, 0, SIZE, SIZE)
  let h = Math.floor(seedFor(name) * 1000)
  const rnd = () => { h = (Math.imul(h, 1103515245) + 12345) & 0x7fffffff; return h / 0x7fffffff }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2
    const r = 14 + rnd() * 52
    const x = SIZE / 2 + Math.cos(a) * r
    const y = SIZE / 2 + Math.sin(a) * r * 0.8
    const s = 2 + rnd() * (i < 5 ? 10 : 4)
    c.fillStyle = `rgb(${70 + rnd() * 60},${52 + rnd() * 36},${42 + rnd() * 26})`
    c.beginPath()
    for (let k = 0; k < 6; k++) {
      const t = (k / 6) * Math.PI * 2
      const rr = s * (0.6 + rnd() * 0.6)
      c.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr)
    }
    c.closePath()
    c.fill()
  }
  return cv.toDataURL('image/jpeg', 0.88)
}

// ---------- the queue ----------

async function next() {
  if (busy) return
  const key = [...wanted].find((k) => !pictures.has(k))
  if (!key) return
  busy = true
  wanted.delete(key)
  const [name, era] = key.split('|') as [string, Era]
  let url: string | null = null
  try {
    const kind = lookNameFor(name, era)
    url = isHulkName(name) || kind === 'rock' || kind === 'shattered' || kind === 'exploded' ? drawWreck(name) : await drawRound(name, era)
  } catch { /* no graphics: the calendar keeps its plain disc */ }
  if (url) {
    pictures.set(key, url)
    remember()
    version++
    listeners.forEach((l) => l())
  }
  busy = false
  if (wanted.size) setTimeout(() => void next(), 30) // one planet at a time, a breath between, so the page never freezes
  else setTimeout(() => { if (!busy && !wanted.size) { drawing?.renderer.dispose(); drawing?.renderer.forceContextLoss(); drawing = null } }, 8000) // give the graphics context back when idle
}

/** The portrait of a planet (a picture URL), or null while it is still being drawn. Asking for one starts drawing it. */
export function usePortrait(name: string, era: Era): string | null {
  const key = keyOf(name, era)
  useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => version,
  )
  const have = pictures.get(key) ?? null
  if (!have && !wanted.has(key)) {
    wanted.add(key)
    setTimeout(() => void next(), 0)
  }
  return have
}
