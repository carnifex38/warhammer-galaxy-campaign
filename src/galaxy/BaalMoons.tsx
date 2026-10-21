import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Baal's two moons: Baal Prime and the larger Baal Secundus, where the Blood Angels keep their
// fortress-monastery (shown as a small gold glow on the planet-facing side). Both orbit the way the planet turns.

function rockGeometry(seed: number) {
  const g = new THREE.IcosahedronGeometry(1, 3)
  const pos = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const n = 0.96 + 0.07 * Math.sin(v.x * 9.1 + v.y * 6.7 + v.z * 8.3 + seed) * Math.cos(v.x * 4.3 + seed)
    pos.setXYZ(i, v.x * n, v.y * n, v.z * n)
  }
  g.computeVertexNormals()
  return g
}

export default function BaalMoons({ radius }: { radius: number }) {
  const prime = useRef<THREE.Group>(null)
  const secundus = useRef<THREE.Group>(null)
  const geoA = useMemo(() => rockGeometry(1.3), [])
  const geoB = useMemo(() => rockGeometry(4.1), [])

  useFrame((_, dt) => {
    if (prime.current) prime.current.rotation.y += dt * 0.16
    if (secundus.current) secundus.current.rotation.y += dt * 0.09
  })

  return (
    <>
      {/* Baal Prime: the smaller, closer moon */}
      <group rotation={[0.2, 0, 0.1]}>
        <group ref={prime}>
          <mesh geometry={geoA} position={[radius * 1.75, 0, 0]} scale={radius * 0.12} renderOrder={5}>
            <meshStandardMaterial color="#8a7d73" roughness={0.95} transparent />
          </mesh>
        </group>
      </group>

      {/* Baal Secundus: larger, farther out, with the monastery glowing */}
      <group rotation={[-0.3, 0, -0.15]}>
        <group ref={secundus}>
          <group position={[-radius * 2.35, 0, 0]}>
            <mesh geometry={geoB} scale={radius * 0.2} renderOrder={5}>
              <meshStandardMaterial color="#9a8c80" roughness={0.95} transparent />
            </mesh>
            <points position={[radius * 0.2, 0, 0]} renderOrder={6}>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[new Float32Array([0, 0, 0, 0.012, 0.008, 0.004, -0.01, 0.01, 0]), 3]} />
              </bufferGeometry>
              <pointsMaterial size={0.03} color="#ffd27a" transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
            </points>
          </group>
        </group>
      </group>
    </>
  )
}
