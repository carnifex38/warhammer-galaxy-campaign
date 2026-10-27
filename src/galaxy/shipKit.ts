import * as THREE from 'three'
import { lighten, teamsNow } from '../teams'

// The pieces the battle ships and the patrol ships share: the two teams' colours, the three ship classes, the glow textures, and the
// ship itself (a gothic hull of stepped boxes with a spire and gun decks, and a separate set of glowing windows).

export type Team = 'A' | 'B'
export type Class = 'flagship' | 'cruiser' | 'escort'

// the glow of a team's ships: its colour, a little lighter (the host chooses the colours, see teams.ts)
const glows = new Map<string, THREE.Color>()
const glowOf = (team: Team) => {
  const hex = lighten(teamsNow()[team].color, 0.3)
  let c = glows.get(hex)
  if (!c) { c = new THREE.Color(hex); glows.set(hex, c) }
  return c
}
export const TEAM_COLOR = { get A() { return glowOf('A') }, get B() { return glowOf('B') } }
export const HULL_TINT = { A: new THREE.Color('#aab6c8'), B: new THREE.Color('#c8b09a') }
export const CLASSES: Record<Class, { scale: number; hp: number; volley: number; vmax: number; turn: number; range: number; radius: number }> = {
  // volley: seconds between volleys; vmax: top speed; turn: how fast it can turn (rad/s); range: where it likes to fight; radius: its size, for keeping clear
  flagship: { scale: 0.11, hp: 26, volley: 4.2, vmax: 0.14, turn: 0.22, range: 2.4, radius: 0.25 },
  cruiser: { scale: 0.08, hp: 15, volley: 3.4, vmax: 0.18, turn: 0.34, range: 1.7, radius: 0.18 },
  escort: { scale: 0.05, hp: 8, volley: 2.6, vmax: 0.26, turn: 0.6, range: 1.3, radius: 0.11 },
}

let glowCache: THREE.CanvasTexture | null = null
/** The soft round glow used for engines, bolts, flashes and haze. Built once and shared by every battle and patrol (so never disposed by them). */
export function glowTexture() {
  return (glowCache ??= makeGlowTexture())
}

function makeGlowTexture() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(cv)
}

let ringCache: THREE.CanvasTexture | null = null
/** The thin bright ring of a warp rift. Built once and shared. */
export function ringTexture() {
  return (ringCache ??= makeRingTexture())
}

function makeRingTexture() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 18, 64, 64, 62)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.85, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(cv)
}

// ---------- the ship: a gothic hull of stepped boxes, a spire and gun decks (bow along +Z) ----------

interface Part { g: THREE.BufferGeometry; color: [number, number, number] }

function merge(parts: Part[]) {
  const pos: number[] = []
  const nor: number[] = []
  const col: number[] = []
  for (const { g, color } of parts) {
    const ng = g.index ? g.toNonIndexed() : g
    const p = ng.attributes.position.array as Float32Array
    const n = ng.attributes.normal.array as Float32Array
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]) }
    for (let i = 0; i < p.length / 3; i++) col.push(...color)
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return out
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
const cone = (r: number, h: number, segs: number, rx: number, x: number, y: number, z: number, flat = 1) => {
  const g = new THREE.ConeGeometry(r, h, segs, 1)
  g.rotateX(rx)
  g.rotateZ(Math.PI / 4)
  g.scale(1, flat, 1)
  return g.translate(x, y, z)
}

let hullCache: THREE.BufferGeometry | null = null
/** The ship's hull. Built once and shared. */
export function hullGeometry() {
  return (hullCache ??= makeHullGeometry())
}

function makeHullGeometry() {
  const dark: [number, number, number] = [0.3, 0.26, 0.23]
  const mid: [number, number, number] = [0.42, 0.36, 0.3]
  const gold: [number, number, number] = [0.62, 0.48, 0.24]
  const parts: Part[] = [
    { g: box(0.8, 0.42, 2.4, 0, 0, -0.1), color: dark },
    { g: cone(0.5, 1.1, 4, Math.PI / 2, 0, 0, 1.65, 0.8), color: mid },
    { g: new THREE.CylinderGeometry(0.05, 0.08, 0.7, 6).rotateX(Math.PI / 2).translate(0, 0, 2.3), color: gold },
    { g: box(0.9, 0.5, 0.5, 0, 0, -1.45), color: mid },
    { g: box(0.22, 0.2, 0.2, 0, 0, -1.75), color: dark },
    { g: box(0.22, 0.2, 0.2, 0.28, 0, -1.75), color: dark },
    { g: box(0.22, 0.2, 0.2, -0.28, 0, -1.75), color: dark },
    { g: box(0.58, 0.24, 1.2, 0, 0.32, -0.3), color: mid },
    { g: box(0.4, 0.22, 0.75, 0, 0.55, -0.5), color: dark },
    { g: new THREE.ConeGeometry(0.13, 0.95, 5).translate(0, 1.1, -0.5), color: gold },
    { g: new THREE.ConeGeometry(0.06, 0.5, 5).translate(0, 0.9, 0.2), color: gold },
    { g: box(0.14, 0.5, 0.14, 0.3, 0.42, 0.05), color: mid },
    { g: box(0.14, 0.5, 0.14, -0.3, 0.42, 0.05), color: mid },
    { g: box(0.14, 0.22, 1.9, 0.47, 0, -0.1), color: mid },
    { g: box(0.14, 0.22, 1.9, -0.47, 0, -0.1), color: mid },
  ]
  for (const z of [0.7, 0.2, -0.3, -0.8]) for (const s of [-1, 1]) parts.push({ g: box(0.2, 0.1, 0.22, 0.33 * s, 0.26, z), color: dark })
  return merge(parts)
}

/** The glowing windows and gun-deck lights (white, so the instance colour sets each team's glow). */
let windowCache: THREE.BufferGeometry | null = null
/** The ship's glowing windows. Built once and shared. */
export function windowGeometry() {
  return (windowCache ??= makeWindowGeometry())
}

function makeWindowGeometry() {
  const w: [number, number, number] = [1, 1, 1]
  const parts: Part[] = []
  for (const s of [-1, 1]) {
    parts.push({ g: box(0.02, 0.035, 1.7, 0.545 * s, 0.05, -0.1), color: w })
    parts.push({ g: box(0.02, 0.035, 1.7, 0.545 * s, -0.05, -0.1), color: w })
    parts.push({ g: box(0.02, 0.03, 0.9, 0.41 * s, 0.34, -0.3), color: w })
  }
  parts.push({ g: box(0.3, 0.025, 0.5, 0, 0.67, -0.5), color: w })
  parts.push({ g: box(0.3, 0.025, 0.35, 0, 0.2, 1.0), color: w })
  return merge(parts)
}
