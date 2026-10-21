import { useMemo } from 'react'
import * as THREE from 'three'

// The great orbital shipyard ring of Mars, bristling with spires and docking modules, with space
// elevators running down to the surface.

function rng(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SPIRES = 150
const MODULES = 36
const ELEVATORS = 6
const LIGHTS = 420

/** Stretches of the ring that have a second, inner layer: where it starts (radians) and how far it runs. */
const INNER_ARCS = [
  { start: 0.3, length: 1.25 },
  { start: 2.35, length: 0.85 },
  { start: 4.0, length: 1.6 },
]

export default function MarsShipyard({ radius }: { radius: number }) {
  const R = radius * 1.7 // the ring's radius

  const { spireMatrices, moduleMatrices, elevatorMatrices, hubMatrices, lightPositions } = useMemo(() => {
    const rand = rng(2457)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const dir = new THREE.Vector3()
    const pos = new THREE.Vector3()
    const scale = new THREE.Vector3()

    // spires: thin cones sticking out of the ring, mostly outward, some up and down
    const spireMatrices: THREE.Matrix4[] = []
    for (let i = 0; i < SPIRES; i++) {
      const a = rand() * Math.PI * 2
      const len = 0.05 + Math.pow(rand(), 2) * 0.2
      const r = rand()
      if (r < 0.55) dir.set(Math.cos(a), Math.sin(a), 0)
      else dir.set(0, 0, r < 0.78 ? 1 : -1).add(new THREE.Vector3(Math.cos(a), Math.sin(a), 0).multiplyScalar(0.25)).normalize()
      q.setFromUnitVectors(up, dir)
      pos.set(R * Math.cos(a), R * Math.sin(a), 0).addScaledVector(dir, len * 0.5)
      scale.set(1, len, 1)
      spireMatrices.push(m.clone().compose(pos, q, scale))
    }

    // docking modules: chunky boxes riding the ring
    const moduleMatrices: THREE.Matrix4[] = []
    for (let i = 0; i < MODULES; i++) {
      const a = (i / MODULES) * Math.PI * 2 + rand() * 0.1
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a + Math.PI / 2)
      pos.set(R * Math.cos(a), R * Math.sin(a), (rand() - 0.5) * 0.02)
      const s = 0.8 + rand() * 1.6
      scale.set(0.05 * s, 0.03 * s, 0.028 * s)
      moduleMatrices.push(m.clone().compose(pos, q, scale))
    }

    // space elevators: from the planet's surface out to the ring
    const elevatorMatrices: THREE.Matrix4[] = []
    const hubMatrices: THREE.Matrix4[] = []
    for (let i = 0; i < ELEVATORS; i++) {
      const a = (i / ELEVATORS) * Math.PI * 2 + 0.4
      dir.set(Math.cos(a), Math.sin(a), 0)
      q.setFromUnitVectors(up, dir)
      const len = R - radius * 0.97
      pos.copy(dir).multiplyScalar(radius * 0.97 + len / 2)
      scale.set(1, len, 1)
      elevatorMatrices.push(m.clone().compose(pos, q, scale))
      // a chunky docking hub where the elevator meets the ring
      pos.copy(dir).multiplyScalar(R)
      scale.set(0.05, 0.07, 0.04)
      hubMatrices.push(m.clone().compose(pos, q, scale))
    }

    // tiny window lights along the ring
    const lightPositions = new Float32Array(LIGHTS * 3)
    for (let i = 0; i < LIGHTS; i++) {
      const a = rand() * Math.PI * 2
      const off = (rand() - 0.5) * 0.04
      lightPositions.set([(R + off) * Math.cos(a), (R + off) * Math.sin(a), (rand() - 0.5) * 0.04], i * 3)
    }
    return { spireMatrices, moduleMatrices, elevatorMatrices, hubMatrices, lightPositions }
  }, [R, radius])

  const setMatrices = (mesh: THREE.InstancedMesh | null, mats: THREE.Matrix4[]) => {
    if (!mesh) return
    mats.forEach((mx, i) => mesh.setMatrixAt(i, mx))
    mesh.instanceMatrix.needsUpdate = true
  }

  const brass = { color: '#b59a68', metalness: 0.55, roughness: 0.45, flatShading: true, transparent: true } as const

  return (
    <>
      {/* in the planet's equatorial plane, turning with it: the elevators hold it fixed to the surface */}
      <group rotation={[Math.PI / 2, 0, 0]}>
        <group>
          <mesh renderOrder={5}>
            <torusGeometry args={[R, 0.014, 6, 200]} />
            <meshStandardMaterial {...brass} />
          </mesh>
          {/* an inner layer along only some stretches of the ring */}
          {INNER_ARCS.map((a, i) => (
            <group key={i} rotation={[0, 0, a.start]}>
              <mesh renderOrder={5}>
                <torusGeometry args={[R * 0.945, 0.011, 6, 60, a.length]} />
                <meshStandardMaterial {...brass} color="#a98f5f" />
              </mesh>
              <mesh position={[R * 0.945, 0, 0]} renderOrder={5}>
                <boxGeometry args={[0.03, 0.03, 0.03]} />
                <meshStandardMaterial {...brass} />
              </mesh>
              <mesh position={[R * 0.945 * Math.cos(a.length), R * 0.945 * Math.sin(a.length), 0]} renderOrder={5}>
                <boxGeometry args={[0.03, 0.03, 0.03]} />
                <meshStandardMaterial {...brass} />
              </mesh>
            </group>
          ))}

          <instancedMesh ref={(m) => setMatrices(m, spireMatrices)} args={[undefined, undefined, SPIRES]} frustumCulled={false} renderOrder={5}>
            <coneGeometry args={[0.006, 1, 5]} />
            <meshStandardMaterial {...brass} />
          </instancedMesh>
          <instancedMesh ref={(m) => setMatrices(m, moduleMatrices)} args={[undefined, undefined, MODULES]} frustumCulled={false} renderOrder={5}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial {...brass} />
          </instancedMesh>
          <instancedMesh ref={(m) => setMatrices(m, elevatorMatrices)} args={[undefined, undefined, ELEVATORS]} frustumCulled={false} renderOrder={5}>
            <cylinderGeometry args={[0.02, 0.003, 1, 6]} />
            <meshStandardMaterial {...brass} color="#d9c08a" />
          </instancedMesh>

          <instancedMesh ref={(m) => setMatrices(m, hubMatrices)} args={[undefined, undefined, ELEVATORS]} frustumCulled={false} renderOrder={5}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial {...brass} color="#c9ad76" />
          </instancedMesh>

          <points renderOrder={6}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[lightPositions, 3]} />
            </bufferGeometry>
            <pointsMaterial size={0.012} color="#9fe8ff" transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
          </points>
        </group>
      </group>
    </>
  )
}
