import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PLANET_RADIUS, arriveFade } from './PlanetBody'

// Fleets fighting over a planet while its battlezones are in play. Simple low-poly ships (built in code, no model files) fly slow
// orbits in opposite directions, so Team A's and Team B's lines keep passing each other. Escorts trade streams of tracer bolts, the
// capital ships fire long lances (now and then at the planet itself), hits flash on the hulls, and ships that take enough hits
// break up into a slow spray of burning debris. Every ship comes back later as reinforcements, so the battle goes on.
// Everything is pooled and drawn in a few batches, so it stays light. `zones`: how many battlezones are in play (more = bigger fleets).

const TEAM_COLOR = { A: new THREE.Color('#6fd0ff'), B: new THREE.Color('#ff8a4a') }
const MAX_ESCORTS = 12 // per team
const MAX_CAPITALS = 3 // per team
const MAX_SHIPS = (MAX_ESCORTS + MAX_CAPITALS) * 2
const MAX_BOLTS = 56
const MAX_LANCES = 5
const MAX_FLASHES = 18
const MAX_DEBRIS = 160
const HIDDEN = 9999

type Team = 'A' | 'B'

interface Ship {
  team: Team
  capital: boolean
  index: number // within its team (ships with a higher index join only when more battlezones are in play)
  u: THREE.Vector3 // the orbit's two axes
  v: THREE.Vector3
  r: number
  w: number // orbital speed (rad/s), opposite signs for the two teams
  phase: number
  bob: number
  hp: number
  maxHp: number
  alive: boolean
  respawnAt: number
  scale: number
  pos: THREE.Vector3
  dir: THREE.Vector3
  hot: number // hull glow from recent hits, 0..1
}

interface Bolt { on: boolean; from: THREE.Vector3; target: number; t: number; dur: number; team: Team }
interface Lance { on: boolean; from: number; target: number; planet: boolean; aim: THREE.Vector3; t: number; dur: number; team: Team }
interface Flash { on: boolean; pos: THREE.Vector3; t: number; dur: number; size: number; color: THREE.Color }

function glowTexture() {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(cv)
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const dummy = new THREE.Object3D()
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const FORWARD = new THREE.Vector3(0, 0, 1)

/** A low, arrowhead-shaped escort: a four-sided cone laid flat, nose along +Z. */
function escortGeometry() {
  const g = new THREE.ConeGeometry(0.5, 2, 4, 1)
  g.rotateX(Math.PI / 2)
  g.rotateZ(Math.PI / 4)
  g.scale(1, 0.4, 1)
  return g
}

/** A long, slab-sided capital ship with a blunt prow, nose along +Z. */
function capitalGeometry() {
  const hull = new THREE.BoxGeometry(0.7, 0.3, 2.6)
  const prow = new THREE.ConeGeometry(0.42, 1.1, 4, 1)
  prow.rotateX(Math.PI / 2)
  prow.rotateZ(Math.PI / 4)
  prow.scale(1, 0.55, 1)
  prow.translate(0, 0, 1.85)
  const bridge = new THREE.BoxGeometry(0.28, 0.3, 0.7)
  bridge.translate(0, 0.25, -0.7)
  const parts = [hull, prow, bridge].map((p) => p.toNonIndexed())
  const pos: number[] = []
  const nor: number[] = []
  for (const p of parts) {
    pos.push(...(p.attributes.position.array as Float32Array))
    nor.push(...(p.attributes.normal.array as Float32Array))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  return g
}

export default function SpaceCombat({ zones }: { zones: number }) {
  const root = useRef<THREE.Group>(null)
  const escorts = useRef<THREE.InstancedMesh>(null)
  const capitals = useRef<THREE.InstancedMesh>(null)
  const engines = useRef<THREE.Points>(null)
  const bolts = useRef<THREE.Points>(null)
  const debris = useRef<THREE.Points>(null)
  const lances = useRef<THREE.LineSegments>(null)
  const flashSprites = useRef<(THREE.Sprite | null)[]>([])
  const zonesRef = useRef(zones)
  zonesRef.current = zones

  const glow = useMemo(glowTexture, [])
  const escortGeo = useMemo(escortGeometry, [])
  const capitalGeo = useMemo(capitalGeometry, [])
  useEffect(() => () => { glow.dispose(); escortGeo.dispose(); capitalGeo.dispose() }, [glow, escortGeo, capitalGeo])

  const sim = useMemo(() => {
    const ships: Ship[] = []
    for (const team of ['A', 'B'] as Team[]) {
      const dirSign = team === 'A' ? 1 : -1
      for (let i = 0; i < MAX_ESCORTS + MAX_CAPITALS; i++) {
        const capital = i >= MAX_ESCORTS
        // each ship gets its own tilted orbit plane
        const n = new THREE.Vector3(rand(-1.4, 1.4), rand(0.4, 1), rand(-1.4, 1.4)).normalize()
        const u = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 0, 1)).normalize()
        const v = new THREE.Vector3().crossVectors(n, u).normalize()
        ships.push({
          team, capital, index: capital ? i - MAX_ESCORTS : i, u, v,
          r: capital ? rand(1.2, 1.6) : rand(0.95, 1.5),
          w: dirSign * (capital ? rand(0.06, 0.1) : rand(0.12, 0.22)),
          phase: rand(0, Math.PI * 2), bob: rand(0, 6), hp: 0, maxHp: capital ? 9 : 3, alive: true, respawnAt: 0, scale: 0,
          pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), hot: 0,
        })
      }
    }
    for (const s of ships) s.hp = s.maxHp
    const boltList: Bolt[] = Array.from({ length: MAX_BOLTS }, () => ({ on: false, from: new THREE.Vector3(), target: 0, t: 0, dur: 0.4, team: 'A' as Team }))
    const lanceList: Lance[] = Array.from({ length: MAX_LANCES }, () => ({ on: false, from: 0, target: 0, planet: false, aim: new THREE.Vector3(), t: 0, dur: 0.7, team: 'A' as Team }))
    const flashList: Flash[] = Array.from({ length: MAX_FLASHES }, () => ({ on: false, pos: new THREE.Vector3(), t: 0, dur: 0.5, size: 0.2, color: new THREE.Color() }))
    const debrisPos = new Float32Array(MAX_DEBRIS * 3).fill(HIDDEN)
    const debrisCol = new Float32Array(MAX_DEBRIS * 3)
    const debrisVel = new Float32Array(MAX_DEBRIS * 3)
    const debrisLife = new Float32Array(MAX_DEBRIS)
    return { ships, boltList, lanceList, flashList, debrisPos, debrisCol, debrisVel, debrisLife, nextDebris: 0, fireClock: 0, lanceClock: 0, level: 0, t0: 0, bombClock: 0 }
  }, [])

  const engineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SHIPS * 3).fill(HIDDEN), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_SHIPS * 3), 3))
    return g
  }, [])
  const boltGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_BOLTS * 3).fill(HIDDEN), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_BOLTS * 3), 3))
    return g
  }, [])
  const debrisGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(sim.debrisPos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(sim.debrisCol, 3))
    return g
  }, [sim])
  const lanceGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LANCES * 6).fill(HIDDEN), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_LANCES * 6), 3))
    return g
  }, [])
  useEffect(() => () => { engineGeo.dispose(); boltGeo.dispose(); debrisGeo.dispose(); lanceGeo.dispose() }, [engineGeo, boltGeo, debrisGeo, lanceGeo])

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const now = state.clock.elapsedTime
    const g = root.current
    if (!g) return
    const S = sim
    const active = zonesRef.current > 0
    S.level += ((active ? 1 : 0) - S.level) * Math.min(1, dt * 1.6)
    const master = S.level * arriveFade.value
    g.visible = master > 0.01
    if (!g.visible) return

    const n = Math.max(1, zonesRef.current)
    const escortsOn = Math.min(MAX_ESCORTS, 3 + 2 * n)
    const capitalsOn = Math.min(MAX_CAPITALS, 1 + Math.floor(n / 2))

    // ---- move the ships ----
    const alive: Record<Team, number[]> = { A: [], B: [] }
    S.ships.forEach((s, i) => {
      const enabled = s.index < (s.capital ? capitalsOn : escortsOn)
      if (!s.alive && now >= s.respawnAt) { s.alive = true; s.hp = s.maxHp }
      const want = enabled && s.alive ? 1 : 0
      s.scale += (want - s.scale) * Math.min(1, dt * (want ? 0.9 : 6))
      const th = s.phase + now * s.w
      const rr = s.r + 0.06 * Math.sin(now * 0.4 + s.bob)
      s.pos.set(0, 0, 0).addScaledVector(s.u, Math.cos(th) * rr).addScaledVector(s.v, Math.sin(th) * rr)
      s.dir.set(0, 0, 0).addScaledVector(s.u, -Math.sin(th) * Math.sign(s.w)).addScaledVector(s.v, Math.cos(th) * Math.sign(s.w)).normalize()
      s.hot = Math.max(0, s.hot - dt * 2.5)
      if (enabled && s.alive && s.scale > 0.6) alive[s.team].push(i)
    })

    // ---- draw the ships and their engines ----
    const eng = engineGeo.attributes.position as THREE.BufferAttribute
    const engCol = engineGeo.attributes.color as THREE.BufferAttribute
    S.ships.forEach((s, i) => {
      const mesh = s.capital ? capitals.current : escorts.current
      if (!mesh) return
      const slot = s.capital ? (s.team === 'A' ? 0 : MAX_CAPITALS) + s.index : (s.team === 'A' ? 0 : MAX_ESCORTS) + s.index
      dummy.position.copy(s.pos)
      dummy.quaternion.setFromUnitVectors(FORWARD, s.dir)
      const size = (s.capital ? 0.075 : 0.055) * s.scale
      dummy.scale.setScalar(Math.max(size, 0.0001))
      dummy.updateMatrix()
      mesh.setMatrixAt(slot, dummy.matrix)
      const c = TEAM_COLOR[s.team]
      tmpA.set(c.r, c.g, c.b).multiplyScalar(0.22 + s.hot * 1.4)
      mesh.setColorAt(slot, new THREE.Color(0.8 + tmpA.x, 0.82 + tmpA.y, 0.86 + tmpA.z)) // grey hulls, tinted by the team and by hits
      // the engine glow sits at the tail
      tmpB.copy(s.pos).addScaledVector(s.dir, -(s.capital ? 0.2 : 0.1) * s.scale)
      eng.setXYZ(i, tmpB.x, tmpB.y, tmpB.z)
      const k = s.scale * master
      engCol.setXYZ(i, c.r * k, c.g * k, c.b * k)
    })
    for (const m of [escorts.current, capitals.current]) {
      if (!m) continue
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    eng.needsUpdate = true
    engCol.needsUpdate = true

    // ---- weapons: tracer bolts between escorts, lances from the capitals ----
    S.fireClock += dt * (5 + 4 * n)
    while (S.fireClock >= 1) {
      S.fireClock -= 1
      const team: Team = Math.random() < 0.5 ? 'A' : 'B'
      const foes = alive[team === 'A' ? 'B' : 'A']
      const mine = alive[team]
      if (!foes.length || !mine.length) continue
      const b = S.boltList.find((x) => !x.on)
      if (!b) break
      const from = S.ships[mine[Math.floor(Math.random() * mine.length)]]
      b.on = true
      b.team = team
      b.from.copy(from.pos)
      b.target = foes[Math.floor(Math.random() * foes.length)]
      b.t = 0
      b.dur = rand(0.45, 0.9)
    }
    S.lanceClock += dt * (0.5 + 0.25 * n)
    S.bombClock += dt
    while (S.lanceClock >= 1) {
      S.lanceClock -= 1
      const team: Team = Math.random() < 0.5 ? 'A' : 'B'
      const caps = alive[team].filter((i) => S.ships[i].capital)
      const foes = alive[team === 'A' ? 'B' : 'A']
      const l = S.lanceList.find((x) => !x.on)
      if (!l || !caps.length) continue
      l.on = true
      l.team = team
      l.from = caps[Math.floor(Math.random() * caps.length)]
      // now and then a capital ship fires on the planet instead of a ship
      l.planet = (S.bombClock > 9 || !foes.length) && Math.random() < 0.6
      if (l.planet) {
        S.bombClock = 0
        // a point on the planet's surface under the ship, nudged a little to either side
        l.aim.copy(S.ships[l.from].pos).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), rand(-0.5, 0.5)).setLength(PLANET_RADIUS * 1.01)
      } else l.target = foes[Math.floor(Math.random() * foes.length)]
      l.t = 0
      l.dur = rand(0.8, 1.3)
    }

    const startFlash = (pos: THREE.Vector3, size: number, dur: number, color: THREE.Color) => {
      const f = S.flashList.find((x) => !x.on) ?? S.flashList[0]
      f.on = true; f.pos.copy(pos); f.size = size; f.dur = dur; f.t = 0; f.color.copy(color)
    }
    const hit = (idx: number, team: Team, dmg: number, big: boolean) => {
      const s = S.ships[idx]
      if (!s.alive) return
      s.hp -= dmg
      s.hot = 1
      startFlash(s.pos, big ? 0.34 : 0.16, big ? 0.7 : 0.35, TEAM_COLOR[team])
      if (s.hp <= 0) {
        s.alive = false
        s.respawnAt = now + rand(7, 13)
        startFlash(s.pos, s.capital ? 0.9 : 0.45, s.capital ? 1.6 : 1.0, new THREE.Color('#ffb060'))
        const count = s.capital ? 26 : 10
        for (let k = 0; k < count; k++) {
          const i = S.nextDebris++ % MAX_DEBRIS
          S.debrisPos.set([s.pos.x, s.pos.y, s.pos.z], i * 3)
          S.debrisVel.set([rand(-1, 1) * 0.09 + s.dir.x * 0.05, rand(-1, 1) * 0.09 + s.dir.y * 0.05, rand(-1, 1) * 0.09 + s.dir.z * 0.05], i * 3)
          S.debrisLife[i] = rand(1.6, 3.2)
        }
      }
    }

    // bolts
    const bp = boltGeo.attributes.position as THREE.BufferAttribute
    const bc = boltGeo.attributes.color as THREE.BufferAttribute
    S.boltList.forEach((b, i) => {
      if (!b.on) { bp.setXYZ(i, HIDDEN, HIDDEN, HIDDEN); return }
      b.t += dt / b.dur
      const tgt = S.ships[b.target]
      if (b.t >= 1) {
        b.on = false
        // most shots glance off the shields; only some wound
        if (tgt.alive && tgt.scale > 0.3) {
          if (Math.random() < 0.07) hit(b.target, b.team, 1, false)
          else { tgt.hot = Math.max(tgt.hot, 0.5); startFlash(tgt.pos, 0.07, 0.25, TEAM_COLOR[b.team]) }
        }
        bp.setXYZ(i, HIDDEN, HIDDEN, HIDDEN)
        return
      }
      tmpA.lerpVectors(b.from, tgt.pos, b.t)
      bp.setXYZ(i, tmpA.x, tmpA.y, tmpA.z)
      const c = TEAM_COLOR[b.team]
      bc.setXYZ(i, c.r * master * 1.5, c.g * master * 1.5, c.b * master * 1.5)
    })
    bp.needsUpdate = true
    bc.needsUpdate = true

    // lances
    const lp = lanceGeo.attributes.position as THREE.BufferAttribute
    const lc = lanceGeo.attributes.color as THREE.BufferAttribute
    S.lanceList.forEach((l, i) => {
      if (!l.on) { lp.setXYZ(i * 2, HIDDEN, HIDDEN, HIDDEN); lp.setXYZ(i * 2 + 1, HIDDEN, HIDDEN, HIDDEN); return }
      l.t += dt / l.dur
      const src = S.ships[l.from]
      if (l.t >= 1 || !src.alive) {
        l.on = false
        if (l.t >= 1) {
          if (l.planet) startFlash(l.aim, 0.7, 3.2, new THREE.Color('#ff7a30')) // a glowing scar blooms where the lance struck the surface
          else if (S.ships[l.target].alive) {
            if (Math.random() < 0.4) hit(l.target, l.team, 3, true)
            else startFlash(S.ships[l.target].pos, 0.22, 0.5, TEAM_COLOR[l.team]) // a near miss
          }
        }
        lp.setXYZ(i * 2, HIDDEN, HIDDEN, HIDDEN); lp.setXYZ(i * 2 + 1, HIDDEN, HIDDEN, HIDDEN)
        return
      }
      const end = l.planet ? l.aim : S.ships[l.target].pos
      lp.setXYZ(i * 2, src.pos.x, src.pos.y, src.pos.z)
      lp.setXYZ(i * 2 + 1, end.x, end.y, end.z)
      // the beam builds, holds and dies away
      const k = Math.sin(Math.min(1, l.t) * Math.PI) * (0.85 + 0.15 * Math.sin(now * 40)) * master
      const c = TEAM_COLOR[l.team]
      lc.setXYZ(i * 2, c.r * k * 2, c.g * k * 2, c.b * k * 2)
      lc.setXYZ(i * 2 + 1, c.r * k * 2, c.g * k * 2, c.b * k * 2)
    })
    lp.needsUpdate = true
    lc.needsUpdate = true

    // flashes
    S.flashList.forEach((f, i) => {
      const sp = flashSprites.current[i]
      if (!sp) return
      if (!f.on) { sp.visible = false; return }
      f.t += dt / f.dur
      if (f.t >= 1) { f.on = false; sp.visible = false; return }
      sp.visible = true
      sp.position.copy(f.pos)
      const grow = 0.4 + 0.6 * Math.min(1, f.t * 3)
      sp.scale.setScalar(f.size * grow * 2)
      const m = sp.material as THREE.SpriteMaterial
      m.color.copy(f.color)
      m.opacity = (1 - f.t) * (1 - f.t) * master
    })

    // debris: slow, burning, fading
    const dp = debrisGeo.attributes.position as THREE.BufferAttribute
    const dc = debrisGeo.attributes.color as THREE.BufferAttribute
    for (let i = 0; i < MAX_DEBRIS; i++) {
      if (S.debrisLife[i] <= 0) continue
      S.debrisLife[i] -= dt
      if (S.debrisLife[i] <= 0) { S.debrisPos.set([HIDDEN, HIDDEN, HIDDEN], i * 3); continue }
      for (let k = 0; k < 3; k++) S.debrisPos[i * 3 + k] += S.debrisVel[i * 3 + k] * dt
      const heat = Math.min(1, S.debrisLife[i] / 1.4)
      S.debrisCol[i * 3] = 1.2 * heat * master
      S.debrisCol[i * 3 + 1] = 0.5 * heat * heat * master
      S.debrisCol[i * 3 + 2] = 0.12 * heat * heat * heat * master
    }
    dp.needsUpdate = true
    dc.needsUpdate = true
  })

  // materials carry userData.keepOpacity so the planet's arrival fade does not overwrite what the fleet is doing
  const keep = { keepOpacity: true }
  return (
    <group ref={root} visible={false}>
      <ambientLight intensity={1.1} color="#9aa6c8" />
      <directionalLight position={[-4, 1.4, 2.2]} intensity={2.6} color="#ffe6c4" />
      <instancedMesh ref={escorts} args={[escortGeo, undefined, MAX_ESCORTS * 2]} frustumCulled={false} renderOrder={7}>
        <meshStandardMaterial roughness={0.6} metalness={0.3} flatShading emissive="#2a3040" userData={keep} />
      </instancedMesh>
      <instancedMesh ref={capitals} args={[capitalGeo, undefined, MAX_CAPITALS * 2]} frustumCulled={false} renderOrder={7}>
        <meshStandardMaterial roughness={0.65} metalness={0.3} flatShading emissive="#2a3040" userData={keep} />
      </instancedMesh>
      <points ref={engines} geometry={engineGeo} frustumCulled={false} renderOrder={8}>
        <pointsMaterial map={glow} size={0.13} sizeAttenuation vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} userData={keep} />
      </points>
      <points ref={bolts} geometry={boltGeo} frustumCulled={false} renderOrder={8}>
        <pointsMaterial map={glow} size={0.12} sizeAttenuation vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} userData={keep} />
      </points>
      <lineSegments ref={lances} geometry={lanceGeo} frustumCulled={false} renderOrder={8}>
        <lineBasicMaterial vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} userData={keep} />
      </lineSegments>
      <points ref={debris} geometry={debrisGeo} frustumCulled={false} renderOrder={8}>
        <pointsMaterial map={glow} size={0.04} sizeAttenuation vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} userData={keep} />
      </points>
      {Array.from({ length: MAX_FLASHES }, (_, i) => (
        <sprite key={i} ref={(s) => { flashSprites.current[i] = s }} visible={false} renderOrder={9}>
          <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0} userData={keep} />
        </sprite>
      ))}
    </group>
  )
}
