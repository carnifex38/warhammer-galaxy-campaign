import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Builder, glowTexture, rng } from './SpaceHulk'

// The Rock (Angelicasta): what is left of Caliban in the 41st millennium. A huge cratered, dark asteroid
// carrying a gothic fortress-monastery, with a cluster of engines on one end and escorts circling it.

const STONE = ['#a9b3c6', '#919bb0', '#b8c1d2', '#7e889c', '#c6cedc'].map((c) => new THREE.Color(c))
const RX = 3.1, RY = 0.9, RZ = 1.05 // rock half-sizes

/** Height of the rock's upper surface (before roughness) at ground position x, z. */
/** The rock narrows toward the engine end (+x). */
const taper = (u: number) => 1 - 0.4 * Math.min(1, Math.max(0, u))
function topY(x: number, z: number) {
  const t = taper(x / RX)
  const k = 1 - (x / RX) ** 2 - (z / (RZ * t)) ** 2
  return k > 0 ? RY * t * Math.sqrt(k) : 0
}

function buildRock() {
  const rand = rng(1999)
  const g = new THREE.IcosahedronGeometry(1, 22)
  const p = g.attributes.position
  // crater centres on the sphere
  const craters: { d: THREE.Vector3; r: number; depth: number }[] = []
  for (let i = 0; i < 26; i++) {
    const d = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize()
    if (d.y > 0.55 && Math.abs(d.x) < 0.6 && Math.abs(d.z) < 0.55) continue // keep the top clear for the fortress
    craters.push({ d, r: 0.1 + rand() * 0.25, depth: 0.05 + rand() * 0.09 })
  }
  const colors = new Float32Array(p.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    let h = 1 + 0.07 * Math.sin(v.x * 4.1 + v.y * 2.3) * Math.sin(v.z * 3.7 + v.x * 1.9) + 0.035 * Math.sin(v.x * 11 + v.z * 9) * Math.sin(v.y * 10 + v.x * 7)
    for (const c of craters) {
      const t = Math.acos(Math.min(1, v.dot(c.d))) / c.r
      if (t < 1) h -= c.depth * (1 - t * t)
      else if (t < 1.35) h += c.depth * 0.35 * (1 - (t - 1) / 0.35) // raised rim
    }
    const flat = v.y > 0.45 ? Math.min(1, (v.y - 0.45) * 3) : 0 // a flatter top for the fortress
    const tp = taper(v.x)
    p.setXYZ(i, v.x * RX * h, v.y * RY * tp * (1 - flat * 0.08) * h, v.z * RZ * tp * h)
    const shade = 0.55 + (h - 1) * 3 + 0.12 * Math.sin(v.x * 17 + v.z * 13)
    colors[i * 3] = 0.6 * shade
    colors[i * 3 + 1] = 0.58 * shade
    colors[i * 3 + 2] = 0.6 * shade
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const rock = g.toNonIndexed()
  g.dispose()
  rock.deleteAttribute('uv')
  rock.computeVertexNormals()

  // the fortress and everything else built on the rock
  const b = new Builder()
  const I = new THREE.Matrix4()
  const stone = () => STONE[Math.floor(rand() * STONE.length)]
  const dark = (k: number) => stone().clone().multiplyScalar(k)
  const win: number[] = []
  const lit = (x: number, y: number, z: number) => win.push(x, y, z)

  // curtain wall around the plateau, with a tower every few steps
  const ring: [number, number][] = []
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2
    ring.push([Math.cos(a) * 2.3, Math.sin(a) * 0.6])
  }
  ring.forEach(([x, z], i) => {
    const y = topY(x, z)
    const nx = ring[(i + 1) % ring.length]
    const ang = Math.atan2(nx[1] - z, nx[0] - x)
    b.add(b.box, I, [x, y + 0.04, z], [0.26, 0.09, 0.05], dark(0.9), [0, -ang, 0])
    if (i % 2 === 0) {
      b.add(b.box, I, [x, y + 0.1, z], [0.07, 0.2, 0.07], stone())
      b.add(b.spire, I, [x, y + 0.27, z], [0.08, 0.16, 0.08], dark(0.8))
    }
  })

  // the great cathedral: nave, transept, facade towers and the tall central spire
  const base = topY(0, 0) - 0.02
  b.add(b.box, I, [0, base + 0.16, 0], [1.1, 0.3, 0.34], stone()) // nave
  b.add(b.box, I, [0.05, base + 0.2, 0], [0.3, 0.38, 0.86], stone()) // transept
  b.add(b.box, I, [0.0, base + 0.42, 0], [0.7, 0.14, 0.24], dark(0.9)) // clerestory
  for (const s of [-1, 1]) {
    b.add(b.box, I, [-0.58, base + 0.32, s * 0.16], [0.14, 0.6, 0.14], stone())
    b.add(b.spire, I, [-0.58, base + 0.74, s * 0.16], [0.17, 0.34, 0.17], dark(0.8))
    b.add(b.box, I, [0.42, base + 0.26, s * 0.4], [0.12, 0.46, 0.12], stone())
    b.add(b.spire, I, [0.42, base + 0.6, s * 0.4], [0.15, 0.3, 0.15], dark(0.8))
  }
  b.add(b.box, I, [0.05, base + 0.55, 0], [0.2, 0.5, 0.2], stone())
  b.add(b.spire, I, [0.05, base + 1.15, 0], [0.16, 0.8, 0.16], dark(0.85)) // the central spire
  b.add(b.spire, I, [0.05, base + 1.5, 0], [0.03, 0.4, 0.03], dark(1.3))
  // flying buttresses and small turrets scattered over the roofs
  for (let i = 0; i < 34; i++) {
    const x = (rand() - 0.5) * 3.2
    const z = (rand() - 0.5) * 0.9
    const y = topY(x, z)
    const h = 0.08 + rand() * 0.22
    b.add(b.box, I, [x, y + h * 0.5, z], [0.05 + rand() * 0.05, h, 0.05 + rand() * 0.05], stone())
    if (rand() > 0.35) b.add(b.spire, I, [x, y + h + 0.06, z], [0.06, 0.14 + rand() * 0.14, 0.06], dark(0.8))
  }
  for (let i = 0; i < 70; i++) lit((rand() - 0.5) * 2.8, base + 0.06 + rand() * 0.3, (rand() - 0.5) * 0.8)

  // palace and barrack blocks stepping down the left slope
  for (let i = 0; i < 5; i++) {
    const x = -1.2 - i * 0.2
    const y = topY(x, 0.1 * (i % 2 ? 1 : -1))
    b.add(b.box, I, [x, y + 0.05, 0.1 * (i % 2 ? 1 : -1)], [0.2, 0.14 + (4 - i) * 0.03, 0.34], stone(), [0, 0.1 * i, 0])
  }

  // docking arms, hangars and gun batteries on the flanks
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = -RX * 0.65 + i * RX * 0.26
      const z = s * (RZ * Math.sqrt(Math.max(0.05, 1 - (x / RX) ** 2)) * 0.93)
      b.add(b.box, I, [x, -0.05 + (i % 3) * 0.08, z], [0.3, 0.08, 0.22], dark(0.8), [0, 0, 0])
      b.add(b.box, I, [x, 0.0, z + s * 0.12], [0.06, 0.05, 0.16], stone())
      lit(x, -0.02, z + s * 0.2)
    }
  }

  // engine block at the right-hand end
  b.add(b.box, I, [RX * 0.82, 0.02, 0], [0.5, 0.55, 0.75], dark(0.7))
  const lights: THREE.Vector3[] = []
  for (const [y, z] of [[0.12, 0.2], [0.12, -0.2], [-0.12, 0.2], [-0.12, -0.2], [0, 0]]) {
    b.add(b.tube, I, [RX * 0.82 + 0.34, y * 1.2, z * 1.1], [0.22, 0.36, 0.22], dark(0.55), [0, 0, Math.PI / 2])
    lights.push(new THREE.Vector3(RX * 0.82 + 0.54, y * 1.2, z * 1.1))
  }

  const fort = mergeGeometries(b.parts, false)
  b.parts.forEach((q) => q.dispose())
  fort.computeVertexNormals()
  const winGeo = new THREE.BufferGeometry()
  winGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(win), 3))
  return { rock, fort, winGeo, lights }
}

/** What is left of Caliban around the Rock: a wide, slowly turning field of shards, a few still glowing hot. */
function DebrisField() {
  const ref = useRef<THREE.Group>(null)
  const data = useMemo(() => {
    const rand = rng(77)
    const N = 170
    const geo = new THREE.IcosahedronGeometry(1, 0)
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#6f6a60', roughness: 1, flatShading: true }), N)
    const hot = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#2a1a12', emissive: '#ff5a14', emissiveIntensity: 1.6, roughness: 1, flatShading: true }), 14)
    const d = new THREE.Object3D()
    const place = (m: THREE.InstancedMesh, i: number, big: boolean) => {
      // a flattened shell: mostly in the galaxy plane, thinning toward the edge
      const a = rand() * Math.PI * 2
      const r = 3.1 + Math.pow(rand(), 0.7) * 4.2
      const size = (big ? 0.05 : 0.03) + Math.pow(rand(), 3) * (big ? 0.17 : 0.08)
      d.position.set(Math.cos(a) * r * 1.2, (rand() - 0.5) * (1.6 - r * 0.12), Math.sin(a) * r * 0.9)
      d.rotation.set(rand() * 6, rand() * 6, rand() * 6)
      d.scale.set(size, size * (0.6 + rand() * 0.5), size * (0.7 + rand() * 0.5))
      d.updateMatrix()
      m.setMatrixAt(i, d.matrix)
    }
    for (let i = 0; i < N; i++) place(mesh, i, true)
    for (let i = 0; i < 14; i++) place(hot, i, false)
    return { mesh, hot, geo }
  }, [])
  useEffect(() => () => { data.geo.dispose(); data.mesh.dispose(); data.hot.dispose() }, [data])
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y -= dt * 0.012
  })
  return (
    <group ref={ref}>
      <primitive object={data.mesh} />
      <primitive object={data.hot} />
    </group>
  )
}

/** A small warship circling the Rock. */
function Escort({ phase, radius, speed, glow }: { phase: number; radius: number; speed: number; glow: THREE.Texture }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((s) => {
    const t = s.clock.elapsedTime * speed + phase
    if (!ref.current) return
    ref.current.position.set(Math.cos(t) * radius * 1.5, Math.sin(t * 1.3 + phase) * 0.35 + 0.2, Math.sin(t) * radius)
    ref.current.rotation.y = -t - Math.PI / 2
  })
  return (
    <group ref={ref} scale={0.5}>
      <mesh>
        <boxGeometry args={[0.42, 0.05, 0.09]} />
        <meshStandardMaterial color="#8d95a3" roughness={0.6} metalness={0.5} />
      </mesh>
      <mesh position={[0.26, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.045, 0.12, 4]} />
        <meshStandardMaterial color="#6b7384" roughness={0.6} />
      </mesh>
      <mesh position={[-0.1, 0.05, 0]}>
        <boxGeometry args={[0.14, 0.05, 0.06]} />
        <meshStandardMaterial color="#6b7384" roughness={0.6} />
      </mesh>
      <sprite position={[-0.26, 0, 0]} scale={[0.16, 0.16, 1]}>
        <spriteMaterial map={glow} color="#b58cff" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </group>
  )
}

export default function TheRock({ position }: { position: [number, number, number] }) {
  const group = useRef<THREE.Group>(null)
  const parts = useMemo(buildRock, [])
  const glow = useMemo(glowTexture, [])
  useEffect(
    () => () => {
      parts.rock.dispose()
      parts.fort.dispose()
      parts.winGeo.dispose()
      glow.dispose()
    },
    [parts, glow],
  )
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.03
  })

  return (
    <group position={position} scale={0.3}>
      <ambientLight intensity={1.1} color="#a9b4c8" />
      <pointLight position={[-5, 7, 8]} intensity={5} decay={0} color="#fff0d8" />
      <group ref={group} rotation={[0.28, -0.35, 0.04]}>
        <mesh geometry={parts.rock} renderOrder={5}>
          <meshStandardMaterial vertexColors roughness={0.95} metalness={0.05} />
        </mesh>
        <mesh geometry={parts.fort} renderOrder={5}>
          <meshStandardMaterial vertexColors roughness={0.75} metalness={0.25} flatShading />
        </mesh>
        <points geometry={parts.winGeo}>
          <pointsMaterial color="#ffb347" size={0.045} sizeAttenuation transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
        {parts.lights.map((p, i) => (
          <sprite key={i} position={p} scale={[0.6, 0.6, 1]}>
            <spriteMaterial map={glow} color="#b070ff" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </sprite>
        ))}
      </group>
      <DebrisField />
      <Escort phase={0} radius={3.6} speed={0.12} glow={glow} />
      <Escort phase={2.1} radius={3.9} speed={0.1} glow={glow} />
      <Escort phase={4.2} radius={3.1} speed={0.14} glow={glow} />
    </group>
  )
}
