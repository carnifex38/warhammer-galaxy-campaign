import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { NOISE3 } from './glsl'

// A planet that has been destroyed (Cadia, the remains of Caliban): a dark, cracked crust with one blazing
// breach where it broke open, fissures of molten rock crowding toward the wound, a spray of fragments
// streaming out of it, a thin ring of rubble, and a reddish dust haze.

const R = 0.6 // crust radius
/** Which way the planet burst open (towards the camera, upper right). */
const BREACH = new THREE.Vector3(0.5, 0.6, 0.62).normalize()

const SPRAY = 220
const HOT_SPRAY = 35
const CHUNKS = 5
const RING_BIG = 6
const RING_SMALL = 140

function rng(seed: number) {
  let s = Math.floor(seed * 1000) | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- the crust ----------

const CRUST_VERT = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vWN;
  varying vec3 vWP;
  void main() {
    vObj = normalize(position);
    vWN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const CRUST_FRAG = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vWN;
  varying vec3 vWP;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uLight;
  uniform vec3 uBreach;
  ${NOISE3}
  void main() {
    vec3 p = vObj;
    vec3 N = normalize(vWN);
    vec3 V = normalize(cameraPosition - vWP);
    vec3 L = normalize(uLight);

    // dark red-brown crust
    float h = fbm3d(p * 2.2 + uSeed);
    float grain = fbm3d(p * 9.0 + uSeed);
    vec3 crust = mix(vec3(0.16, 0.07, 0.05), vec3(0.42, 0.20, 0.12), smoothstep(0.3, 0.75, h)) * (0.7 + 0.6 * grain);

    // molten fissures
    float vein = abs(fbm3d(p * 3.4 + uSeed + 21.0) - 0.5);
    float fiss = pow(clamp(1.0 - vein * 8.0, 0.0, 1.0), 3.0);

    // the breach: a blazing wound with a ragged edge, and cracks that crowd toward it
    float bd = dot(normalize(p), normalize(uBreach));
    float tur = fbm3d(p * 4.0 + vec3(0.0, uTime * 0.35, 0.0) + uSeed);
    float breach = smoothstep(0.5, 0.8, bd + (tur - 0.5) * 0.55);
    if (breach > 0.5) discard; // the missing chunk: you look straight into the molten interior
    float nearB = smoothstep(0.1, 0.75, bd);

    float day = smoothstep(-0.1, 0.35, dot(N, L));
    vec3 col = crust * (0.1 + 0.9 * day);
    col += vec3(1.0, 0.4, 0.08) * fiss * (0.18 + 1.1 * nearB) * 0.8;
    vec3 hot = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.95, 0.72), smoothstep(0.35, 1.0, tur * 1.3));
    col = mix(col, hot * 1.7, smoothstep(0.1, 0.5, breach)); // the torn edge glows white-hot

    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += vec3(1.0, 0.45, 0.2) * fres * 0.3;
    gl_FragColor = vec4(col, 1.0);
  }
`

const CORE_FRAG = /* glsl */ `
  varying vec3 vObj;
  uniform float uTime;
  uniform float uSeed;
  ${NOISE3}
  void main() {
    float t = fbm3d(vObj * 3.0 + vec3(0.0, uTime * 0.3, 0.0) + uSeed);
    vec3 c = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.95, 0.7), smoothstep(0.3, 0.9, t));
    gl_FragColor = vec4(c * 1.4, 1.0);
  }
`

// ---------- fragments ----------

interface Spray { phase: number; speed: number; lat: THREE.Vector3; size: number; rx: number; ry: number; sx: number; sy: number }
interface Ring { r: number; a0: number; w: number; y: number; size: number; rx: number; ry: number; sx: number; sy: number }

const dummy = new THREE.Object3D()
const tmp = new THREE.Vector3()

const smooth01 = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/**
 * Debris drifts out of the wound very slowly. Each rock fades in as it leaves, fades out before it would
 * vanish, and (if `heated`) starts as glowing molten rock and cools to its own colour on the way.
 */
function placeSpray(mesh: THREE.InstancedMesh | null, items: Spray[], t: number, fade: THREE.InstancedBufferAttribute, heat: THREE.InstancedBufferAttribute, heated: boolean) {
  if (!mesh) return
  items.forEach((k, i) => {
    const u = (t * k.speed + k.phase) % 1
    // a wide, billowing cloud rather than a narrow jet
    tmp.copy(BREACH).addScaledVector(k.lat, 0.4 + 0.9 * u).normalize()
    dummy.position.copy(tmp).multiplyScalar(R * 0.8 + u * 1.4)
    dummy.rotation.set(k.rx + k.sx * t * 0.4, k.ry + k.sy * t * 0.4, 0)
    const sc = k.size * (1 - 0.4 * u)
    dummy.scale.set(sc * 1.3, sc * 0.7, sc)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    fade.setX(i, smooth01(0, 0.12, u) * (1 - smooth01(0.6, 1, u)))
    heat.setX(i, heated ? 1 - smooth01(0, 0.5, u) : 0)
  })
  mesh.instanceMatrix.needsUpdate = true
  fade.needsUpdate = true
  heat.needsUpdate = true
}

/** Lets a standard material fade per instance (aFade) and glow per instance (aHeat). */
function withFadeAndHeat(m: THREE.Material | null) {
  if (!m) return
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nattribute float aHeat;\nvarying float vFade;\nvarying float vHeat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;\nvHeat = aHeat;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;\nvarying float vHeat;')
      .replace('#include <opaque_fragment>', 'outgoingLight += vec3(0.9, 0.3, 0.06) * vHeat * 0.75;\ndiffuseColor.a *= vFade;\n#include <opaque_fragment>')
  }
  m.customProgramCacheKey = () => 'fade-heat'
}

/** A copy of a rock geometry carrying the two per-instance attributes the fading material reads. */
function fadeGeometry(base: THREE.BufferGeometry, count: number) {
  const geo = base.clone()
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
  const heat = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
  geo.setAttribute('aFade', fade)
  geo.setAttribute('aHeat', heat)
  return { geo, fade, heat }
}

function placeRing(mesh: THREE.InstancedMesh | null, items: Ring[], t: number) {
  if (!mesh) return
  items.forEach((k, i) => {
    const a = k.a0 + k.w * t
    dummy.position.set(k.r * Math.cos(a), k.y, k.r * Math.sin(a))
    dummy.rotation.set(k.rx + k.sx * t, k.ry + k.sy * t, 0)
    dummy.scale.set(k.size * 1.2, k.size * 0.7, k.size)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
}

function glowTexture(rgb: [number, number, number]) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  const c = rgb.join(',')
  g.addColorStop(0, `rgba(${c},0.95)`)
  g.addColorStop(0.35, `rgba(${c},0.3)`)
  g.addColorStop(1, `rgba(${c},0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(cv)
}

export default function ShatteredField({ seed }: { seed: number }) {
  const spray = useRef<THREE.InstancedMesh>(null)
  const hotSpray = useRef<THREE.InstancedMesh>(null)
  const chunks = useRef<THREE.InstancedMesh>(null)
  const ring = useRef<THREE.InstancedMesh>(null)
  const dust = useRef<THREE.Points>(null)
  const flare = useRef<THREE.SpriteMaterial>(null)

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uSeed: { value: seed }, uLight: { value: new THREE.Vector3(-0.8, 0.35, 0.55) }, uBreach: { value: BREACH.clone() } }),
    [seed],
  )

  // a lumpy rock, jittered so no two faces match
  const geometry = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 1)
    const pos = g.attributes.position
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      const n = 0.7 + 0.6 * Math.abs(Math.sin(v.x * 7.1 + v.y * 3.7 + v.z * 5.3 + seed))
      pos.setXYZ(i, v.x * n, v.y * n, v.z * n)
    }
    g.computeVertexNormals()
    return g
  }, [seed])
  useEffect(() => () => geometry.dispose(), [geometry])

  const sprayGeo = useMemo(() => fadeGeometry(geometry, SPRAY), [geometry])
  const hotGeo = useMemo(() => fadeGeometry(geometry, HOT_SPRAY), [geometry])
  const chunkGeo = useMemo(() => fadeGeometry(geometry, CHUNKS), [geometry])
  useEffect(() => () => { sprayGeo.geo.dispose(); hotGeo.geo.dispose(); chunkGeo.geo.dispose() }, [sprayGeo, hotGeo, chunkGeo])

  const data = useMemo(() => {
    const rand = rng(seed + 1)
    const lat = () => new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize()
    const makeSpray = (n: number, size: [number, number], speed: [number, number] = [0.012, 0.03]): Spray[] =>
      Array.from({ length: n }, () => ({
        phase: rand(), speed: speed[0] + rand() * (speed[1] - speed[0]), lat: lat(),
        size: size[0] + (size[1] - size[0]) * Math.pow(rand(), 1.8),
        rx: rand() * 6.28, ry: rand() * 6.28, sx: (rand() - 0.5) * 1.2, sy: (rand() - 0.5) * 1.2,
      }))
    const makeRing = (n: number, size: [number, number]): Ring[] =>
      Array.from({ length: n }, () => {
        const r = 0.8 + 0.5 * Math.sqrt(rand())
        return {
          r, a0: rand() * 6.28, w: (0.12 / Math.pow(r, 1.3)) * (0.8 + rand() * 0.4), y: (rand() - 0.5) * 0.1,
          size: size[0] + (size[1] - size[0]) * Math.pow(rand(), 1.6),
          rx: rand() * 6.28, ry: rand() * 6.28, sx: (rand() - 0.5) * 0.6, sy: (rand() - 0.5) * 0.6,
        }
      })
    const dustPositions = new Float32Array(700 * 3)
    for (let i = 0; i < 700; i++) {
      const r = 0.7 + 0.9 * Math.sqrt(rand())
      const a = rand() * 6.28
      dustPositions.set([r * Math.cos(a), (rand() - 0.5) * 0.25, r * Math.sin(a)], i * 3)
    }
    return {
      cold: makeSpray(SPRAY, [0.015, 0.06]),
      hot: makeSpray(HOT_SPRAY, [0.02, 0.06], [0.015, 0.04]),
      chunks: makeSpray(CHUNKS, [0.11, 0.19], [0.006, 0.014]),
      ring: [...makeRing(RING_BIG, [0.05, 0.11]), ...makeRing(RING_SMALL, [0.012, 0.04])],
      dustPositions,
    }
  }, [seed])

  useEffect(() => {
    const rand = rng(seed + 9)
    const palette = ['#3a231c', '#4d2e22', '#6a3d2a', '#85502f', '#a0643a'].map((h) => new THREE.Color(h))
    for (const m of [spray.current, ring.current]) {
      if (!m) continue
      for (let i = 0; i < m.count; i++) m.setColorAt(i, palette[Math.floor(rand() * palette.length)])
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }, [seed])

  const flareMap = useMemo(() => glowTexture([255, 235, 170]), [])
  const hazeMap = useMemo(() => glowTexture([150, 70, 45]), [])

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime
    uniforms.uTime.value = t
    placeSpray(spray.current, data.cold, t, sprayGeo.fade, sprayGeo.heat, true)
    placeSpray(hotSpray.current, data.hot, t, hotGeo.fade, hotGeo.heat, false)
    placeSpray(chunks.current, data.chunks, t, chunkGeo.fade, chunkGeo.heat, true)
    placeRing(ring.current, data.ring, t)
    if (dust.current) dust.current.rotation.y += dt * 0.04
    if (flare.current) flare.current.opacity = 0.75 + 0.2 * Math.sin(t * 2.3)
  })

  return (
    <>
      <ambientLight intensity={0.35} color="#8a6a58" />
      <directionalLight position={[-4, 1.5, 2.5]} intensity={2.4} color="#ffd9a8" />

      <group scale={0.8}>
      {/* reddish dust haze behind everything */}
      <sprite scale={[4, 4, 1]} renderOrder={5}>
        <spriteMaterial map={hazeMap} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.45} />
      </sprite>

      {/* molten interior, seen through the hole */}
      <mesh renderOrder={5}>
        <sphereGeometry args={[R * 0.9, 64, 48]} />
        <shaderMaterial uniforms={uniforms} vertexShader={CRUST_VERT} fragmentShader={CORE_FRAG} transparent />
      </mesh>

      {/* the broken crust */}
      <mesh renderOrder={5}>
        <sphereGeometry args={[R, 96, 64]} />
        <shaderMaterial uniforms={uniforms} vertexShader={CRUST_VERT} fragmentShader={CRUST_FRAG} transparent />
      </mesh>

      {/* blazing light pouring out of the breach */}
      <sprite position={BREACH.clone().multiplyScalar(R * 0.95)} scale={[1.7, 1.7, 1]} renderOrder={6}>
        <spriteMaterial ref={flare} map={flareMap} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
      </sprite>

      <instancedMesh ref={spray} args={[sprayGeo.geo, undefined, SPRAY]} frustumCulled={false} renderOrder={5}>
        <meshStandardMaterial ref={withFadeAndHeat} roughness={0.95} flatShading transparent depthWrite={false} />
      </instancedMesh>
      {/* a few big slabs of crust drifting away from the wound */}
      <instancedMesh ref={chunks} args={[chunkGeo.geo, undefined, CHUNKS]} frustumCulled={false} renderOrder={5}>
        <meshStandardMaterial ref={withFadeAndHeat} color="#4a2a20" emissive="#ff5a14" emissiveIntensity={0.15} roughness={0.95} flatShading transparent depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={hotSpray} args={[hotGeo.geo, undefined, HOT_SPRAY]} frustumCulled={false} renderOrder={5}>
        <meshStandardMaterial ref={withFadeAndHeat} color="#3a160a" emissive="#ff5a14" emissiveIntensity={1.1} roughness={0.9} flatShading transparent depthWrite={false} />
      </instancedMesh>

      <group rotation={[0.5, 0, -0.15]}>
        <instancedMesh ref={ring} args={[geometry, undefined, RING_BIG + RING_SMALL]} frustumCulled={false} renderOrder={5}>
          <meshStandardMaterial roughness={0.95} flatShading transparent />
        </instancedMesh>
        <points ref={dust} frustumCulled={false} renderOrder={5}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[data.dustPositions, 3]} />
          </bufferGeometry>
          <pointsMaterial size={0.02} color="#c88050" transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
      </group>
      </group>
    </>
  )
}
