import { useMemo } from 'react'
import * as THREE from 'three'

// Hive spires standing up from Necromunda's surface in clusters, with orange windows along their sides.
// They sit inside the spinning planet group, so they turn with it.

function rng(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CLUSTERS = 16
const PER_CLUSTER = 6

export default function NecromundaSpires({ radius }: { radius: number }) {
  const data = useMemo(() => {
    const rand = rng(40001)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const scale = new THREE.Vector3()
    const pos = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const centre = new THREE.Vector3()

    const mats: THREE.Matrix4[] = []
    const windows: number[] = []

    for (let c = 0; c < CLUSTERS; c++) {
      centre.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize()
      for (let i = 0; i < PER_CLUSTER; i++) {
        dir.copy(centre).add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.28)).normalize()
        const h = 0.012 + Math.pow(rand(), 2) * 0.028
        const w = 0.006 + rand() * 0.007
        q.setFromUnitVectors(up, dir)
        pos.copy(dir).multiplyScalar(radius * 0.985 + h / 2)
        scale.set(w, h, w)
        mats.push(m.clone().compose(pos, q, scale))
        // orange windows climbing the spire
        for (let k = 0; k < 6; k++) {
          const t = rand()
          const p = dir.clone().multiplyScalar(radius * 0.99 + h * t)
          windows.push(p.x, p.y, p.z)
        }
      }
    }
    return { mats, windows: new Float32Array(windows) }
  }, [radius])

  const setMatrices = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    data.mats.forEach((mx, i) => mesh.setMatrixAt(i, mx))
    mesh.instanceMatrix.needsUpdate = true
  }

  return (
    <>
      {/* tapered towers: wide at the base, narrow at the tip */}
      <instancedMesh ref={setMatrices} args={[undefined, undefined, data.mats.length]} frustumCulled={false} renderOrder={5}>
        <cylinderGeometry args={[0.55, 1, 1, 6]} />
        <meshStandardMaterial color="#6e6650" emissive="#6f6a2a" emissiveIntensity={0.6} metalness={0.05} roughness={0.95} flatShading transparent opacity={0.8} />
      </instancedMesh>
      <points renderOrder={6}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.windows, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.008} color="#ff9a3a" transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  )
}
