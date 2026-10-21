import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Era } from './planetLooks'

// When a planet is picked, the galaxy is replaced by empty black space and a sky of stars around the planet.
// Zooming out from the planet gradually brings the galaxy map back.

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Camera distance (from the planet) at which the backdrop starts to thin, and the distance at which it has gone. */
const FADE_FROM = 6
const FADE_TO = 22

const RADIUS = 90

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stars scattered evenly over a sphere, in a few colours and brightnesses. */
function starLayer(count: number, seed: number, minB: number, maxB: number) {
  const rand = rng(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const tints = [new THREE.Color('#ffffff'), new THREE.Color('#bcd2ff'), new THREE.Color('#ffe6bf'), new THREE.Color('#ffc9a6')]
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1
    const a = rand() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    positions.set([RADIUS * s * Math.cos(a), RADIUS * u, RADIUS * s * Math.sin(a)], i * 3)
    const c = tints[Math.floor(rand() * rand() * tints.length)]
    const b = minB + (maxB - minB) * Math.pow(rand(), 2)
    colors.set([c.r * b, c.g * b, c.b * b], i * 3)
  }
  return { positions, colors }
}

/** How strongly the black backdrop is up right now (0 to 1), so other things can fade with it. */
export const backdropLevel = { v: 0 }

/** Thin layers of stars in the space around the planet, at several distances. The camera flies through them on the way in. */
const LAYERS = [3.8, 5.2, 7, 9.2, 11.8, 14.8, 18.5]

function layerStars() {
  const rand = rng(31337)
  const n = LAYERS.reduce((s, r) => s + Math.round(60 + r * 16), 0)
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const tints = [new THREE.Color('#ffffff'), new THREE.Color('#bcd2ff'), new THREE.Color('#ffe6bf')]
  let i = 0
  for (const r of LAYERS) {
    const count = Math.round(60 + r * 16)
    for (let k = 0; k < count; k++, i++) {
      const u = rand() * 2 - 1
      const a = rand() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      const rr = r + (rand() - 0.5) * 0.7 // each layer is a thin shell
      positions.set([rr * s * Math.cos(a), rr * u, rr * s * Math.sin(a)], i * 3)
      const c = tints[Math.floor(rand() * tints.length)]
      const b = 0.85 + rand() * 0.15
      colors.set([c.r * b, c.g * b, c.b * b], i * 3)
    }
  }
  return { positions, colors }
}

export function PlanetBackdrop({ planetId, era, anchor }: { planetId: string | null; era: Era; anchor: [number, number, number] | null }) {
  const layersMat = useRef<THREE.PointsMaterial>(null)
  const layersPts = useRef<THREE.Points>(null)
  const lastAnchor = useRef<[number, number, number]>([0, 0, 0])
  useEffect(() => { if (anchor) lastAnchor.current = anchor }, [anchor])
  const nearStars = useMemo(() => layerStars(), [])
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const group = useRef<THREE.Group>(null)
  const dome = useRef<THREE.MeshBasicMaterial>(null)
  const faint = useRef<THREE.PointsMaterial>(null)
  const bright = useRef<THREE.PointsMaterial>(null)
  const level = useRef(0)

  // the stars are crisp single pixels (no soft dot texture)
  const faintStars = useMemo(() => starLayer(4500, 4242, 0.6, 1), [])
  const brightStars = useMemo(() => starLayer(500, 777, 1, 1), [])
  // the 30K sky is a touch cooler
  const tint = era === '30k' ? '#d6e4ff' : '#ffffff'

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const dist = controls ? camera.position.distanceTo(controls.target) : 0
    // with a planet picked: full black when close, thinning out as the camera pulls away
    const want = planetId ? 1 - smoothstep(FADE_FROM, FADE_TO, dist) : 0
    level.current += (want - level.current) * Math.min(1, dt * 6)
    const o = level.current
    backdropLevel.v = o
    if (dome.current) dome.current.opacity = o
    if (faint.current) faint.current.opacity = o
    if (bright.current) bright.current.opacity = o
    if (layersMat.current) layersMat.current.opacity = o
    g.visible = o > 0.004
    g.position.copy(camera.position) // the sky stays put around the viewer
    // the layers do not follow the camera: they hang in space around the planet, so flying in passes through them
    layersPts.current?.position.set(...lastAnchor.current).sub(camera.position)
  })

  return (
    <group ref={group} visible={false}>
      <mesh renderOrder={4.5} frustumCulled={false} raycast={() => null}>
        <sphereGeometry args={[RADIUS + 4, 24, 16]} />
        <meshBasicMaterial ref={dome} color="#000000" side={THREE.BackSide} transparent opacity={0} depthWrite={false} />
      </mesh>
      <points renderOrder={4.6} frustumCulled={false} raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[faintStars.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[faintStars.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={faint} color={tint} size={1} sizeAttenuation={false} vertexColors transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <points renderOrder={4.7} frustumCulled={false} raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[brightStars.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[brightStars.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={bright} color={tint} size={1} sizeAttenuation={false} vertexColors transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      {/* inside the camera-following group, so the offset above puts them back at the planet */}
      <points ref={layersPts} renderOrder={4.8} frustumCulled={false} raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nearStars.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[nearStars.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={layersMat} color={tint} size={1} sizeAttenuation={false} vertexColors transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </group>
  )
}
