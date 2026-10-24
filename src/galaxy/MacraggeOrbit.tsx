import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Ultramar's orbital defence line above Macragge: a formation of big Ultramarine-blue platforms with gold
// trim, escorted by smaller ships and a scatter of lights. It circles the planet in the same direction
// the planet turns.

function rng(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PLATFORMS = 7
const ESCORTS = 70

export default function MacraggeOrbit({ radius }: { radius: number }) {
  const fleet = useRef<THREE.Group>(null)

  const data = useMemo(() => {
    const rand = rng(1013)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const axisY = new THREE.Vector3(0, 1, 0)

    const hull: THREE.Matrix4[] = []
    const trim: THREE.Matrix4[] = []
    const lightPts: number[] = []

    for (let i = 0; i < PLATFORMS; i++) {
      const a = (i / PLATFORMS) * Math.PI * 2 + (rand() - 0.5) * 0.3
      const r = radius * (1.4 + rand() * 0.1)
      q.setFromAxisAngle(axisY, -a) // long side runs along the orbit
      const s = 0.8 + rand() * 0.6
      pos.set(r * Math.cos(a), (rand() - 0.5) * 0.04, r * Math.sin(a))
      scale.set(0.14 * s, 0.05 * s, 0.075 * s)
      hull.push(m.clone().compose(pos, q, scale))
      // a gold band along the top of each hull
      const top = pos.clone().add(new THREE.Vector3(0, 0.027 * s, 0))
      scale.set(0.142 * s, 0.006 * s, 0.077 * s)
      trim.push(m.clone().compose(top, q, scale))
      for (let k = 0; k < 14; k++) {
        lightPts.push(pos.x + (rand() - 0.5) * 0.11 * s, pos.y + (rand() - 0.2) * 0.04 * s, pos.z + (rand() - 0.5) * 0.06 * s)
      }
    }

    const escorts: THREE.Matrix4[] = []
    for (let i = 0; i < ESCORTS; i++) {
      const a = rand() * Math.PI * 2
      const r = radius * (1.2 + rand() * 0.45)
      q.setFromAxisAngle(axisY, -a + (rand() - 0.5) * 0.4)
      pos.set(r * Math.cos(a), (rand() - 0.5) * 0.12, r * Math.sin(a))
      const s = 0.6 + rand() * 0.9
      scale.set(0.03 * s, 0.009 * s, 0.012 * s)
      escorts.push(m.clone().compose(pos, q, scale))
    }

    return { hull, trim, escorts, lights: new Float32Array(lightPts) }
  }, [radius])

  const setMatrices = (mesh: THREE.InstancedMesh | null, mats: THREE.Matrix4[]) => {
    if (!mesh) return
    mats.forEach((mx, i) => mesh.setMatrixAt(i, mx))
    mesh.instanceMatrix.needsUpdate = true
  }

  // orbits the same way the planet turns (counter-clockwise seen from above), a little faster
  useFrame((_, dt) => {
    if (fleet.current) fleet.current.rotation.y += dt * 0.14
  })

  const blue = { color: '#2677c3', emissive: '#175ba3', emissiveIntensity: 1.0, metalness: 0.5, roughness: 0.4, flatShading: true, transparent: true } as const

  return (
    <group rotation={[0.35, 0, 0.12]}>
      <group ref={fleet}>
        <instancedMesh ref={(m) => setMatrices(m, data.hull)} args={[undefined, undefined, PLATFORMS]} frustumCulled={false} renderOrder={5}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial {...blue} />
        </instancedMesh>
        <instancedMesh ref={(m) => setMatrices(m, data.trim)} args={[undefined, undefined, PLATFORMS]} frustumCulled={false} renderOrder={5}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#d6b04b" metalness={0.7} roughness={0.35} flatShading transparent />
        </instancedMesh>
        <instancedMesh ref={(m) => setMatrices(m, data.escorts)} args={[undefined, undefined, ESCORTS]} frustumCulled={false} renderOrder={5}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial {...blue} color="#388fd8" emissive="#1f6ab0" />
        </instancedMesh>
        <points renderOrder={6}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[data.lights, 3]} />
          </bufferGeometry>
          <pointsMaterial size={0.014} color="#bfe4ff" transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
      </group>
    </group>
  )
}
