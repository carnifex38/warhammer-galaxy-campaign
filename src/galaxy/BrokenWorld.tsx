import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { NOISE3 } from './glsl'

// A world that was blown apart (Nostramo, Colchis): the planet is gone. A small molten remnant of the core glows in the middle,
// surrounded by great slabs of crust and a wide cloud of rubble, all drifting slowly round it. (Cadia's wrecked-but-whole look
// is ShatteredField; this is the one for planets that burst.)

export interface BrokenStyle {
  /** rock colours, dark to light */
  rock: string[]
  /** glow colour of the molten remnant and the cracks in the slabs */
  heat: string
  /** dust haze colour */
  haze: [number, number, number]
}

const BIG = 9
const SMALL = 260

function rng(seed: number) {
  let s = Math.floor(seed * 1000) | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CORE_VERT = /* glsl */ `
  varying vec3 vObj;
  void main() {
    vObj = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const CORE_FRAG = /* glsl */ `
  varying vec3 vObj;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uHeat;
  ${NOISE3}
  void main() {
    float t = fbm3d(vObj * 4.0 + vec3(0.0, uTime * 0.25, 0.0) + uSeed);
    float crust = smoothstep(0.52, 0.7, fbm3d(vObj * 7.0 + uSeed + 5.0));
    vec3 c = mix(uHeat * 0.6, mix(uHeat, vec3(1.0, 0.95, 0.8), 0.6), smoothstep(0.3, 0.9, t));
    c = mix(c * 1.5, vec3(0.05, 0.04, 0.04), crust * 0.85); // cooling black crust over the glow
    gl_FragColor = vec4(c, 1.0);
  }
`

function glowTexture(rgb: [number, number, number]) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  const c = rgb.join(',')
  g.addColorStop(0, `rgba(${c},0.9)`)
  g.addColorStop(0.35, `rgba(${c},0.25)`)
  g.addColorStop(1, `rgba(${c},0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(cv)
}

interface Rock { r: number; a0: number; w: number; y: number; size: number; rx: number; ry: number; sx: number; sy: number }

const dummy = new THREE.Object3D()

function place(mesh: THREE.InstancedMesh | null, items: Rock[], t: number) {
  if (!mesh) return
  items.forEach((k, i) => {
    const a = k.a0 + k.w * t
    dummy.position.set(k.r * Math.cos(a), k.y, k.r * Math.sin(a))
    dummy.rotation.set(k.rx + k.sx * t, k.ry + k.sy * t, 0)
    dummy.scale.set(k.size * 1.25, k.size * 0.6, k.size)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
}

export default function BrokenWorld({ seed, style }: { seed: number; style: BrokenStyle }) {
  const big = useRef<THREE.InstancedMesh>(null)
  const small = useRef<THREE.InstancedMesh>(null)
  const dust = useRef<THREE.Points>(null)

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uSeed: { value: seed }, uHeat: { value: new THREE.Color(style.heat) } }), [seed, style.heat])

  // a lumpy rock, jittered so no two faces match
  const geometry = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 1)
    const pos = g.attributes.position
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      const n = 0.65 + 0.7 * Math.abs(Math.sin(v.x * 6.3 + v.y * 4.1 + v.z * 5.7 + seed))
      pos.setXYZ(i, v.x * n, v.y * n, v.z * n)
    }
    g.computeVertexNormals()
    return g
  }, [seed])
  useEffect(() => () => geometry.dispose(), [geometry])

  const data = useMemo(() => {
    const rand = rng(seed + 3)
    const make = (n: number, r: [number, number], size: [number, number], spin: number): Rock[] =>
      Array.from({ length: n }, () => {
        const rr = r[0] + (r[1] - r[0]) * Math.sqrt(rand())
        return {
          r: rr, a0: rand() * 6.28, w: (spin / Math.pow(rr, 1.4)) * (0.7 + rand() * 0.6), y: (rand() - 0.5) * 0.45,
          size: size[0] + (size[1] - size[0]) * Math.pow(rand(), 1.5),
          rx: rand() * 6.28, ry: rand() * 6.28, sx: (rand() - 0.5) * 0.5, sy: (rand() - 0.5) * 0.5,
        }
      })
    const dustPositions = new Float32Array(900 * 3)
    for (let i = 0; i < 900; i++) {
      const r = 0.25 + 0.95 * Math.sqrt(rand())
      const a = rand() * 6.28
      dustPositions.set([r * Math.cos(a), (rand() - 0.5) * 0.4 * r, r * Math.sin(a)], i * 3)
    }
    return { big: make(BIG, [0.3, 0.75], [0.07, 0.15], 0.09), small: make(SMALL, [0.25, 1.15], [0.012, 0.045], 0.1), dustPositions }
  }, [seed])

  useEffect(() => {
    const rand = rng(seed + 11)
    const palette = style.rock.map((h) => new THREE.Color(h))
    for (const m of [big.current, small.current]) {
      if (!m) continue
      for (let i = 0; i < m.count; i++) m.setColorAt(i, palette[Math.floor(rand() * palette.length)])
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }, [seed, style])

  const hazeMap = useMemo(() => glowTexture(style.haze), [style.haze])
  const coreMap = useMemo(() => glowTexture([255, 220, 160]), [])
  useEffect(() => () => { hazeMap.dispose(); coreMap.dispose() }, [hazeMap, coreMap])

  useFrame((s) => {
    const t = s.clock.elapsedTime
    uniforms.uTime.value = t
    place(big.current, data.big, t)
    place(small.current, data.small, t)
    if (dust.current) dust.current.rotation.y = t * 0.03
  })

  return (
    <>
      <ambientLight intensity={0.3} color="#7a7a90" />
      <directionalLight position={[-4, 1.5, 2.5]} intensity={2.2} color="#ffe0b8" />
      <group scale={0.8}>
        <sprite scale={[3.6, 3.6, 1]} renderOrder={5}>
          <spriteMaterial map={hazeMap} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.4} />
        </sprite>
        {/* the molten remnant of the core */}
        <mesh renderOrder={5}>
          <sphereGeometry args={[0.17, 48, 32]} />
          <shaderMaterial uniforms={uniforms} vertexShader={CORE_VERT} fragmentShader={CORE_FRAG} />
        </mesh>
        <sprite scale={[1.1, 1.1, 1]} renderOrder={6}>
          <spriteMaterial map={coreMap} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.7} />
        </sprite>
        <group rotation={[0.35, 0, -0.12]}>
          <instancedMesh ref={big} args={[geometry, undefined, BIG]} frustumCulled={false} renderOrder={5}>
            <meshStandardMaterial roughness={0.95} flatShading emissive={style.heat} emissiveIntensity={0.02} />
          </instancedMesh>
          <instancedMesh ref={small} args={[geometry, undefined, SMALL]} frustumCulled={false} renderOrder={5}>
            <meshStandardMaterial roughness={0.95} flatShading />
          </instancedMesh>
          <points ref={dust} frustumCulled={false} renderOrder={5}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[data.dustPositions, 3]} />
            </bufferGeometry>
            <pointsMaterial size={0.02} color={`rgb(${style.haze.join(',')})`} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
          </points>
        </group>
      </group>
    </>
  )
}
