import { useMemo } from 'react'
import * as THREE from 'three'

// The Cadian Pylons: four vast psychic-ward towers spaced evenly around the planet, each tipped with a
// cold white glow. They sit inside the spinning planet group, so they turn with it.

const DIRS = [
  new THREE.Vector3(1, 1, 1),
  new THREE.Vector3(1, -1, -1),
  new THREE.Vector3(-1, 1, -1),
  new THREE.Vector3(-1, -1, 1),
].map((v) => v.normalize())

export default function CadiaPylons({ radius }: { radius: number }) {
  const HEIGHT = 0.05

  const { mats, tips } = useMemo(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const mats = DIRS.map((d) => {
      q.setFromUnitVectors(up, d)
      const pos = d.clone().multiplyScalar(radius * 0.985 + HEIGHT / 2)
      return m.clone().compose(pos, q, new THREE.Vector3(0.014, HEIGHT, 0.014))
    })
    const tips = new Float32Array(DIRS.flatMap((d) => d.clone().multiplyScalar(radius * 0.99 + HEIGHT).toArray()))
    return { mats, tips }
  }, [radius])

  const setMatrices = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return
    mats.forEach((mx, i) => mesh.setMatrixAt(i, mx))
    mesh.instanceMatrix.needsUpdate = true
  }

  return (
    <>
      {/* tapered shafts: broad at the base, narrow at the tip */}
      <instancedMesh ref={setMatrices} args={[undefined, undefined, DIRS.length]} frustumCulled={false} renderOrder={5}>
        <cylinderGeometry args={[0.45, 1, 1, 8]} />
        <meshStandardMaterial color="#8d93a3" emissive="#4a5470" emissiveIntensity={0.6} metalness={0.05} roughness={0.95} flatShading transparent opacity={0.85} />
      </instancedMesh>
      <points renderOrder={6}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[tips, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.028} color="#dff3ff" transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  )
}
