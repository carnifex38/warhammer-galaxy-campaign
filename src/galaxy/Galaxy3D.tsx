import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { sliced } from '../idle'
import { PlanetBackdrop, backdropLevel } from './PlanetBackdrop'
import { ZoneReticle } from './ZoneReticle'
import { VoidShields, type PlanetShieldInfo, type ShieldZone } from './VoidShields'
import PlanetBody, { PLANET_RADIUS, WARMUP_PLANETS, arriveFade, createWarmupMaterial, isBakedWorld, markShaderReady, warmBake } from './PlanetBody'
import { canBake } from './planetBake'
import { attachSurfaces, setPrebake, setPrebakeAllowed, tickSurfaces } from './planetSurfaces'
import { setLoad, useLoad } from './loading'
import { HulkMarker } from './SpaceHulk'
import { lookNameFor, type Era } from './planetLooks'
import { GALAXY_BOX, bbox, isHulkId, openCount, sectorCenter, toWorld, type Planet, type Sector } from './data'

export interface PlanetInfo { enabled: boolean; open: number; total: number; zonesHidden?: boolean }

interface Props {
  sectorId: string | null
  planetId: string | null
  onSelectSector: (id: string) => void
  onSelectPlanet: (sectorId: string, planetId: string) => void
  /** Go back to the whole-galaxy view. */
  onClear: () => void
  /** A sector / planet the user is pointing at in the side list; highlighted in 3D. */
  hoverSectorId: string | null
  hoverPlanetId: string | null
  /** The battlezone being pointed at (or open) on the selected planet: a targeting reticle settles on its spot. */
  hoverZone?: { id: string; name: string; live?: boolean } | null
  /** The battlezones of the selected planet that are in play: each keeps a reticle and explosions on its spot. */
  playZones?: { id: string; name: string }[]
  /** Battlezones of the selected planet that a team has captured: each gets a void shield. `shieldTotal`: how many battlezones it has. */
  shieldZones?: ShieldZone[]
  shieldTotal?: number
  /** A team holds most of the selected planet's battlezones: a shield covers the whole planet. */
  shieldMajority?: PlanetShieldInfo | null
  /** 40K (Dark Imperium) or 30K (Horus Heresy). */
  era: Era
  /** The host's setup for every planet: in play or closed, and its table counts. */
  planetInfo: Record<string, PlanetInfo>
  /** The sectors as this event has them (including the Space Hulk where the host put it). */
  sectors: Sector[]
  /** Sectors players cannot enter: drawn as dark swirling dust, their planets hidden. */
  lockedSectors?: string[]
  /** Pixels at the left of the map covered by the information window: the view glides sideways to keep its subject in the clear area. */
  viewInset?: number
  /** Extra controls drawn over the map. */
  children?: ReactNode
}

/** Height above the galaxy plane at which a selected planet floats. */
const PLANET_FOCUS_Y = 0.65
/** A click only counts if the pointer moved less than this many pixels; anything more was a drag (rotating the view). */
const DRAG_PX = 6
const FOV = 50
const TAN_HALF_FOV = Math.tan((FOV / 2) * (Math.PI / 180))
const VIEW_DIR = new THREE.Vector3(0, 0.66, 0.75).normalize() // camera sits above and to the south of its target

/** Camera pose that fits a ground-plane box on screen, whatever the screen shape. */
function frame(box: { x: number; z: number; w: number; h: number }, aspect: number, minDist = 5) {
  const cx = box.x + box.w / 2
  const cz = box.z + box.h / 2
  const d = Math.max(minDist, (Math.max(box.w / aspect, box.h * 1.15) * 1.22) / 2 / TAN_HALF_FOV)
  const target = new THREE.Vector3(cx, 0, cz)
  return { target, position: target.clone().addScaledVector(VIEW_DIR, d) }
}

// ---------- procedural background ----------

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Map 5 pixel path of the Great Rift (Cicatrix Maledictum): from the Eye of Terror, north of Terra, through the core and east. */
const RIFT_PX: [number, number][] = [
  [565, 575], [650, 562], [727, 555], [840, 575], [949, 610], [1097, 670], [1190, 765], [1319, 886], [1485, 905], [1633, 979], [1730, 1075],
]

function riftCurve() {
  return new THREE.CatmullRomCurve3(
    RIFT_PX.map(([px, py]) => {
      const w = toWorld(px, py)
      return new THREE.Vector3(w.x, 0, w.z)
    }),
  )
}

/** Half-width of the rift at position u (0..1) along its length: narrow at the ends, widest mid-galaxy. */
const riftHalfWidth = (u: number) => 0.35 + 1.6 * Math.pow(Math.sin(Math.PI * u), 0.7)

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/** Galactic haze: a wide disc covering the whole playable galaxy. */
const HAZE = { cx: -1.5, radius: 16 }

/** Warp storms (map 5 pixel position, diameter in world units). Positions of storms not on map 5 were converted from the Imperium Nihilus map. */
const STORMS = [
  { name: 'Eye of Terror', px: 565, py: 575, size: 4.6, eras: ['40k', '30k'] },
  { name: "Storm of the Emperor's Wrath", px: 1079, py: 272, size: 3.6, eras: ['40k'] },
  { name: 'Malfactus', px: 1597, py: 109, size: 3.2, eras: ['40k'] },
  { name: 'Somnium Stars', px: 1764, py: 525, size: 3.4, eras: ['40k'] },
  { name: 'The Maelstrom', px: 1050, py: 835, size: 4.2, eras: ['40k', '30k'] },
  { name: "Siren's Storm", px: 885, py: 1108, size: 3.4, eras: ['40k'] },
  { name: 'The Scourge Stars', px: 1653, py: 1163, size: 3.2, eras: ['40k'] },
  { name: 'Hadex Anomaly', px: 1730, py: 1075, size: 2.8, eras: ['40k'] },
] satisfies { name: string; px: number; py: number; size: number; eras: Era[] }[]

/**
 * Brightness multiplier for a star at (x, z): nearly dark inside a tear or storm, back to full just outside it.
 * It compares squared distances and takes one square root at the end, which gives the same answer as before at a
 * fraction of the cost (tens of thousands of stars ask this question).
 */
function makeTearFactor(era: Era) {
  const curve = riftCurve()
  const xs: number[] = []
  const zs: number[] = []
  const inv2: number[] = [] // 1 / (size of the tear there)^2
  // the Great Rift only exists in the 41st millennium
  if (era === '40k') {
    for (let i = 0; i <= 160; i++) {
      const u = i / 160
      const p = curve.getPoint(u)
      const w = riftHalfWidth(u)
      xs.push(p.x)
      zs.push(p.z)
      inv2.push(1 / (w * w))
    }
  }
  for (const st of STORMS) {
    if (!(st.eras as Era[]).includes(era)) continue
    const w = toWorld(st.px, st.py)
    const r = st.size * 0.4
    xs.push(w.x)
    zs.push(w.z)
    inv2.push(1 / (r * r))
  }
  const n = xs.length
  return (x: number, z: number) => {
    let best = Infinity
    for (let k = 0; k < n; k++) {
      const dx = x - xs[k]
      const dz = z - zs[k]
      const d = (dx * dx + dz * dz) * inv2[k]
      if (d < best) best = d
    }
    return 0.12 + 0.88 * smooth(0.3, 0.95, Math.sqrt(best))
  }
}

interface StarData { positions: Float32Array; colors: Float32Array }

const starCache = new Map<Era, Promise<StarData>>()

/** The star field for an era. Built once, in small slices that never block a frame, and remembered. */
export function prepareStars(era: Era): Promise<StarData> {
  let p = starCache.get(era)
  if (!p) {
    p = buildStars(era)
    starCache.set(era, p)
  }
  return p
}

async function buildStars(era: Era): Promise<StarData> {
  const rand = rng(40000)
  const gauss = () => (rand() + rand() + rand() + rand() - 2) / 2
  const HAZE_N = 14000, ARM_N = 16000, BULGE_N = 5500, HALO_N = 2500
  const N = HAZE_N + ARM_N + BULGE_N + HALO_N
  const positions = new Float32Array(N * 3)
  const colors = new Float32Array(N * 3)
  const c = new THREE.Color()
  let n = 0

  const tearFactor = makeTearFactor(era)

  const put = (x: number, y: number, z: number, col: THREE.Color, b: number) => {
    const k = b * tearFactor(x, z)
    const i = n * 3
    positions[i] = x
    positions[i + 1] = y
    positions[i + 2] = z
    colors[i] = col.r * k
    colors[i + 1] = col.g * k
    colors[i + 2] = col.b * k
    n++
  }

  // 1. wide hazy disc covering the whole map, brightest toward the core
  const haze = new THREE.Color('#6f7bb8')
  const core = new THREE.Color('#ffd98a')
  await sliced(HAZE_N, () => {
    const r = Math.pow(rand(), 0.8)
    const a = rand() * Math.PI * 2
    const x = HAZE.cx + HAZE.radius * r * Math.cos(a)
    const z = HAZE.radius * r * Math.sin(a)
    c.copy(core).lerp(haze, Math.min(1, Math.hypot(x, z) / 10))
    // brightness eases to nothing at the rim, and the disc thins out there too
    const thick = 0.22 + 1.1 * Math.exp(-Math.hypot(x, z) / 3.5) // the disc is much thicker near the core
    put(x, gauss() * thick, z, c, (0.4 + rand() * 0.55) * (1 - smooth(0.6, 1.02, r)))
  })

  // 2. two bright spiral arms wound around the core
  const armA = new THREE.Color('#ffe9b8')
  const armB = new THREE.Color('#c58cff')
  await sliced(ARM_N, (i) => {
    const t = Math.pow(rand(), 0.8)
    const r = 0.5 + 11.5 * t
    const a = (i % 2) * Math.PI + t * 4.8
    const spread = 0.55 + t * 1.7
    const x = r * Math.cos(a) + gauss() * spread
    const z = r * Math.sin(a) + gauss() * spread
    c.copy(armA).lerp(armB, t)
    put(x, gauss() * (0.2 + 0.9 * Math.exp(-r / 3.5)), z, c, (0.22 + rand() * 0.3) * (1 - smooth(0.7, 1.02, t)))
  })

  // 3. the central bulge: a dense, warm, roughly spherical swarm around the core
  const bulgeA = new THREE.Color('#ffe2a8')
  const bulgeB = new THREE.Color('#ffb070')
  await sliced(BULGE_N, () => {
    const x = gauss() * 2.6
    const y = gauss() * 1.7
    const z = gauss() * 2.6
    c.copy(bulgeA).lerp(bulgeB, Math.min(1, Math.hypot(x, y, z) / 4))
    put(x, y, z, c, 0.16 + rand() * 0.28)
  })

  // 4. a faint halo of old stars above and below the disc
  const halo = new THREE.Color('#9aa6d8')
  await sliced(HALO_N, () => {
    const r = 13 * Math.pow(rand(), 0.6)
    const a = rand() * Math.PI * 2
    const up = (rand() * 2 - 1) * 0.4
    const x = HAZE.cx * 0.3 + r * Math.cos(a)
    const z = r * Math.sin(a)
    put(x, r * up, z, halo, (0.12 + rand() * 0.2) * (1 - smooth(0.5, 1, r / 13)))
  })
  return { positions, colors }
}

/** Stars for an era, as soon as they are ready (the old ones stay on screen until the new ones are). */
function useStarData(era: Era) {
  const [data, setData] = useState<StarData | null>(null)
  useEffect(() => {
    let live = true
    void prepareStars(era).then((d) => { if (live) setData(d) })
    return () => { live = false }
  }, [era])
  return data
}

function Stars({ era }: { era: Era }) {
  const data = useStarData(era)
  const mat = useRef<THREE.PointsMaterial>(null)
  // the field fades in the first time it appears (the finished look is exactly the same)
  useFrame((_, dt) => {
    const m = mat.current
    if (m && m.opacity < 1) m.opacity = Math.min(1, m.opacity + dt * 1.1)
  })
  // a soft round dot, so stars stay round when you zoom right in
  const dot = useMemo(() => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 32
    const ctx = cv.getContext('2d')!
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.5)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 32, 32)
    return new THREE.CanvasTexture(cv)
  }, [])
  if (!data) return null
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial ref={mat} size={0.07} opacity={0} map={dot} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
    </points>
  )
}

function CoreGlow() {
  const map = useMemo(() => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const ctx = cv.getContext('2d')!
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,235,180,0.95)')
    g.addColorStop(0.35, 'rgba(255,190,100,0.28)')
    g.addColorStop(1, 'rgba(255,160,60,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(cv)
  }, [])
  return (
    <>
      {[[9, 0.0, 0.4], [6.5, 0.5, 0.3], [4, 1.0, 0.22]].map(([size, y, o]) => (
        <sprite key={y} scale={[size, size, 1]} position={[0, y, 0]}>
          <spriteMaterial map={map} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={o} />
        </sprite>
      ))}
    </>
  )
}

// ---------- warp effects (the Great Rift and warp storms) ----------

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  float fbm3(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`

const RIFT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

const RIFT_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uFade;
  ${NOISE_GLSL}
  void main() {
    float u = vUv.x, v = vUv.y; // v runs -1..1 across the tear
    float edge = 1.0 - abs(v);
    float n = fbm(vec2(u * 14.0 - uTime * 0.12, v * 2.2 + uTime * 0.08));
    float n2 = fbm(vec2(u * 30.0 + uTime * 0.2, v * 4.0 - uTime * 0.15));
    float body = smoothstep(0.0, 0.8, edge) * (0.35 + 0.9 * n);
    vec3 col = mix(vec3(0.35, 0.05, 0.55), vec3(0.95, 0.12, 0.22), n) * body * 1.2;
    float bolt = pow(max(0.0, 1.0 - abs(v + (n2 - 0.5) * 0.9) * 7.0), 3.0) * step(0.55, n2);
    col += vec3(1.0, 0.8, 0.92) * bolt * 0.6;
    float fade = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);
    gl_FragColor = vec4(col, clamp(body * 0.9 + bolt, 0.0, 1.0) * fade * uFade);
  }
`

/** The Great Rift: a ragged, animated tear of crimson and violet warp energy across the galaxy. */
function Rift({ on }: { on: boolean }) {
  const mesh = useRef<THREE.Mesh>(null)
  const mat = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uFade: { value: on ? 1 : 0 } }), [])
  const geometry = useMemo(() => {
    const curve = riftCurve()
    const N = 200
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= N; i++) {
      const u = i / N
      const p = curve.getPoint(u)
      const tan = curve.getTangent(u)
      const width = riftHalfWidth(u)
      const nx = -tan.z * width
      const nz = tan.x * width
      pos.push(p.x + nx, 0, p.z + nz, p.x - nx, 0, p.z - nz)
      uv.push(u, 1, u, -1)
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame((s, dt) => {
    // write to the material's own uniforms: they are not always the same object as `uniforms` above
    const u = mat.current?.uniforms ?? uniforms
    u.uTime.value = s.clock.elapsedTime
    u.uFade.value += ((on ? 1 : 0) - u.uFade.value) * Math.min(1, dt * 3)
    if (mesh.current) mesh.current.visible = u.uFade.value > 0.01
  })

  return (
    <mesh ref={mesh} geometry={geometry} position={[0, 0.06, 0]} frustumCulled={false} renderOrder={2}>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={RIFT_VERT}
        fragmentShader={RIFT_FRAG}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// ---------- warp storms, glowing stars and clouds ----------

const STORM_FRAG = /* glsl */ `
  varying vec2 vLocal;
  uniform float uTime;
  uniform float uSeed;
  uniform float uFade;
  uniform float uHalf;
  uniform vec2 uStretch;
  uniform float uRot;
  ${NOISE_GLSL}
  void main() {
    vec2 p = vLocal / uHalf;                         // -1..1 across the plane
    float c = cos(uRot), s = sin(uRot);
    vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y) / uStretch; // stretched, rotated ellipse
    float ang = atan(q.y, q.x);
    // ragged, lopsided outline: the radius changes with the angle and drifts slowly
    float lobes = 0.62 * (0.7 + 0.6 * fbm(vec2(cos(ang), sin(ang)) * 1.6 + uSeed * 5.0 + uTime * 0.02));
    float r = length(q) / lobes;
    vec2 sp = q * 2.4 + uSeed * 7.0;
    float n = fbm(sp + vec2(uTime * 0.06, -uTime * 0.04));
    float n2 = fbm(sp * 2.0 - vec2(uTime * 0.10, uTime * 0.07));
    float body = smoothstep(1.15, 0.0, r + (n - 0.5) * 0.7) * (0.35 + 0.65 * n);
    vec3 col = mix(vec3(0.30, 0.06, 0.50), vec3(0.85, 0.12, 0.30), n) * body * 1.7;
    // a few thin, faint white veins, only in the denser parts
    float vein = pow(max(0.0, 1.0 - abs(n2 - 0.5) * 20.0), 4.0) * smoothstep(0.45, 0.8, n) * smoothstep(1.0, 0.3, r);
    col += vec3(1.0, 0.85, 0.95) * vein * 0.8;
    float a = clamp(body * 0.95 + vein * 0.7, 0.0, 1.0) * uFade;
    gl_FragColor = vec4(col, a);
  }
`

const LOCAL_VERT = /* glsl */ `
  varying vec2 vLocal;
  void main() { vLocal = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

/** Every warp storm on the reference map, in the same crimson-violet style as the Great Rift. Each has its own lopsided shape. */
function WarpStorms({ era }: { era: Era }) {
  const meshes = useRef<(THREE.Mesh | null)[]>([])
  const mats = useRef<(THREE.ShaderMaterial | null)[]>([])
  const shapes = useMemo(
    () =>
      STORMS.map((s, i) => {
        const frac = (k: number) => (i * k) % 1
        return {
          half: s.size * 0.9,
          uniforms: {
            uTime: { value: 0 },
            uFade: { value: (s.eras as Era[]).includes(era) ? 1 : 0 },
            uSeed: { value: i * 1.7 + 0.3 },
            uHalf: { value: s.size * 0.9 },
            uStretch: { value: new THREE.Vector2(1.1 + 0.4 * frac(0.61), 0.6 + 0.25 * frac(0.37)) },
            uRot: { value: (i * 1.37) % Math.PI },
          },
        }
      }),
    [],
  )
  useFrame((st, dt) => {
    shapes.forEach((sh, i) => {
      const u = mats.current[i]?.uniforms ?? sh.uniforms
      u.uTime.value = st.clock.elapsedTime
      const target = (STORMS[i].eras as Era[]).includes(era) ? 1 : 0
      u.uFade.value += (target - u.uFade.value) * Math.min(1, dt * 3)
      const m = meshes.current[i]
      if (m) m.visible = u.uFade.value > 0.01
    })
  })
  return (
    <>
      {STORMS.map((s, i) => {
        const w = toWorld(s.px, s.py)
        return (
          <mesh key={s.name} ref={(m) => { meshes.current[i] = m }} position={[w.x, 0.07, w.z]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} renderOrder={2}>
            <planeGeometry args={[shapes[i].half * 2, shapes[i].half * 2]} />
            <shaderMaterial
              ref={(m) => { mats.current[i] = m }}
              uniforms={shapes[i].uniforms}
              vertexShader={LOCAL_VERT}
              fragmentShader={STORM_FRAG}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )
      })}
    </>
  )
}

const GLOW_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * uScale / -mv.z, 72.0);
    gl_Position = projectionMatrix * mv;
  }
`

const GLOW_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float glow = exp(-d * d * 6.0);
    float core = pow(max(0.0, 1.0 - d), 8.0);
    float spike = (exp(-abs(c.x) * 40.0) + exp(-abs(c.y) * 40.0)) * 0.22 * (1.0 - d);
    gl_FragColor = vec4(vColor * (glow * 0.9 + core * 1.5 + spike), glow);
  }
`

/** A few hundred big, soft, glowing stars scattered along the arms and around the core, like the bright knots on the map. */
function GlowStars({ era }: { era: Era }) {
  const gl = useThree((s) => s.gl)
  const height = useThree((s) => s.size.height)
  const uniforms = useMemo(() => ({ uScale: { value: 600 } }), [])
  useFrame(() => { uniforms.uScale.value = (height * gl.getPixelRatio()) / (2 * TAN_HALF_FOV) })

  const data = useMemo(() => {
    const rand = rng(777)
    const gauss = () => (rand() + rand() + rand() + rand() - 2) / 2
    const tear = makeTearFactor(era)
    const palette = ['#fff1d0', '#cfe0ff', '#ffd0f0', '#ffe9a8', '#e6d2ff'].map((h) => new THREE.Color(h))
    const pts: { x: number; y: number; z: number }[] = []
    for (let i = 0; i < 260; i++) {
      const t = Math.pow(rand(), 0.9)
      const r = 0.4 + 11 * t
      const a = (i % 2) * Math.PI + t * 4.8 + gauss() * 0.3
      pts.push({ x: r * Math.cos(a) + gauss() * (0.3 + t * 0.8), y: gauss() * 0.2, z: r * Math.sin(a) + gauss() * (0.3 + t * 0.8) })
    }
    for (let i = 0; i < 90; i++) pts.push({ x: gauss() * 1.6, y: gauss() * 0.2, z: gauss() * 1.6 })
    for (let i = 0; i < 90; i++) {
      const r = HAZE.radius * Math.sqrt(rand()) * 0.85
      const a = rand() * Math.PI * 2
      pts.push({ x: HAZE.cx + r * Math.cos(a), y: gauss() * 0.2, z: r * Math.sin(a) })
    }
    const positions = new Float32Array(pts.length * 3)
    const sizes = new Float32Array(pts.length)
    const colors = new Float32Array(pts.length * 3)
    pts.forEach((p, i) => {
      positions.set([p.x, p.y, p.z], i * 3)
      const edge = 1 - smooth(0.6, 1, Math.hypot(p.x - HAZE.cx, p.z) / HAZE.radius)
      const k = (0.55 + rand() * 0.45) * tear(p.x, p.z) * edge
      const col = palette[Math.floor(rand() * palette.length)]
      colors.set([col.r * k, col.g * k, col.b * k], i * 3)
      sizes[i] = 0.22 + Math.pow(rand(), 2.2) * 0.75
    })
    return { positions, sizes, colors }
  }, [era])

  return (
    <points frustumCulled={false} renderOrder={2}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[data.sizes, 1]} />
        <bufferAttribute attach="attributes-aColor" args={[data.colors, 3]} />
      </bufferGeometry>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={GLOW_VERT}
        fragmentShader={GLOW_FRAG}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

const CLOUD_FRAG = /* glsl */ `
  varying vec2 vLocal;
  uniform float uTime;
  uniform float uCx;
  uniform float uLayer;
  uniform float uRadius;
  uniform float uAlpha;
  ${NOISE_GLSL}
  void main() {
    vec2 w = vec2(uCx + vLocal.x, -vLocal.y);       // world X/Z of this pixel
    float r = length(w);                              // distance from the galactic core
    float edge = length(vec2(w.x - uCx, w.y)) / uRadius;
    float fade = 1.0 - smoothstep(0.35, 1.0, edge);   // soft fall-off toward the rim
    float ang = atan(w.y, w.x);
    vec2 q = vec2(fbm3(w * 0.32 + uLayer * 4.0 + uTime * 0.004), fbm3(w * 0.32 + vec2(5.2, 1.3) - uTime * 0.003));
    float n = fbm3(w * 0.3 + 2.0 * q + uLayer * 3.1);
    float arms = 0.55 + 0.45 * sin(2.0 * ang - r * 0.42 + n * 2.5);
    float dens = smoothstep(0.42, 0.84, n) * (0.2 + 0.8 * arms);
    float coreGlow = exp(-r * 0.16);
    vec3 col = mix(vec3(0.10, 0.14, 0.34), vec3(0.50, 0.28, 0.55), smoothstep(0.2, 0.8, n));
    col = mix(col, vec3(0.95, 0.72, 0.5), coreGlow * 0.8);
    float a = (dens * 1.6 + coreGlow * 0.4) * fade;
    gl_FragColor = vec4(col * a * 1.3 * uAlpha, a * 0.9 * uAlpha);
  }
`

/** Soft drifting nebula clouds, stacked in two layers so they shift against each other as the camera orbits. */
function Clouds() {
  const layers = useMemo(
    () => [[-1.0, 0.45], [-0.35, 0.6], [0.3, 0.6], [0.95, 0.45]].map(([y, alpha], i) => ({
      y,
      u: { uTime: { value: 0 }, uCx: { value: HAZE.cx }, uLayer: { value: i }, uRadius: { value: HAZE.radius }, uAlpha: { value: alpha } },
    })),
    [],
  )
  useFrame((s) => { for (const l of layers) l.u.uTime.value = s.clock.elapsedTime })
  return (
    <>
      {layers.map((l) => (
        <mesh key={l.y} position={[HAZE.cx, l.y, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} renderOrder={-1}>
          <planeGeometry args={[HAZE.radius * 2.2, HAZE.radius * 2.2]} />
          <shaderMaterial
            uniforms={l.u}
            vertexShader={LOCAL_VERT}
            fragmentShader={CLOUD_FRAG}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </>
  )
}

const DUST_FRAG = /* glsl */ `
  varying vec2 vLocal;
  uniform float uCx;
  uniform float uRadius;
  ${NOISE_GLSL}
  void main() {
    vec2 w = vec2(uCx + vLocal.x, -vLocal.y);
    float r = length(w);
    float edge = length(vec2(w.x - uCx, w.y)) / uRadius;
    float fade = (1.0 - smoothstep(0.3, 0.95, edge)) * smoothstep(0.8, 2.5, r);
    float ang = atan(w.y, w.x);
    float lane = smoothstep(0.55, 0.95, sin(2.0 * ang - r * 0.42 + 1.6)); // runs along the inner edge of each arm
    float n = fbm3(w * 0.35 + 3.0);
    float a = lane * smoothstep(0.3, 0.8, n) * fade * 0.55;
    gl_FragColor = vec4(0.01, 0.01, 0.03, a);
  }
`

/** Dark dust lanes along the spiral arms: they dim the stars behind them, which is what gives a galaxy its sense of thickness. */
function Dust() {
  const uniforms = useMemo(() => ({ uCx: { value: HAZE.cx }, uRadius: { value: HAZE.radius } }), [])
  return (
    <mesh position={[HAZE.cx, -0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} renderOrder={1}>
      <planeGeometry args={[HAZE.radius * 2.2, HAZE.radius * 2.2]} />
      <shaderMaterial uniforms={uniforms} vertexShader={LOCAL_VERT} fragmentShader={DUST_FRAG} transparent depthWrite={false} />
    </mesh>
  )
}

const TEAL_FRAG = /* glsl */ `
  varying vec2 vLocal;
  uniform float uTime;
  uniform float uCx;
  uniform float uRadius;
  uniform float uLayer;
  uniform float uY;
  uniform float uAlpha;
  ${NOISE_GLSL}
  void main() {
    vec2 w = vec2(uCx + vLocal.x, -vLocal.y);
    float r = length(w);
    float edge = length(vec2(w.x - uCx, w.y)) / uRadius;
    float fade = 1.0 - smoothstep(0.45, 1.0, edge);
    vec2 q = vec2(fbm3(w * 0.12 + uLayer * 5.0 + uTime * 0.003), fbm3(w * 0.12 + vec2(3.1, 7.7) - uTime * 0.002));
    float n = fbm3(w * 0.11 + 1.8 * q + uLayer * 2.3);
    float body = smoothstep(0.3, 0.72, n);
    // layers far above/below the disc plane only exist near the core, so the haze forms a lens, not a slab
    float hug = clamp(abs(uY) * 0.6, 0.0, 1.0);
    float conc = mix(1.0, exp(-r * 0.12) * 1.8, hug);
    vec3 col = mix(vec3(0.02, 0.2, 0.24), vec3(0.06, 0.45, 0.48), n);
    gl_FragColor = vec4(col, body * fade * conc * uAlpha);
  }
`

const TEAL_LAYERS: [number, number][] = [[-1.6, 0.17], [-0.8, 0.26], [0, 0.32], [0.8, 0.26], [1.6, 0.17]]

/** A dark teal haze over the whole galaxy, built from stacked layers so it has real volume. */
function TealVolume() {
  const layers = useMemo(
    () =>
      TEAL_LAYERS.map(([y, alpha], i) => ({
        y,
        alpha,
        u: { uTime: { value: 0 }, uCx: { value: HAZE.cx }, uRadius: { value: HAZE.radius }, uLayer: { value: i }, uY: { value: y }, uAlpha: { value: alpha } },
      })),
    [],
  )
  useFrame((s) => { for (const l of layers) l.u.uTime.value = s.clock.elapsedTime })
  return (
    <>
      {layers.map((l) => (
        <mesh key={l.y} position={[HAZE.cx, l.y, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} renderOrder={0.5}>
          <planeGeometry args={[HAZE.radius * 2.2, HAZE.radius * 2.2]} />
          <shaderMaterial uniforms={l.u} vertexShader={LOCAL_VERT} fragmentShader={TEAL_FRAG} transparent depthWrite={false} />
        </mesh>
      ))}
    </>
  )
}

/** When a sector is selected the whole galaxy darkens heavily. Sector outlines and planets are drawn above it, so they stay bright. */
function DimOverlay({ dimmed }: { dimmed: boolean }) {
  const mesh = useRef<THREE.Mesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)
  const camera = useThree((s) => s.camera)
  useFrame((_, dt) => {
    const m = mesh.current
    const mat = material.current
    if (!m || !mat) return
    mat.opacity += ((dimmed ? 0.43 : 0) - mat.opacity) * Math.min(1, dt * 4)
    m.visible = mat.opacity > 0.003
    // a black sheet held one unit in front of the camera, big enough to cover the whole view
    m.position.copy(camera.position)
    m.quaternion.copy(camera.quaternion)
    m.translateZ(-1)
  })
  return (
    <mesh ref={mesh} renderOrder={3} frustumCulled={false} visible={false}>
      <planeGeometry args={[6, 6]} />
      <meshBasicMaterial ref={material} color="#000000" transparent opacity={0} depthTest={false} depthWrite={false} />
    </mesh>
  )
}

// ---------- sectors ----------

function SectorZone({ s, state, hot, onSelect }: { s: Sector; state: 'idle' | 'active' | 'dim'; hot: boolean; onSelect: () => void }) {
  const [hover, setHover] = useState(false)
  const outline = useMemo(() => [...s.polygon, s.polygon[0]].map(([x, z]) => [x, 0.02, z] as [number, number, number]), [s])
  const lit = hover || hot
  const opacity = state === 'active' ? 0.2 : lit ? 0.5 : state === 'dim' ? 0.03 : 0.1

  // ShapeGeometry lives in the XY plane; rotating -90deg about X maps (x, y) to (x, -y) on the ground, so feed it -z.
  const geometry = useMemo(() => new THREE.ShapeGeometry(new THREE.Shape(s.polygon.map(([x, z]) => new THREE.Vector2(x, -z)))), [s])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <FadeWithBackdrop left={0.02}>
      <mesh
        geometry={geometry}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={4}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.delta > DRAG_PX) return; onSelect() }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = '' }}
      >
        <meshBasicMaterial color={s.color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={outline} color={s.color} lineWidth={state === 'active' ? 2.5 : lit ? 4 : 1.2} transparent opacity={lit ? 1 : state === 'dim' ? 0.25 : 0.85} renderOrder={4} />
    </FadeWithBackdrop>
  )
}

// ---------- locked sectors (fog of war) ----------

const LOCK_VERT = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vXZ = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

// The void shroud: nearly black fog with cold wisps and a faint glowing edge. A small distance texture of the sector's
// outline (uSdf: distance to the outline, positive inside, over +-uRange world units) feathers the edge.
const LOCK_FRAG = /* glsl */ `
  varying vec2 vXZ;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uSeed;
  uniform vec4 uBox;
  uniform float uRange;
  uniform sampler2D uSdf;
  ${NOISE_GLSL}
  void main() {
    vec2 uv = (vXZ - uBox.xy) / uBox.zw;
    float sd = (texture2D(uSdf, uv).r - 0.5) * 2.0 * uRange;
    float t = uTime;
    vec2 q0 = vXZ - (uBox.xy + uBox.zw * 0.5);
    float r = length(q0);
    // the fog turns slowly about the sector's middle, faster near it
    float sw = 0.5 * sin(t * 0.05 + uSeed) + 1.1 / (1.0 + r * 0.22);
    float cs = cos(sw), sn = sin(sw);
    vec2 q = vec2(cs * q0.x - sn * q0.y, sn * q0.x + cs * q0.y);
    float n = fbm(q * 0.5 + uSeed + vec2(t * 0.02, 0.0));
    float n2 = fbm(q * 1.3 - uSeed * 2.0 - vec2(t * 0.03, -t * 0.025));
    float m = smoothstep(-0.9, 0.3, sd);
    vec3 col = vec3(0.008, 0.010, 0.018) + vec3(0.05, 0.08, 0.12) * smoothstep(0.35, 0.85, n * 0.5 + n2 * 0.6) * 0.8;
    col += vec3(0.08, 0.16, 0.26) * exp(-pow(sd * 3.2, 2.0)) * 0.7;
    gl_FragColor = vec4(col, uAlpha * m * 0.95);
  }
`

const FOG_PAD = 1.6 // world units around the outline that the fog may spill into
/** How solid the fog is (the host chose 70%). */
const FOG_OPACITY = 0.7

/** Distance from a point to a polygon's outline: positive inside, negative outside. */
function signedDistance(px: number, pz: number, poly: [number, number][]) {
  let inside = false
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside
    const dx = xi - xj
    const dz = zi - zj
    const len2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((px - xj) * dx + (pz - zj) * dz) / len2))
    best = Math.min(best, Math.hypot(px - (xj + t * dx), pz - (zj + t * dz)))
  }
  return inside ? best : -best
}

/** A locked sector: void-shroud fog that hides what lies inside. */
function LockedDust({ s, dim }: { s: Sector; dim: boolean }) {
  const mat = useRef<THREE.ShaderMaterial>(null)

  const { box, texture } = useMemo(() => {
    const b = bbox(s.polygon)
    const box = { x: b.x - FOG_PAD, z: b.z - FOG_PAD, w: b.w + FOG_PAD * 2, h: b.h + FOG_PAD * 2 }
    const W = 256
    const H = Math.max(64, Math.round((W * box.h) / box.w))
    const data = new Uint8Array(W * H)
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const sd = signedDistance(box.x + ((i + 0.5) / W) * box.w, box.z + ((j + 0.5) / H) * box.h, s.polygon)
        data[j * W + i] = Math.round(Math.max(0, Math.min(1, 0.5 + sd / (2 * FOG_PAD))) * 255)
      }
    }
    const texture = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType)
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearFilter
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    return { box, texture }
  }, [s])
  useEffect(() => () => texture.dispose(), [texture])

  const geometry = useMemo(() => new THREE.PlaneGeometry(box.w, box.h), [box])
  useEffect(() => () => geometry.dispose(), [geometry])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uSeed: { value: (s.id.length * 1.37) % 5 },
      uBox: { value: new THREE.Vector4(box.x, box.z, box.w, box.h) },
      uRange: { value: FOG_PAD },
      uSdf: { value: texture },
    }),
    [box, texture, s.id],
  )

  useFrame((st, dt) => {
    // write to the material's own uniforms (they are not always the same object as `uniforms` above)
    const u = mat.current?.uniforms
    if (!u) return
    u.uTime.value = st.clock.elapsedTime
    const target = (dim ? 0.6 : 1) * FOG_OPACITY
    u.uAlpha.value += (target - u.uAlpha.value) * Math.min(1, dt * 3)
  })

  return (
    <mesh
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[box.x + box.w / 2, 0.09, box.z + box.h / 2]}
      renderOrder={5}
      raycast={() => null}
    >
      <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={LOCK_VERT} fragmentShader={LOCK_FRAG} transparent depthWrite={false} />
    </mesh>
  )
}

// ---------- planets ----------

/** How small the picked planet starts, as a share of its full size, so the camera seems to travel a long way to reach it. */
const ARRIVE_FROM = 0.06

/** The picked planet starts as a distant speck and grows to full size as the view flies in. Only the arrival does this: once
 *  it is there it stays full size, however far you zoom out afterwards. */
function Arrive({ position, children }: { position: [number, number, number]; children: ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const grown = useRef(ARRIVE_FROM)
  const fade = arriveFade // the planet's shaders read this directly
  // start invisible, and leave it solid for whatever is picked next
  useLayoutEffect(() => {
    fade.value = 0
    return () => { fade.value = 1 }
  }, [fade])
  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    grown.current += (1 - grown.current) * (1 - Math.exp(-dt * 2.2))
    if (grown.current > 0.9995) grown.current = 1
    g.scale.setScalar(grown.current)
    // it also fades in, fully solid by the time it is half grown
    const f = Math.min(1, (grown.current - ARRIVE_FROM) / (0.5 - ARRIVE_FROM))
    fade.value = f * f * (3 - 2 * f)
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (!m || (m as THREE.ShaderMaterial).isShaderMaterial || m.userData.keepOpacity) return
      m.transparent = true
      m.opacity = fade.value
    })
  })
  return <group ref={group} position={position} scale={ARRIVE_FROM}>{children}</group>
}

/** How much of their normal strength the other planets keep while the black backdrop is up (extreme first: nearly gone). */
const OTHERS_LEFT = 0.04

/** Fades everything inside it along with the black backdrop, so the other planets all but vanish next to the picked one. */
function FadeWithBackdrop({ children, left = OTHERS_LEFT }: { children: ReactNode; left?: number }) {
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    const g = group.current
    if (!g) return
    const k = 1 - (1 - left) * backdropLevel.v
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (!m) return
      for (const mat of Array.isArray(m) ? m : [m]) {
        // if something else changed the opacity (a hover, say), that is the new normal
        if (mat.userData.written !== mat.opacity) mat.userData.baseOpacity = mat.opacity
        mat.transparent = true
        mat.opacity = mat.userData.baseOpacity * k
        mat.userData.written = mat.opacity
      }
    })
  })
  return <group ref={group}>{children}</group>
}

/** One unit sphere shared by every planet dot (sized by scale), so picking a planet does not rebuild a hundred little spheres. */
const PIN_GEOMETRY = new THREE.SphereGeometry(1, 20, 20)

function PlanetPin({ p, color, era, selected, showLabel, focus, compact, hot, enabled, selectable, zone, held, shields, shieldTotal, majority, onSelect }: {
  p: Planet; color: string; era: Era; selected: boolean; showLabel: boolean; focus: boolean; compact: boolean; hot: boolean; enabled: boolean; selectable: boolean; zone: { id: string; name: string; live?: boolean } | null; held: { id: string; name: string }[]; shields: ShieldZone[]; shieldTotal: number; majority: PlanetShieldInfo | null; onSelect: () => void
}) {
  // the reticle needs a round planet to sit on (not a hulk, the Rock or a shattered world)
  const look = lookNameFor(p.name, era)
  const roundWorld = !isHulkId(p.id) && look !== 'rock' && look !== 'shattered'
  return (
    <group position={[p.x, 0.12, p.z]}>
      {/* big invisible target so fingers can hit it */}
      <mesh
        onClick={(e) => { e.stopPropagation(); if (e.delta > DRAG_PX || !selectable) return; onSelect() }}
        onPointerOver={() => { if (selectable) document.body.style.cursor = 'pointer' }}
        onPointerOut={() => { document.body.style.cursor = '' }}
      >
        <sphereGeometry args={[0.55, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected ? (
        <Arrive position={[0, PLANET_FOCUS_Y - 0.12, 0]}>
          <PlanetBody name={p.name} era={era} position={[0, 0, 0]} surface={roundWorld ? <>{held.filter((h) => h.id !== zone?.id).map((h) => <ZoneReticle key={h.id} zone={h} held />)}<ZoneReticle zone={zone} /><VoidShields zones={shields} total={shieldTotal} majority={majority} /></> : undefined} />
        </Arrive>
      ) : (
        <FadeWithBackdrop>
          {isHulkId(p.id) ? (
            <HulkMarker hot={hot} enabled={enabled} compact={compact} />
          ) : (
            <mesh geometry={PIN_GEOMETRY} renderOrder={focus ? 5 : 1} scale={(compact ? 0.06 : showLabel ? 0.2 : 0.11) * (hot ? 2.2 : 1) * (enabled ? 1 : 0.7)}>
              <meshBasicMaterial color={!enabled ? '#4b5064' : hot ? '#ffffff' : color} transparent />
            </mesh>
          )}
          {hot && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
              <ringGeometry args={[0.55, 0.68, 48]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          )}
        </FadeWithBackdrop>
      )}
    </group>
  )
}

// ---------- labels (plain DOM layer, positioned from 3D coordinates) ----------

interface LabelSpec { id: string; x: number; y: number; z: number; cls: string; lines: string[] }

function Labels({ specs, layer }: { specs: LabelSpec[]; layer: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const els = useRef<HTMLDivElement[]>([])
  const v = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    const root = layer.current
    if (!root) return
    root.replaceChildren()
    els.current = specs.map((sp) => {
      const d = document.createElement('div')
      d.className = sp.cls
      sp.lines.forEach((text, i) => {
        const line = document.createElement(i === 0 ? 'strong' : 'span')
        line.textContent = text
        d.appendChild(line)
      })
      root.appendChild(d)
      return d
    })
    return () => root.replaceChildren()
  }, [specs, layer])

  useFrame(() => {
    specs.forEach((sp, i) => {
      const el = els.current[i]
      if (!el) return
      v.set(sp.x, sp.y, sp.z).project(camera)
      if (v.z > 1) { el.style.display = 'none'; return }
      el.style.display = ''
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * size.width}px, ${(-v.y * 0.5 + 0.5) * size.height}px) translate(-50%, -50%)`
    })
  })
  return null
}

// ---------- camera ----------

function CameraRig({ target, position, resetKey }: { target: THREE.Vector3; position: THREE.Vector3; resetKey: string }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const animating = useRef(true)
  const placed = useRef(false)

  useEffect(() => { animating.current = true }, [resetKey])

  useEffect(() => {
    if (!controls) return
    const stop = () => { animating.current = false }
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])

  useFrame((_, dt) => {
    if (!controls || !animating.current) return
    if (!placed.current) {
      // first placement is instant so the page doesn't open with a zoom-out
      camera.position.copy(position)
      controls.target.copy(target)
      controls.update()
      placed.current = true
      return
    }
    const k = 1 - Math.exp(-dt * 3.5)
    camera.position.lerp(position, k)
    controls.target.lerp(target, k)
    controls.update()
    if (camera.position.distanceTo(position) < 0.03 && controls.target.distanceTo(target) < 0.03) animating.current = false
  })
  return null
}

/**
 * Slides the whole view sideways, smoothly, so the subject stays centred in the part of the map not covered by
 * the information window. (A projection shift: the camera and the scene don't move, so nothing snaps or re-frames.)
 */
function ViewShift({ inset }: { inset: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const current = useRef(inset)

  useFrame((_, dt) => {
    current.current += (inset - current.current) * (1 - Math.exp(-dt * 3.2))
    if (Math.abs(inset - current.current) < 0.3) current.current = inset
    if (current.current === 0) {
      if (camera.view?.enabled) camera.clearViewOffset()
    } else {
      // a negative start shifts everything to the right by half the inset
      camera.setViewOffset(size.width, size.height, -current.current / 2, 0, size.width, size.height)
    }
  })
  return null
}

// ---------- start-up: compile planet shaders in the background ----------

const warmed = new WeakMap<object, THREE.Material[]>() // renderer -> materials kept alive so their compiled programs stay cached

/**
 * Right after the galaxy first draws, compile every planet's shader one by one, in the background,
 * so that opening a planet later is instant. Progress feeds the loading bar.
 */
function Warmup() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    if (warmed.has(gl)) return
    const keep: THREE.Material[] = []
    warmed.set(gl, keep)

    void (async () => {
      const total = 1 + WARMUP_PLANETS.length
      setLoad({ done: 0, total, label: 'Preparing the galaxy' })
      // let the first frame draw, then compile off the main thread (the browser's parallel shader compiler)
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      const t0 = performance.now()
      try { await gl.compileAsync(scene, camera) } catch { /* the first real draw will compile it instead */ }
      setLoad({ done: 1, label: 'Galaxy ready' })

      // A slow graphics card (or a browser that cannot compile in parallel) would sit here for a long time on every refresh. So the
      // planets are only warmed up while compiling stays quick: the first one that takes too long ends it, and the machine is
      // remembered, so the next visit skips it. Those planets then compile on their own when first opened.
      const slowKey = 'galaxy-slow-gpu'
      let slow = !gl.extensions.has('KHR_parallel_shader_compile')
      try { if (localStorage.getItem(slowKey)) slow = true } catch { /* not remembered */ }
      if (slow) {
        setLoad({ done: total, label: 'Ready' })
        console.info('[galaxy] skipped the planet warm-up (slow graphics or no parallel compile)')
        return
      }

      let slowed = false
      const holder = new THREE.Mesh(new THREE.SphereGeometry(0.01, 4, 4))
      holder.frustumCulled = false
      holder.layers.set(5) // compiled but never drawn: drawing it while it compiles makes the browser wait for the compile to finish (a multi-second freeze)
      holder.renderOrder = -10
      for (let i = 0; i < WARMUP_PLANETS.length; i++) {
        const w = WARMUP_PLANETS[i]
        setLoad({ label: `Preparing ${w.label}` })
        const c0 = performance.now()
        if (canBake(gl)) {
          // planets are drawn from baked textures, so what needs compiling is the (small) baking program
          try { keep.push(await warmBake(gl, w.name, w.era)) } catch { /* compiled on demand instead */ }
        } else {
          const mat = createWarmupMaterial(w.name, w.era)
          keep.push(mat)
          holder.material = mat
          scene.add(holder)
          try { await gl.compileAsync(scene, camera) } catch { /* compiled on demand instead */ }
          scene.remove(holder)
          markShaderReady(w.name, w.era)
        }
        if (performance.now() - c0 > 2500) {
          try { localStorage.setItem(slowKey, '1') } catch { /* not remembered */ }
          console.info(`[galaxy] ${w.label} took ${Math.round(performance.now() - c0)} ms to compile: warm-up stopped, the rest compile when opened`)
          slowed = true
          break
        }
        setLoad({ done: 2 + i })
      }
      setLoad({ done: total, label: 'Ready' })
      // a quick graphics card that compiled everything easily can also bake every planet quietly in the background
      setPrebakeAllowed(!slowed && canBake(gl))
      if (import.meta.env.DEV) console.info(`[galaxy] background compile: ${Math.round(performance.now() - t0)} ms, ${gl.info.programs?.length ?? '?'} programs`)
    })()
  }, [gl, scene, camera])

  return null
}

/**
 * Bakes planet surfaces (see planetSurfaces.ts): one small band per frame, the planets of the sector you are looking at first, and
 * only while you are not moving around.
 */
function BakeScheduler({ sectors, sectorId, era }: { sectors: Sector[]; sectorId: string | null | undefined; era: Era }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => { if (canBake(gl)) attachSurfaces(gl) }, [gl])
  useEffect(() => {
    if (!canBake(gl)) return
    const list: { name: string; era: string }[] = []
    for (const s of [...sectors].sort((a, b) => Number(b.id === sectorId) - Number(a.id === sectorId))) {
      for (const p of s.planets) if (isBakedWorld(p.name, era)) list.push({ name: p.name, era })
    }
    setPrebake(list)
  }, [gl, sectors, sectorId, era])
  useFrame(() => tickSurfaces())
  return null
}

/** The loading bar: what is being prepared and how far along it is. Disappears when everything is ready. */
function LoadingBar() {
  const { done, total, label } = useLoad()
  if (done >= total) return null
  const pct = Math.round((done / total) * 100)
  return (
    <div className={`loading${done === 0 ? ' big' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Loading">
      <div className="loading-text">
        <span>{label}…</span>
        <strong>{pct}%</strong>
      </div>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

/** Mounts its children after a short delay, so a heavy layer's start-up cost lands between frames, not all on one. */
function Later({ ms, children }: { ms: number; children: ReactNode }) {
  const [on, setOn] = useState(ms <= 0)
  useEffect(() => {
    if (on) return
    const t = window.setTimeout(() => setOn(true), ms)
    return () => window.clearTimeout(t)
  }, [on, ms])
  return on ? <>{children}</> : null
}

// ---------- scene ----------

function Scene({ sectorId, planetId, onSelectSector, onSelectPlanet, onClear, hoverSectorId, hoverPlanetId, hoverZone, playZones, shieldZones, shieldTotal, shieldMajority, era, planetInfo, sectors: SECTORS, viewInset = 0, lockedSectors = [], layer }: Props & { layer: RefObject<HTMLDivElement | null> }) {
  const sector = SECTORS.find((s) => s.id === sectorId)
  const planet = sector?.planets.find((p) => p.id === planetId)
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height))

  const specs = useMemo<LabelSpec[]>(() => {
    if (!sector) {
      return SECTORS.map((s) => {
        const c = sectorCenter(s)
        return { id: s.id, x: c.x, y: 0.4, z: c.z, cls: 'sector-label', lines: [s.name.replace('Segmentum ', '')] }
      })
    }
    // with a planet selected, only that planet keeps its label
    return sector.planets.filter((p) => !planetId || p.id === planetId).map((p) => ({
      id: p.id, x: p.x, y: p.id === planetId ? PLANET_FOCUS_Y + PLANET_RADIUS + 0.45 : 0.75, z: p.z, cls: 'planet-label',
      lines: [p.name, planetInfo[p.id]?.enabled === false ? 'Restricted' : planetInfo[p.id]?.zonesHidden ? '' : `${planetInfo[p.id]?.open ?? openCount(p.tables)}/${planetInfo[p.id]?.total ?? p.tables.length} open`].filter(Boolean),
    }))
  }, [sector, planetId, planetInfo])

  const focus = useMemo(() => {
    if (planet) {
      const d = Math.max(3.4, 2.7 / aspect)
      const target = new THREE.Vector3(planet.x, PLANET_FOCUS_Y, planet.z)
      return { target, position: target.clone().add(new THREE.Vector3(0, 0.3, 0.95).normalize().multiplyScalar(d)) }
    }
    if (!sector) return frame(GALAXY_BOX, aspect, 12)
    // zoom to the sector's planets (plus breathing room), not its whole, mostly empty outline
    const b = bbox(sector.planets.map((p) => [p.x, p.z] as [number, number]))
    const pad = 2
    return frame({ x: b.x - pad, z: b.z - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, aspect, 6)
  }, [sector, planet, aspect])

  return (
    <>
      <color attach="background" args={['#05060d']} />
      <Warmup />
      <BakeScheduler sectors={SECTORS} sectorId={sectorId} era={era} />
      <DimOverlay dimmed={!!sector} />
      <Stars era={era} />
      <CoreGlow />
      {/* the sector map is on screen straight away; the atmosphere layers join it one at a time */}
      <Later ms={120}><Clouds /></Later>
      <Later ms={260}><TealVolume /></Later>
      <Later ms={400}><Dust /></Later>
      <Later ms={540}><GlowStars era={era} /></Later>
      <Later ms={680}><Rift on={era === '40k'} /></Later>
      <Later ms={820}><WarpStorms era={era} /></Later>
      <PlanetBackdrop planetId={planetId} era={era} anchor={planet ? [planet.x, PLANET_FOCUS_Y, planet.z] : null} />
      <Labels specs={specs} layer={layer} />

      {SECTORS.map((s) => {
        const state = !sector ? 'idle' : s.id === sector.id ? 'active' : 'dim'
        return (
          <group key={s.id}>
            <SectorZone s={s} state={state} hot={s.id === hoverSectorId} onSelect={() => (sector && sector.id !== s.id ? onClear() : onSelectSector(s.id))} />
            {lockedSectors.includes(s.id) && <LockedDust s={s} dim={state === 'dim'} />}
            {!lockedSectors.includes(s.id) && s.planets.map((p) => (
              <PlanetPin
                key={p.id}
                p={p}
                color={s.color}
                era={era}
                selected={p.id === planetId}
                showLabel={s.id === sectorId}
                focus={!sector || s.id === sector.id}
                compact={!!planetId}
                hot={p.id === hoverPlanetId}
                enabled={planetInfo[p.id]?.enabled !== false}
                selectable
                zone={p.id === planetId ? hoverZone ?? null : null}
                held={p.id === planetId ? playZones ?? [] : []}
                shields={p.id === planetId ? shieldZones ?? [] : []}
                shieldTotal={shieldTotal ?? 0}
                majority={p.id === planetId ? shieldMajority ?? null : null}
                onSelect={() => onSelectPlanet(s.id, p.id)}
              />
            ))}
          </group>
        )
      })}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1.5}
        maxDistance={70}
        maxPolarAngle={(85 * Math.PI) / 180}
      />
      <ViewShift inset={viewInset} />
      <CameraRig target={focus.target} position={focus.position} resetKey={`${sectorId}/${planetId}/${aspect.toFixed(2)}`} />
    </>
  )
}

export default function Galaxy3D(props: Props) {
  const layer = useRef<HTMLDivElement>(null)
  const home = frame(GALAXY_BOX, 1, 12)
  return (
    <div className="map-box">
      <Canvas
        camera={{ position: home.position.toArray(), fov: FOV, near: 0.1, far: 200 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onPointerMissed={props.onClear}
      >
        <Scene {...props} layer={layer} />
      </Canvas>
      <div className="labels" ref={layer} />
      <LoadingBar />
      {props.children}
    </div>
  )
}
