import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// A drifting space hulk (Judgement of Carrion): several colossal gothic warships and chunks of asteroid
// fused together at odd angles, dark and weathered, with spires and cathedral towers sticking out, lit by
// a hot warp-glow behind. Everything is merged into one mesh so it stays cheap to draw.

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Soft round glow used for the warp-light and engine fire. */
export function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const HULL = ['#7a6246', '#8c7050', '#a0845a', '#65503a', '#b09468', '#52402f'].map((c) => new THREE.Color(c))
const ROCK = ['#3a342d', '#4a4238', '#2b2723', '#55493b'].map((c) => new THREE.Color(c))

/** A box that narrows toward +x: the prow of a ship. */
function taperedBox() {
  const g = new THREE.BoxGeometry(1, 1, 1)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    if (p.getX(i) > 0) p.setY(i, p.getY(i) * 0.3), p.setZ(i, p.getZ(i) * 0.4)
  }
  return g
}

export class Builder {
  parts: THREE.BufferGeometry[] = []
  lights: THREE.Vector3[] = []
  windows: number[] = []
  m = new THREE.Matrix4()
  box = new THREE.BoxGeometry(1, 1, 1)
  prow = taperedBox()
  spire = new THREE.ConeGeometry(0.5, 1, 5)
  tube = new THREE.CylinderGeometry(0.5, 0.5, 1, 8)
  rock = new THREE.IcosahedronGeometry(1, 2)

  add(geo: THREE.BufferGeometry, base: THREE.Matrix4, pos: [number, number, number], scale: [number, number, number], color: THREE.Color, rot: [number, number, number] = [0, 0, 0]) {
    const g = geo.clone()
    // Parts overlap and many have faces in the very same plane, which flickers (z-fighting). Every part is made a hair bigger or smaller
    // than drawn (a fixed amount for each part, so the hulk looks the same every time) and no two faces stay in the same plane.
    const k = this.parts.length
    const jig = (axis: number) => 1 + (Math.sin(k * 12.9898 + axis * 78.233) * 43758.5453 % 1) * 0.016
    this.m.compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(scale[0] * jig(0), scale[1] * jig(1), scale[2] * jig(2)))
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(base, this.m))
    const n = g.attributes.position.count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.deleteAttribute('uv')
    this.parts.push(g.index ? g.toNonIndexed() : g)
  }

  /** One gothic warship, length L along its own x axis, placed with `base`. */
  ship(L: number, base: THREE.Matrix4, rand: () => number) {
    const W = L * 0.22
    const H = L * 0.13
    const hue = () => HULL[Math.floor(rand() * HULL.length)]
    const dim = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k)

    this.add(this.box, base, [0, 0, 0], [L * 0.78, H, W], hue())
    this.add(this.prow, base, [L * 0.39 + L * 0.15, 0, 0], [L * 0.3, H, W], hue())
    this.add(this.box, base, [L * 0.2, -H * 0.55, 0], [L * 0.45, H * 0.3, W * 0.8], dim(hue(), 0.7)) // keel

    // ribbed flanks and gun sponsons
    for (let i = 0; i < 26; i++) {
      const x = -L * 0.38 + (i / 25) * L * 0.74
      for (const s of [-1, 1]) {
        this.add(this.box, base, [x, 0, s * W * 0.53], [L * 0.014, H * (1.05 + rand() * 0.2), W * 0.08], hue())
        if (i % 2 === 0) {
          const p = new THREE.Vector3(x, H * 0.2, s * W * 0.62).applyMatrix4(base)
          this.windows.push(p.x, p.y, p.z)
          this.add(this.box, base, [x, H * 0.2, s * W * 0.6], [L * 0.028, H * 0.2, W * 0.12], dim(hue(), 1.2))
        }
      }
    }

    // dorsal deck and stepped superstructure
    this.add(this.box, base, [-L * 0.05, H * 0.58, 0], [L * 0.62, H * 0.18, W * 0.72], hue())
    for (let i = 0; i < 5; i++) {
      this.add(this.box, base, [-L * (0.05 + i * 0.07), H * (0.8 + i * 0.14), 0], [L * (0.2 - i * 0.02), H * (0.3 + i * 0.1), W * (0.55 - i * 0.07)], hue())
    }
    // the cathedral tower and its spires
    const tx = -L * 0.26
    this.add(this.box, base, [tx, H * 1.7, 0], [L * 0.09, H * 1.5, W * 0.34], hue())
    this.add(this.spire, base, [tx, H * 3.1, 0], [L * 0.06, H * 2.3, L * 0.06], hue())
    for (const [dx, dz, h] of [[0.05, 0.1, 1.5], [-0.05, 0.1, 1.2], [0.05, -0.1, 1.4], [-0.05, -0.1, 1.1], [0, 0, 1.8]] as const) {
      this.add(this.spire, base, [tx + L * dx, H * (2.5 + h * 0.3), L * dz * 0.6], [L * 0.022, H * h, L * 0.022], hue())
    }
    // secondary spires along the deck
    for (let i = 0; i < 7; i++) {
      const x = L * (0.3 - i * 0.1) + (rand() - 0.5) * 0.04
      const h = H * (0.5 + rand() * 1.2)
      this.add(this.spire, base, [x, H * 0.7 + h * 0.5, (rand() - 0.5) * W * 0.6], [L * 0.016, h, L * 0.016], hue())
    }
    // long lances jutting from the prow
    for (let i = 0; i < 8; i++) {
      const s = i % 2 ? 1 : -1
      const len = L * (0.18 + rand() * 0.14)
      this.add(this.spire, base, [L * 0.5 + len * 0.3, (rand() - 0.5) * H * 0.8, s * W * (0.2 + rand() * 0.4)], [L * 0.01, len, L * 0.01], dim(hue(), 1.3), [0, 0, -Math.PI / 2])
    }
    // great side fins
    for (const s of [-1, 1]) {
      this.add(this.box, base, [-L * 0.1, -H * 0.1, s * W * 0.95], [L * 0.2, H * 1.9, W * 0.06], dim(hue(), 0.85), [0, 0, 0.12 * s])
    }
    // stern block and engines
    this.add(this.box, base, [-L * 0.43, 0, 0], [L * 0.13, H * 1.1, W * 1.05], dim(hue(), 0.8))
    for (const [y, z] of [[0.25, 0], [-0.25, 0.28], [-0.25, -0.28], [0.25, 0.4], [0.25, -0.4]]) {
      this.add(this.tube, base, [-L * 0.52, H * y, W * z], [H * 0.34, L * 0.07, H * 0.34], dim(hue(), 0.7), [0, 0, Math.PI / 2])
      this.lights.push(new THREE.Vector3(-L * 0.56, H * y, W * z).applyMatrix4(base))
    }
    // broken-off girders and plates sticking out
    for (let i = 0; i < 14; i++) {
      this.add(this.box, base, [(rand() - 0.5) * L * 0.8, (rand() - 0.5) * H * 2, (rand() > 0.5 ? 1 : -1) * W * (0.6 + rand() * 0.5)], [L * (0.02 + rand() * 0.08), L * 0.01, L * (0.04 + rand() * 0.12)], dim(hue(), 0.7), [rand(), rand(), rand()])
    }
  }

  /** A lumpy asteroid. */
  asteroid(pos: [number, number, number], r: number, rand: () => number, squash = 0.75) {
    const g = this.rock.clone()
    const p = g.attributes.position
    const k = rand() * 10
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      const d = 1 + 0.28 * Math.sin(x * 3.1 + k) * Math.sin(y * 2.7 + k * 1.3) + 0.15 * Math.sin(z * 6.3 + x * 4.1 + k)
      p.setXYZ(i, x * d, y * d * squash, z * d)
    }
    const c = ROCK[Math.floor(rand() * ROCK.length)]
    this.add(g, new THREE.Matrix4(), pos, [r, r, r], c, [rand() * 3, rand() * 3, rand() * 3])
    g.dispose()
  }
}

export function matrix(pos: [number, number, number], rot: [number, number, number]) {
  return new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1))
}

function buildHulk(seed: number) {
  const rand = rng(seed)
  const b = new Builder()
  // the colossal ships, locked together at angles
  b.ship(3.6, matrix([0, 0, 0], [0.04, 0, 0.06]), rand)
  b.ship(2.6, matrix([0.2, 0.35, 0.5], [0.5, 0.9, 0.5]), rand)
  b.ship(2.2, matrix([-0.5, -0.25, -0.55], [-0.3, -0.7, -0.4]), rand)
  b.ship(1.6, matrix([1.0, 0.4, -0.4], [0.6, 2.3, -0.5]), rand)
  // asteroids wedged between them and clinging to them
  b.asteroid([-1.2, -0.35, 0.25], 0.7, rand)
  b.asteroid([0.1, -0.7, -0.1], 0.55, rand)
  b.asteroid([1.4, -0.15, 0.55], 0.45, rand)
  b.asteroid([-0.2, 0.15, -0.9], 0.5, rand)
  b.asteroid([0.8, 0.7, 0.9], 0.35, rand)
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2
    b.asteroid([Math.cos(a) * (1.7 + rand() * 0.8), (rand() - 0.5) * 1.2, Math.sin(a) * (1.1 + rand() * 0.7)], 0.07 + rand() * 0.2, rand)
  }

  const geo = mergeGeometries(b.parts, false)
  b.parts.forEach((p) => p.dispose())
  geo.computeVertexNormals()
  const win = new THREE.BufferGeometry()
  win.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.windows), 3))
  return { geo, win, lights: b.lights }
}

/** The small battleship passing the hulk for scale. */
function Battleship({ glow }: { glow: THREE.Texture }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((s) => {
    const t = s.clock.elapsedTime * 0.1
    if (!ref.current) return
    ref.current.position.set(Math.cos(t) * 3.4, 0.9 + Math.sin(t * 1.7) * 0.2, Math.sin(t) * 2.2 + 0.8)
    ref.current.rotation.y = -t + Math.PI
  })
  return (
    <group ref={ref} scale={0.4}>
      <mesh>
        <boxGeometry args={[0.5, 0.06, 0.1]} />
        <meshStandardMaterial color="#c9ced6" roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[-0.12, 0.05, 0]}>
        <boxGeometry args={[0.16, 0.05, 0.07]} />
        <meshStandardMaterial color="#b0b5be" roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[0.3, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.05, 0.12, 4]} />
        <meshStandardMaterial color="#a33" roughness={0.5} />
      </mesh>
      <sprite position={[-0.3, 0, 0]} scale={[0.18, 0.18, 1]}>
        <spriteMaterial map={glow} color="#bfe2ff" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </group>
  )
}

export default function SpaceHulk({ position, seed = 40000 }: { position: [number, number, number]; seed?: number }) {
  const group = useRef<THREE.Group>(null)
  const parts = useMemo(() => buildHulk(seed), [seed])
  const glow = useMemo(glowTexture, [])
  useEffect(
    () => () => {
      parts.geo.dispose()
      parts.win.dispose()
      glow.dispose()
    },
    [parts, glow],
  )

  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.04
  })

  return (
    <group position={position} scale={0.28}>
      <ambientLight intensity={1.4} color="#b89870" />
      <directionalLight position={[-2, 4, 6]} intensity={4} color="#ffe2b8" />
      <pointLight position={[3, 2, -3]} intensity={10} distance={14} color="#ff8a1c" />

      {/* the warp-light behind the hulk: red haze with a hot yellow core */}
      <sprite scale={[11, 7, 1]} position={[1.5, 0.8, -2.5]} renderOrder={4}>
        <spriteMaterial map={glow} color="#ff4a10" opacity={0.6} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite scale={[5, 4, 1]} position={[2.6, 1.4, -2.8]} renderOrder={4}>
        <spriteMaterial map={glow} color="#ffd24a" opacity={0.75} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>

      <group ref={group} rotation={[0.2, -0.45, 0.04]}>
        <mesh geometry={parts.geo} renderOrder={5}>
          <meshStandardMaterial vertexColors roughness={0.85} metalness={0.4} flatShading />
        </mesh>
        <points geometry={parts.win}>
          <pointsMaterial color="#ffa530" size={0.05} sizeAttenuation transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
        {parts.lights.map((p, i) => (
          <sprite key={i} position={p} scale={[0.5, 0.5, 1]}>
            <spriteMaterial map={glow} color="#ff8a2a" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </sprite>
        ))}
      </group>

      <Battleship glow={glow} />
    </group>
  )
}

/** The small rock shown for the hulk on the sector map: a dark sliver with an orange glow. */
export function HulkMarker({ hot, enabled, compact }: { hot: boolean; enabled: boolean; compact: boolean }) {
  const glow = useMemo(glowTexture, [])
  useEffect(() => () => glow.dispose(), [glow])
  const s = (hot ? 1.8 : 1) * (compact ? 0.6 : 1)
  return (
    <group scale={s} renderOrder={5}>
      <mesh scale={[0.3, 0.1, 0.12]} renderOrder={5}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color={enabled ? '#6b4f33' : '#4b5064'} transparent />
      </mesh>
      {enabled && (
        <sprite scale={[0.9, 0.6, 1]} renderOrder={5}>
          <spriteMaterial map={glow} color="#ff6a1c" opacity={0.7} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      )}
    </group>
  )
}
