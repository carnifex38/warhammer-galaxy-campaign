import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { arriveFade } from './PlanetBody'
import { CLASSES, HULL_TINT, TEAM_COLOR, glowTexture, hullGeometry, windowGeometry, type Class, type Team } from './shipKit'

// When a team controls a planet, a few of its ships keep watch: 3 (or 4 once the whole planet is held) patrol in slow, wide circuits
// round the planet, each on its own tilted orbit and at its own height, with engines burning. They fade in when the planet is won
// and out when it is lost. Same ships as the battle (see shipKit), just small and unhurried.

const SHIP_SCALE = 0.19 // how much smaller than the battle's own scale: a patrol ship is a small thing beside the planet
const MAX = 4
const LINEUP: Class[] = ['cruiser', 'escort', 'escort', 'escort']

const FORWARD = new THREE.Vector3(0, 0, 1)
const smooth = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k) }
const dummy = new THREE.Object3D()
const colA = new THREE.Color()
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const dirV = new THREE.Vector3()
const tmpC = new THREE.Vector3()

interface Orbit { u: THREE.Vector3; v: THREE.Vector3; r: number; w: number; phase: number; bob: number; cls: Class }

export default function PatrolFleet({ team, count }: { team: Team; count: number }) {
  const hulls = useRef<THREE.InstancedMesh>(null)
  const windows = useRef<THREE.InstancedMesh>(null)
  const glow = useMemo(() => glowTexture(), [])
  const hullGeo = useMemo(() => hullGeometry(), [])
  const windowGeo = useMemo(() => windowGeometry(), [])
  const level = useRef(0)
  const scales = useRef<number[]>(Array.from({ length: MAX }, () => 0))

  const orbits = useMemo<Orbit[]>(
    () =>
      Array.from({ length: MAX }, (_, i) => {
        // each ship has its own tilted orbit plane, so they cross over the planet at different angles and never share a lane
        const n = new THREE.Vector3(Math.sin(i * 2.4) * 0.45, 1, Math.cos(i * 1.7) * 0.45).normalize()
        const u = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 0, 1)).normalize()
        const v = new THREE.Vector3().crossVectors(n, u).normalize()
        return { u, v, r: 0.98 + i * 0.07, w: (0.085 - i * 0.012) * (i % 2 ? -1 : 1), phase: (i / MAX) * Math.PI * 2 + i * 0.7, bob: i * 1.9, cls: LINEUP[i] }
      }),
    [],
  )

  const exhaust = useMemo(() => {
    const mk = (verts: number) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
      return g
    }
    return { lines: mk(MAX * 3 * 2), glow: mk(MAX * 3) }
  }, [])
  useEffect(() => () => { glow.dispose(); hullGeo.dispose(); windowGeo.dispose(); exhaust.lines.dispose(); exhaust.glow.dispose() }, [glow, hullGeo, windowGeo, exhaust])

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const now = state.clock.elapsedTime
    level.current += (1 - level.current) * Math.min(1, dt * 1.2)
    const master = level.current * arriveFade.value
    const hm = hulls.current
    const wm = windows.current
    if (!hm || !wm) return
    const eg = exhaust.lines.attributes.position as THREE.BufferAttribute
    const ec = exhaust.lines.attributes.color as THREE.BufferAttribute
    const gp = exhaust.glow.attributes.position as THREE.BufferAttribute
    const gc = exhaust.glow.attributes.color as THREE.BufferAttribute
    const hc = HULL_TINT[team]
    const tc = TEAM_COLOR[team]
    orbits.forEach((o, i) => {
      // ships beyond the count slide away (shrink to nothing); new ones grow in
      const want = i < count ? 1 : 0
      scales.current[i] += (want - scales.current[i]) * Math.min(1, dt * 0.9)
      const k = scales.current[i]
      const sc = Math.max(CLASSES[o.cls].scale * SHIP_SCALE * smooth(k), 0.00001)
      const th = o.phase + now * o.w
      const rr = o.r + 0.03 * Math.sin(now * 0.3 + o.bob)
      tmpA.set(0, 0, 0).addScaledVector(o.u, Math.cos(th) * rr).addScaledVector(o.v, Math.sin(th) * rr)
      const sgn = Math.sign(o.w)
      dirV.set(0, 0, 0).addScaledVector(o.u, -Math.sin(th) * sgn).addScaledVector(o.v, Math.cos(th) * sgn).normalize()
      dummy.position.copy(tmpA)
      dummy.quaternion.setFromUnitVectors(FORWARD, dirV)
      dummy.scale.setScalar(sc)
      dummy.updateMatrix()
      hm.setMatrixAt(i, dummy.matrix)
      wm.setMatrixAt(i, dummy.matrix)
      hm.setColorAt(i, colA.setRGB(hc.r, hc.g, hc.b))
      const lit = 0.9 * (0.85 + 0.15 * Math.sin(now * 1.7 + i))
      wm.setColorAt(i, colA.setRGB(tc.r * lit * 1.6, tc.g * lit * 1.6, tc.b * lit * 1.6))
      for (let e = 0; e < 3; e++) {
        const idx = i * 3 + e
        tmpB.set((e - 1) * 0.28 * sc, 0, -1.85 * sc).applyQuaternion(dummy.quaternion).add(tmpA)
        const len = (0.3 + 0.02 * Math.sin(now * 2.5 + idx)) * sc * 1.8
        tmpC.copy(dirV).multiplyScalar(-len) // the exhaust streams out behind the ship
        eg.setXYZ(idx * 2, tmpB.x, tmpB.y, tmpB.z)
        eg.setXYZ(idx * 2 + 1, tmpB.x + tmpC.x, tmpB.y + tmpC.y, tmpB.z + tmpC.z)
        const f = master * smooth(k)
        ec.setXYZ(idx * 2, 0.3 * f, 0.5 * f, 0.9 * f)
        ec.setXYZ(idx * 2 + 1, 0, 0, 0)
        gp.setXYZ(idx, tmpB.x, tmpB.y, tmpB.z)
        gc.setXYZ(idx, 0.3 * f, 0.5 * f, 0.95 * f)
      }
    })
    hm.instanceMatrix.needsUpdate = true
    wm.instanceMatrix.needsUpdate = true
    if (hm.instanceColor) hm.instanceColor.needsUpdate = true
    if (wm.instanceColor) wm.instanceColor.needsUpdate = true
    eg.needsUpdate = true; ec.needsUpdate = true; gp.needsUpdate = true; gc.needsUpdate = true
  })

  // materials carry userData.keepOpacity so the planet's arrival fade does not overwrite what the fleet is doing
  const keep = { keepOpacity: true }
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const
  return (
    <group>
      <instancedMesh ref={hulls} args={[hullGeo, undefined, MAX]} frustumCulled={false} renderOrder={7}>
        <meshStandardMaterial vertexColors roughness={0.55} metalness={0.55} flatShading userData={keep} />
      </instancedMesh>
      <instancedMesh ref={windows} args={[windowGeo, undefined, MAX]} frustumCulled={false} renderOrder={7}>
        <meshBasicMaterial vertexColors toneMapped={false} userData={keep} />
      </instancedMesh>
      <lineSegments geometry={exhaust.lines} frustumCulled={false} renderOrder={8}>
        <lineBasicMaterial vertexColors {...additive} userData={keep} />
      </lineSegments>
      <points geometry={exhaust.glow} frustumCulled={false} renderOrder={8}>
        <pointsMaterial map={glow} size={0.009} sizeAttenuation vertexColors {...additive} userData={keep} />
      </points>
    </group>
  )
}
