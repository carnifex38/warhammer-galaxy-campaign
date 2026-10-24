import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PLANET_RADIUS, arriveFade } from './PlanetBody'
import { zoneSpot } from './ZoneReticle'
import { CLASSES, HULL_TINT, TEAM_COLOR, glowTexture, hullGeometry, ringTexture, windowGeometry, type Class, type Team } from './shipKit'

// Two fleets of five ships fight over a planet whose battlezones are in play, like battleships trading broadsides. Every ship steers
// for itself: it picks an enemy, closes to its preferred range, turns to bring its broadside to bear and sails past firing in rippling
// volleys of tracer bolts, then swings round (its turn rate is limited, so the turns are wide and slow) and comes back for another pass.
// They fly in three dimensions, keep clear of each other, bank as they turn, and the flagship also fires a long lance now and then.
// Hits flash on the hull; a destroyed ship burns, breaks up in a chain of explosions, and a few seconds later a replacement tears out
// of the warp at its fleet's edge and joins the fight. Everything is pooled and drawn in a handful of batches, so it stays light.
// Each battle plays small, out beside the planet at its middle level, on the side of the battlezone the players are on. It holds still
// in space where it first appears (the planet spins under it) and does not turn with the camera.

const HIDDEN = 9999
// The battle is played out in an arena (in arena units); the whole arena is then drawn small and set beside the planet.
const BOUND_X = 3.2 // the fleets stay inside an ellipsoid this wide...
const BOUND_Y = 1.15 // ...this high...
const BOUND_Z = 1.5 // ...and this deep
const MAX_BOLTS = 90
const MAX_LANCES = 4
const MAX_FLASHES = 30
const MAX_DEBRIS = 240
const PORTS = 6 // gun ports along the broadside of each ship
const WARP_S = 3.2
const DYING_S = 3.0
const ARENA_SCALE = 0.105 // the whole battle is drawn this much smaller, so the ships are small beside the planet
const ARENA_HEIGHT = 0.55 // how far out from the planet's surface the battle plays

// the five ships of a fleet and where each starts (as Team A; Team B is the mirror image on the other side)
const LINEUP: { cls: Class; x: number; z: number }[] = [
  { cls: 'flagship', x: -2.4, z: 0.1 },
  { cls: 'cruiser', x: -2.8, z: -0.7 },
  { cls: 'cruiser', x: -2.8, z: 0.9 },
  { cls: 'escort', x: -2.2, z: -1.2 },
  { cls: 'escort', x: -2.2, z: 1.2 },
]

interface Ship {
  team: Team
  cls: Class
  scale: number
  vmax: number
  turnRate: number
  range: number
  radius: number
  theta: number // heading (yaw): which way round the bow points
  pitch: number // nose up or down
  layer: number // the height band it likes to fly in, so the two fleets are not on one level
  speed: number
  roll: number // banking in the turns
  dir: THREE.Vector3 // the way the bow points
  target: number // the enemy it is fighting (index), or -1
  strafe: number // which way it turns round its target: +1 / -1 (0 = not chosen yet)
  retargetAt: number
  spawn: THREE.Vector3 // where its replacement tears out of the warp
  hp: number
  maxHp: number
  state: 'present' | 'dying' | 'gone' | 'warping'
  t: number // time in the current state
  hot: number
  phase: number
  pos: THREE.Vector3
  quat: THREE.Quaternion
  stretch: number
  volleyAt: number
  salvo: { left: number; next: number; target: number; hitOdds: number } | null
  lanceAt: number
  nextBlast: number
  wreckSpin: number
}

interface Bolt { on: boolean; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; team: Team; hit: boolean; target: number }
interface Lance { on: boolean; from: number; target: number; t: number; dur: number; team: Team }
interface Flash { on: boolean; pos: THREE.Vector3; t: number; dur: number; size: number; color: THREE.Color }

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const dummy = new THREE.Object3D()
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const colA = new THREE.Color()
const qWorld = new THREE.Quaternion()
const qWant = new THREE.Quaternion()
// the battle starts out facing the viewer, tipped so the near fleet sits low and the far fleet high: ships are seen side-on, tops showing
const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.6)
const qInv = new THREE.Quaternion()
const qRoll = new THREE.Quaternion()
const desired = new THREE.Vector3()
const dirNow = new THREE.Vector3()
const los = new THREE.Vector3()
const perp = new THREE.Vector3()
const away2 = new THREE.Vector3()
const side = new THREE.Vector3()
const FORWARD = new THREE.Vector3(0, 0, 1)
const UP = new THREE.Vector3(0, 1, 0)
const smooth = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k) }

export default function SpaceCombat({ zoneId }: { zoneId: string }) {
  const place = useRef<THREE.Group>(null) // holds the battle still in space
  const still = useRef({ q: new THREE.Quaternion(), p: new THREE.Vector3(), still: 0, since: 0 }) // how long the camera has held still, before the battle takes its place
  const fixed = useRef<{ rel: THREE.Vector3; q: THREE.Quaternion } | null>(null) // where the battle holds still in space (set on the first frame)
  const root = useRef<THREE.Group>(null)
  const hulls = useRef<THREE.InstancedMesh>(null)
  const windows = useRef<THREE.InstancedMesh>(null)
  const flashSprites = useRef<(THREE.Sprite | null)[]>([])
  const riftCore = useRef<(THREE.Sprite | null)[]>([])
  const riftRing = useRef<(THREE.Sprite | null)[]>([])
  // the battlezone this battle is fought over (its spot on the planet, which sets the side it first appears on)
  const spot = useMemo(() => zoneSpot(zoneId), [zoneId])

  // shared with every other battle and patrol (see shipKit.ts), so not disposed here
  const glow = glowTexture()
  const ring = ringTexture()
  const hullGeo = hullGeometry()
  const windowGeo = windowGeometry()

  const sim = useMemo(() => {
    const ships: Ship[] = []
    for (const team of ['A', 'B'] as Team[]) {
      LINEUP.forEach((slot) => {
        const cls = CLASSES[slot.cls]
        const sign = team === 'A' ? 1 : -1 // Team A starts on the left, heading right; Team B the other way round
        ships.push({
          team, cls: slot.cls, scale: cls.scale,
          vmax: cls.vmax, turnRate: cls.turn, range: cls.range, radius: cls.radius,
          theta: sign * Math.PI / 2 + rand(-0.2, 0.2), pitch: 0, layer: rand(-0.8, 0.8), speed: cls.vmax * 0.8, roll: 0, dir: new THREE.Vector3(sign, 0, 0),
          target: -1, strafe: 0, retargetAt: 0, spawn: new THREE.Vector3(),
          hp: cls.hp, maxHp: cls.hp, state: 'present', t: 0, hot: 0, phase: rand(0, 6.28),
          pos: new THREE.Vector3(sign * slot.x, rand(-0.7, 0.7), slot.z * sign), quat: new THREE.Quaternion(), stretch: 1,
          volleyAt: rand(0.5, cls.volley), salvo: null, lanceAt: rand(5, 11), nextBlast: 0, wreckSpin: rand(-0.4, 0.4),
        })
      })
    }
    return {
      ships,
      bolts: Array.from({ length: MAX_BOLTS }, () => ({ on: false, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1, team: 'A' as Team, hit: false, target: 0 })) as Bolt[],
      lances: Array.from({ length: MAX_LANCES }, () => ({ on: false, from: 0, target: 0, t: 0, dur: 1, team: 'A' as Team })) as Lance[],
      flashes: Array.from({ length: MAX_FLASHES }, () => ({ on: false, pos: new THREE.Vector3(), t: 0, dur: 1, size: 0.2, color: new THREE.Color() })) as Flash[],
      debrisPos: new Float32Array(MAX_DEBRIS * 3).fill(HIDDEN),
      debrisCol: new Float32Array(MAX_DEBRIS * 3),
      debrisVel: new Float32Array(MAX_DEBRIS * 3),
      debrisLife: new Float32Array(MAX_DEBRIS),
      nextDebris: 0,
      level: 0,
    }
  }, [])

  const mk = (verts: number) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3).fill(HIDDEN), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
    return g
  }
  const boltLines = useMemo(() => mk(MAX_BOLTS * 2), [])
  const boltHeads = useMemo(() => mk(MAX_BOLTS), [])
  const lanceGeo = useMemo(() => mk(MAX_LANCES * 2), [])
  const exhaustLines = useMemo(() => mk(sim.ships.length * 3 * 2), [sim])
  const exhaustGlow = useMemo(() => mk(sim.ships.length * 3), [sim])
  const debrisGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(sim.debrisPos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(sim.debrisCol, 3))
    return g
  }, [sim])
  useEffect(() => () => { boltLines.dispose(); boltHeads.dispose(); lanceGeo.dispose(); exhaustLines.dispose(); exhaustGlow.dispose(); debrisGeo.dispose() }, [boltLines, boltHeads, lanceGeo, exhaustLines, exhaustGlow, debrisGeo])

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const now = state.clock.elapsedTime
    const g = root.current
    if (!g) return
    const S = sim
    S.level += (1 - S.level) * Math.min(1, dt * 1.4)
    // The battle stays where it first appeared: out at the planet's level, on the side its battlezone was on, turned to face the camera
    // at that moment. The planet spins under it, so undo the planet's turn each frame to hold the battle still in space.
    const parent = place.current?.parent
    if (!parent) return
    parent.getWorldQuaternion(qWorld)
    if (!fixed.current) {
      // Wait until the planet has arrived AND the camera has stopped flying in, so the battle takes its angle from where the camera
      // will stay (a battle fixed while the camera was still on its way ends up edge-on). It gives up waiting after a few seconds.
      const w = still.current
      if (w.since === 0) { w.since = now; w.q.copy(state.camera.quaternion); w.p.copy(state.camera.position) }
      if (state.camera.quaternion.angleTo(w.q) > 0.0015 || state.camera.position.distanceTo(w.p) > 0.004) { w.q.copy(state.camera.quaternion); w.p.copy(state.camera.position); w.still = 0 } else w.still += dt
      if (arriveFade.value < 0.5 || (w.still < 0.5 && now - w.since < 6)) { g.visible = false; return }
      tmpA.copy(spot).applyQuaternion(qWorld)
      tmpA.y = 0
      if (tmpA.lengthSq() < 1e-4) tmpA.set(0, 0, 1)
      tmpA.normalize().multiplyScalar(PLANET_RADIUS + ARENA_HEIGHT)
      fixed.current = { rel: tmpA.clone(), q: qWant.copy(state.camera.quaternion).multiply(TILT).clone() }
    }
    qInv.copy(qWorld).invert()
    place.current!.position.copy(fixed.current.rel).applyQuaternion(qInv)
    place.current!.quaternion.copy(qInv).multiply(fixed.current.q)
    const master = S.level * arriveFade.value
    g.visible = master > 0.01
    if (!g.visible) return

    const startFlash = (pos: THREE.Vector3, size: number, dur: number, color: THREE.Color) => {
      const f = S.flashes.find((x) => !x.on) ?? S.flashes[0]
      f.on = true; f.pos.copy(pos); f.size = size; f.dur = dur; f.t = 0; f.color.copy(color)
    }
    const burst = (pos: THREE.Vector3, count: number, speed: number) => {
      for (let k = 0; k < count; k++) {
        const i = S.nextDebris++ % MAX_DEBRIS
        S.debrisPos.set([pos.x, pos.y, pos.z], i * 3)
        S.debrisVel.set([rand(-1, 1) * speed, rand(-1, 1) * speed, rand(-1, 1) * speed], i * 3)
        S.debrisLife[i] = rand(1.5, 3.4)
      }
    }
    const isShip = (s: Ship) => s.state === 'present'
    const enemiesOf = (team: Team) => S.ships.map((s, i) => ({ s, i })).filter(({ s }) => s.team !== team && isShip(s) && s.t > 1.2)
    const wound = (tgt: Ship, dmg: number) => {
      tgt.hp -= dmg
      tgt.hot = 1
      if (tgt.hp <= 0) { tgt.state = 'dying'; tgt.t = 0; tgt.nextBlast = 0; tgt.salvo = null }
    }

    // ---- ships: each one decides for itself ----
    const angDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d }
    S.ships.forEach((s) => {
      s.t += dt
      s.hot = Math.max(0, s.hot - dt * 2)
      s.stretch = 1
      const bob = Math.sin(now * 0.3 + s.phase * 2) * 0.03
      let steered = 0 // how fast it turned this frame (rad/s), for banking

      if (s.state === 'present') {
        // 1. choose (or keep) an enemy to fight: usually a near one, with some chance so the fleet does not all pile on one ship;
        //    flagships prefer the big ships. It sticks with its choice for a good while.
        let tg = s.target >= 0 ? S.ships[s.target] : null
        if (!tg || !isShip(tg) || now > s.retargetAt) {
          const foes = enemiesOf(s.team)
          if (foes.length) {
            let total = 0
            const w = foes.map(({ s: f }) => { const k = (1 / (f.pos.distanceTo(s.pos) + 0.4)) * (s.cls === 'flagship' && f.cls !== 'escort' ? 2 : 1); total += k; return k })
            let pick = Math.random() * total
            let ix = 0
            while (ix < foes.length - 1 && (pick -= w[ix]) > 0) ix++
            s.target = foes[ix].i
          } else s.target = -1
          s.retargetAt = s.target >= 0 ? now + rand(9, 16) : now + 0.5 // no enemy to fight yet (just arrived, or all down): look again soon
          s.strafe = 0
          s.layer = rand(-0.9, 0.9)
          tg = s.target >= 0 ? S.ships[s.target] : null
        }

        // 2. decide where to head: close to its range, then run past the enemy broadside-on; keep clear of every other ship and the arena's edge.
        //    Height too: it climbs or dives toward its target's level (plus its own band, so passes cross above and below), keeping clear in 3D.
        desired.set(0, 0, 0)
        dirNow.set(Math.sin(s.theta) * Math.cos(s.pitch), Math.sin(s.pitch), Math.cos(s.theta) * Math.cos(s.pitch))
        let d = 9
        let abeam = 1
        let yWant = s.layer + Math.sin(now * 0.13 + s.phase) * 0.35
        if (tg) {
          los.copy(tg.pos).sub(s.pos)
          d = los.length() || 1e-3
          yWant = tg.pos.y + s.layer * 0.9
          abeam = Math.abs(dirNow.dot(los)) / d
          los.y = 0
          const dh = los.length() || 1e-3
          los.divideScalar(dh)
          perp.set(los.z, 0, -los.x)
          if (s.strafe === 0) s.strafe = perp.dot(dirNow) >= 0 ? 1 : -1 // whichever way needs the smaller turn
          const seek = smooth((d - s.range * 1.05) / (s.range * 0.9)) // far away: turn in toward it
          const away = smooth((s.range * 0.75 - d) / (s.range * 0.45)) // too close: open the range
          desired.addScaledVector(los, seek * 1.6 - away * 1.4)
          desired.addScaledVector(perp, s.strafe * (1 - 0.5 * seek))
        } else {
          desired.set(-s.pos.x, 0, -s.pos.z).normalize()
        }
        for (const o of S.ships) {
          if (o === s || o.state === 'gone') continue
          away2.set(s.pos.x - o.pos.x, s.pos.y - o.pos.y, s.pos.z - o.pos.z)
          const dist = away2.length() || 1e-3
          const keep = (s.radius + o.radius) * 1.35
          if (dist < keep * 2.2) {
            const push = ((1 - dist / (keep * 2.2)) ** 2 * 3.2) / dist
            desired.x += away2.x * push
            desired.z += away2.z * push
            yWant += away2.y * push * 0.6 // and over or under it, not only round it
          }
          if (dist < s.radius + o.radius) s.pos.addScaledVector(away2, ((s.radius + o.radius - dist) * 0.5) / dist) // never overlap
        }
        const er = Math.hypot(s.pos.x / BOUND_X, s.pos.y / BOUND_Y, s.pos.z / BOUND_Z)
        if (er > 0.72) {
          const back = smooth((er - 0.72) / 0.4)
          desired.addScaledVector(away2.set(-s.pos.x, 0, -s.pos.z).normalize(), back * 3)
          yWant -= s.pos.y * back * 1.5
        }
        desired.addScaledVector(perp.set(dirNow.z, 0, -dirNow.x), Math.sin(now * 0.4 + s.phase) * 0.12) // a little wander

        // 3. steer: a limited turn rate, and slower when turning hard
        if (desired.lengthSq() > 1e-6) {
          const dth = angDiff(s.theta, Math.atan2(desired.x, desired.z))
          const step = Math.max(-s.turnRate * dt, Math.min(s.turnRate * dt, dth))
          s.theta += step
          steered = step / Math.max(dt, 1e-4)
          const want = s.vmax * (0.55 + 0.45 * Math.cos(Math.min(Math.abs(dth), Math.PI / 2)))
          s.speed += (want - s.speed) * Math.min(1, dt * 1.2)
        }
        // climb or dive toward the height it wants (a gentle pitch, limited like the turn)
        const pWant = Math.max(-0.5, Math.min(0.5, (yWant - s.pos.y) * 0.9))
        s.pitch += Math.max(-0.3 * dt, Math.min(0.3 * dt, pWant - s.pitch))
        s.dir.set(Math.sin(s.theta) * Math.cos(s.pitch), Math.sin(s.pitch), Math.cos(s.theta) * Math.cos(s.pitch))
        s.pos.addScaledVector(s.dir, s.speed * dt)
        s.pos.y += bob * dt * 2

        // 4. fire: the broadside guns when the enemy is abeam and in range, the lance when the flagship has a clear shot
        if (tg && s.t > 1.2) {
          if (!s.salvo && d < 4.2 && abeam < 0.45) {
            s.volleyAt -= dt
            if (s.volleyAt <= 0) {
              s.salvo = { left: PORTS, next: 0, target: s.target, hitOdds: rand(0.45, 0.7) }
              s.volleyAt = CLASSES[s.cls].volley * rand(0.7, 1.4)
            }
          }
          if (s.cls === 'flagship') {
            s.lanceAt -= dt
            if (s.lanceAt <= 0 && !s.salvo && d < 4.8) {
              const l = S.lances.find((x) => !x.on)
              if (l) { l.on = true; l.team = s.team; l.from = S.ships.indexOf(s); l.target = s.target; l.t = 0; l.dur = rand(1.4, 2.0) }
              s.lanceAt = rand(9, 15)
            }
          }
        }
        if (s.salvo) {
          s.salvo.next -= dt
          while (s.salvo && s.salvo.next <= 0) {
            const idx = PORTS - s.salvo.left
            const b = S.bolts.find((x) => !x.on)
            const tgt = S.ships[s.salvo.target]
            if (b && isShip(tgt)) {
              b.on = true; b.team = s.team; b.t = 0; b.target = s.salvo.target
              // the muzzle sits along the broadside facing the enemy
              side.crossVectors(s.dir, UP).normalize()
              los.copy(tgt.pos).sub(s.pos)
              if (side.dot(los) < 0) side.negate()
              const along = (0.7 - idx * 0.3) * 1.2 * s.scale * (s.cls === 'escort' ? 0.8 : 1)
              b.from.copy(s.pos).addScaledVector(s.dir, along).addScaledVector(side, 0.5 * s.scale * 1.15)
              b.from.y += 0.03 * s.scale
              b.hit = Math.random() < s.salvo.hitOdds
              // it hits the side of the target that faces it
              side.crossVectors(tgt.dir, UP).normalize()
              if (side.dot(los) > 0) side.negate()
              b.to.copy(tgt.pos).addScaledVector(tgt.dir, rand(-0.9, 0.9) * tgt.scale * 2).addScaledVector(side, 0.45 * tgt.scale * 1.2)
              b.to.y += rand(-0.1, 0.3) * tgt.scale
              if (!b.hit) { tmpA.copy(b.to).sub(b.from).normalize(); b.to.addScaledVector(tmpA, 0.5); b.to.y += rand(-0.18, 0.18) } // sails past
              b.dur = b.from.distanceTo(b.to) / rand(3.0, 3.8)
            }
            s.salvo.left--
            s.salvo.next = 0.09
            if (s.salvo.left <= 0) s.salvo = null
          }
        }
        s.roll += (Math.max(-0.5, Math.min(0.5, -steered * 0.9)) - s.roll) * Math.min(1, dt * 3)
      } else if (s.state === 'dying') {
        // burning and breaking up: a chain of blasts along the hull, the wreck slowing and listing, then one last big one
        s.nextBlast -= dt
        s.speed *= 1 - dt * 0.4
        s.pitch += (-0.35 - s.pitch) * Math.min(1, dt * 0.6) // the nose drops
        s.dir.set(Math.sin(s.theta) * Math.cos(s.pitch), Math.sin(s.pitch), Math.cos(s.theta) * Math.cos(s.pitch))
        s.pos.addScaledVector(s.dir, s.speed * dt)
        s.roll = s.wreckSpin * s.t
        if (s.nextBlast <= 0) {
          s.nextBlast = rand(0.12, 0.3)
          tmpB.set(rand(-0.3, 0.3), rand(-0.1, 0.3), rand(-1, 1) * 1.4).multiplyScalar(s.scale).applyQuaternion(s.quat).add(s.pos)
          startFlash(tmpB, s.scale * rand(1.2, 2.4), rand(0.5, 0.9), colA.set('#ffb060'))
          burst(tmpB, 3, 0.07)
        }
        if (s.t >= DYING_S) {
          s.state = 'gone'
          s.t = 0
          startFlash(s.pos, s.scale * 7, 1.6, colA.set('#ffd9a0'))
          burst(s.pos, s.cls === 'flagship' ? 46 : 24, 0.16)
        }
      } else if (s.state === 'gone') {
        if (s.t > 2.5) {
          // reinforcements: a rift opens at the edge of the fleet's side of the arena and the new ship slides out of it toward the fight
          const sign = s.team === 'A' ? 1 : -1
          s.spawn.set(sign * -(BOUND_X * 0.8 + rand(-0.15, 0.1)), rand(-BOUND_Y * 0.6, BOUND_Y * 0.6), rand(-BOUND_Z * 0.6, BOUND_Z * 0.6))
          s.theta = sign * Math.PI / 2
          s.pitch = 0
          s.dir.set(Math.sin(s.theta), 0, Math.cos(s.theta))
          s.pos.copy(s.spawn)
          s.speed = s.vmax * 0.6; s.roll = 0
          s.state = 'warping'; s.t = 0; s.hp = s.maxHp; s.salvo = null; s.target = -1; s.volleyAt = rand(1.5, 3); s.lanceAt = rand(6, 12)
        }
      } else if (s.state === 'warping') {
        // a rift tears open, the ship slides out of it, and the rift closes behind it
        const k = s.t / WARP_S
        const out = smooth((k - 0.3) / 0.55)
        s.pos.copy(s.spawn).addScaledVector(s.dir, out * 0.75)
        s.stretch = 1 + (1 - out) * 2.2
        if (k >= 1) { s.state = 'present'; s.t = 0 }
      }
      s.dir.set(Math.sin(s.theta) * Math.cos(s.pitch), Math.sin(s.pitch), Math.cos(s.theta) * Math.cos(s.pitch))
      s.quat.setFromUnitVectors(FORWARD, s.dir).multiply(qRoll.setFromAxisAngle(FORWARD, s.roll))
    })

    // ---- hulls, windows, engines ----
    const eg = exhaustLines.attributes.position as THREE.BufferAttribute
    const ec = exhaustLines.attributes.color as THREE.BufferAttribute
    const gp = exhaustGlow.attributes.position as THREE.BufferAttribute
    const gc = exhaustGlow.attributes.color as THREE.BufferAttribute
    const hm = hulls.current
    const wm = windows.current
    S.ships.forEach((s, i) => {
      const visible = s.state === 'present' || s.state === 'dying' || s.state === 'warping'
      const warpIn = s.state === 'warping' ? smooth((s.t / WARP_S - 0.28) / 0.35) : 1
      const sc = visible ? Math.max(s.scale * warpIn, 0.0001) : 0.0001
      dummy.position.copy(s.pos)
      dummy.quaternion.copy(s.quat)
      dummy.scale.set(sc, sc, sc * s.stretch)
      dummy.updateMatrix()
      hm?.setMatrixAt(i, dummy.matrix)
      wm?.setMatrixAt(i, dummy.matrix)
      const hurt = s.state === 'present' ? 1 - s.hp / s.maxHp : 1
      const flare = s.state === 'warping' ? 1 + (1 - warpIn) * 2 : 1
      const hc = HULL_TINT[s.team]
      const heat = s.hot * 0.5 + (s.state === 'dying' ? 0.7 : 0)
      hm?.setColorAt(i, colA.setRGB(hc.r + heat, hc.g + heat * 0.4, hc.b + heat * 0.1))
      const tc = TEAM_COLOR[s.team]
      const lit = (0.5 + hurt * 0.5 * (0.6 + 0.4 * Math.sin(now * 14 + i))) * flare * (s.state === 'dying' ? 0.4 + 0.6 * Math.random() : 1)
      wm?.setColorAt(i, colA.setRGB(tc.r * lit * 1.6, tc.g * lit * 1.6, tc.b * lit * 1.6))
      // three engine nozzles at the stern, each with a bright core and a streak behind
      for (let e = 0; e < 3; e++) {
        const idx = i * 3 + e
        const off = (e - 1) * 0.28 * sc
        tmpA.set(off, 0, -1.85 * sc).applyQuaternion(s.quat).add(s.pos)
        const burn = visible && s.state !== 'dying' ? (s.state === 'warping' ? 1.5 : 1) : 0
        const len = (0.3 + 0.02 * Math.sin(now * 2.5 + idx)) * sc * 1.8 * burn
        tmpB.set(0, 0, -1).applyQuaternion(s.quat).multiplyScalar(len).add(tmpA)
        eg.setXYZ(idx * 2, tmpA.x, tmpA.y, tmpA.z)
        eg.setXYZ(idx * 2 + 1, tmpB.x, tmpB.y, tmpB.z)
        const k = master * burn
        ec.setXYZ(idx * 2, 0.3 * k, 0.5 * k, 0.9 * k)
        ec.setXYZ(idx * 2 + 1, 0, 0, 0)
        gp.setXYZ(idx, tmpA.x, tmpA.y, tmpA.z)
        gc.setXYZ(idx, 0.3 * k, 0.5 * k, 0.95 * k)
      }
    })
    for (const m of [hm, wm]) {
      if (!m) continue
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    eg.needsUpdate = true; ec.needsUpdate = true; gp.needsUpdate = true; gc.needsUpdate = true

    // ---- warp rifts ----
    S.ships.forEach((s, i) => {
      const core = riftCore.current[i]
      const rg = riftRing.current[i]
      if (!core || !rg) return
      if (s.state !== 'warping') { core.visible = false; rg.visible = false; return }
      const k = s.t / WARP_S
      const open = smooth(k / 0.25) * (1 - smooth((k - 0.7) / 0.3))
      const flick = 0.8 + 0.2 * Math.sin(now * 31 + i * 5) * Math.sin(now * 17 + i)
      core.visible = rg.visible = true
      core.position.copy(s.spawn)
      rg.position.copy(s.spawn)
      core.scale.setScalar(s.scale * (6 + 6 * open) * flick)
      rg.scale.setScalar(s.scale * (5 + 12 * smooth(k / 0.6)))
      ;(core.material as THREE.SpriteMaterial).opacity = open * master * 0.9
      ;(rg.material as THREE.SpriteMaterial).opacity = (1 - smooth(k / 0.8)) * master * 0.8
    })

    // ---- bolts ----
    const bl = boltLines.attributes.position as THREE.BufferAttribute
    const blc = boltLines.attributes.color as THREE.BufferAttribute
    const bh = boltHeads.attributes.position as THREE.BufferAttribute
    const bhc = boltHeads.attributes.color as THREE.BufferAttribute
    S.bolts.forEach((b, i) => {
      if (!b.on) { bl.setXYZ(i * 2, HIDDEN, HIDDEN, HIDDEN); bl.setXYZ(i * 2 + 1, HIDDEN, HIDDEN, HIDDEN); bh.setXYZ(i, HIDDEN, HIDDEN, HIDDEN); return }
      b.t += dt / b.dur
      if (b.t >= 1) {
        b.on = false
        const tgt = S.ships[b.target]
        if (b.hit && isShip(tgt)) {
          startFlash(b.to, tgt.scale * 1.6, 0.4, TEAM_COLOR[b.team])
          wound(tgt, 0.28)
          if (tgt.state === 'present' && tgt.hp < tgt.maxHp * 0.4 && Math.random() < 0.3) burst(b.to, 2, 0.05)
        }
        bl.setXYZ(i * 2, HIDDEN, HIDDEN, HIDDEN); bl.setXYZ(i * 2 + 1, HIDDEN, HIDDEN, HIDDEN); bh.setXYZ(i, HIDDEN, HIDDEN, HIDDEN)
        return
      }
      tmpA.lerpVectors(b.from, b.to, b.t)
      tmpB.copy(b.to).sub(b.from).normalize().multiplyScalar(-0.1).add(tmpA)
      bl.setXYZ(i * 2, tmpA.x, tmpA.y, tmpA.z)
      bl.setXYZ(i * 2 + 1, tmpB.x, tmpB.y, tmpB.z)
      const c = TEAM_COLOR[b.team]
      const k = master * 2
      blc.setXYZ(i * 2, c.r * k, c.g * k, c.b * k)
      blc.setXYZ(i * 2 + 1, 0, 0, 0)
      bh.setXYZ(i, tmpA.x, tmpA.y, tmpA.z)
      bhc.setXYZ(i, c.r * k, c.g * k, c.b * k)
    })
    bl.needsUpdate = true; blc.needsUpdate = true; bh.needsUpdate = true; bhc.needsUpdate = true

    // ---- lances ----
    const lp = lanceGeo.attributes.position as THREE.BufferAttribute
    const lc = lanceGeo.attributes.color as THREE.BufferAttribute
    S.lances.forEach((l, i) => {
      if (!l.on) { lp.setXYZ(i * 2, HIDDEN, HIDDEN, HIDDEN); lp.setXYZ(i * 2 + 1, HIDDEN, HIDDEN, HIDDEN); return }
      l.t += dt / l.dur
      const src = S.ships[l.from]
      const tgt = S.ships[l.target]
      if (l.t >= 1 || !isShip(src) || !isShip(tgt)) {
        l.on = false
        if (l.t >= 1 && isShip(tgt)) {
          startFlash(tgt.pos, tgt.scale * 5, 0.9, colA.set('#ffe2b0'))
          burst(tgt.pos, 8, 0.1)
          wound(tgt, 3)
        }
        lp.setXYZ(i * 2, HIDDEN, HIDDEN, HIDDEN); lp.setXYZ(i * 2 + 1, HIDDEN, HIDDEN, HIDDEN)
        return
      }
      tmpA.copy(src.pos).addScaledVector(src.dir, 0.55 * src.scale * 2.4)
      lp.setXYZ(i * 2, tmpA.x, tmpA.y, tmpA.z)
      lp.setXYZ(i * 2 + 1, tgt.pos.x, tgt.pos.y, tgt.pos.z)
      // the beam charges, holds and dies away
      const k = Math.sin(Math.min(1, l.t) * Math.PI) ** 0.6 * (0.85 + 0.15 * Math.sin(now * 40)) * master
      const c = TEAM_COLOR[l.team]
      lc.setXYZ(i * 2, (c.r + 0.5) * k * 2, (c.g + 0.5) * k * 2, (c.b + 0.5) * k * 2)
      lc.setXYZ(i * 2 + 1, (c.r + 0.5) * k * 2, (c.g + 0.5) * k * 2, (c.b + 0.5) * k * 2)
    })
    lp.needsUpdate = true; lc.needsUpdate = true

    // ---- flashes ----
    S.flashes.forEach((f, i) => {
      const sp = flashSprites.current[i]
      if (!sp) return
      if (!f.on) { sp.visible = false; return }
      f.t += dt / f.dur
      if (f.t >= 1) { f.on = false; sp.visible = false; return }
      sp.visible = true
      sp.position.copy(f.pos)
      sp.scale.setScalar(f.size * (0.4 + 0.6 * Math.min(1, f.t * 3)) * 2)
      const m = sp.material as THREE.SpriteMaterial
      m.color.copy(f.color)
      m.opacity = (1 - f.t) * (1 - f.t) * master
    })

    // ---- debris ----
    const dp = debrisGeo.attributes.position as THREE.BufferAttribute
    const dc = debrisGeo.attributes.color as THREE.BufferAttribute
    for (let i = 0; i < MAX_DEBRIS; i++) {
      if (S.debrisLife[i] <= 0) continue
      S.debrisLife[i] -= dt
      if (S.debrisLife[i] <= 0) { S.debrisPos.set([HIDDEN, HIDDEN, HIDDEN], i * 3); continue }
      for (let k = 0; k < 3; k++) S.debrisPos[i * 3 + k] += S.debrisVel[i * 3 + k] * dt
      const heat = Math.min(1, S.debrisLife[i] / 1.4)
      S.debrisCol[i * 3] = 1.3 * heat * master
      S.debrisCol[i * 3 + 1] = 0.55 * heat * heat * master
      S.debrisCol[i * 3 + 2] = 0.12 * heat * heat * heat * master
    }
    dp.needsUpdate = true; dc.needsUpdate = true
  })

  // materials carry userData.keepOpacity so the planet's arrival fade does not overwrite what the fleets are doing
  const keep = { keepOpacity: true }
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const
  return (
    <group ref={place}>
    <group ref={root} scale={ARENA_SCALE} visible={false}>
      <instancedMesh ref={hulls} args={[hullGeo, undefined, sim.ships.length]} frustumCulled={false} renderOrder={7}>
        <meshStandardMaterial vertexColors roughness={0.55} metalness={0.55} flatShading userData={keep} />
      </instancedMesh>
      <instancedMesh ref={windows} args={[windowGeo, undefined, sim.ships.length]} frustumCulled={false} renderOrder={7}>
        <meshBasicMaterial vertexColors toneMapped={false} userData={keep} />
      </instancedMesh>
      <lineSegments geometry={exhaustLines} frustumCulled={false} renderOrder={8}>
        <lineBasicMaterial vertexColors {...additive} userData={keep} />
      </lineSegments>
      <points geometry={exhaustGlow} frustumCulled={false} renderOrder={8}>
        <pointsMaterial map={glow} size={0.045 * ARENA_SCALE} sizeAttenuation vertexColors {...additive} userData={keep} />
      </points>
      <lineSegments geometry={boltLines} frustumCulled={false} renderOrder={8}>
        <lineBasicMaterial vertexColors {...additive} userData={keep} />
      </lineSegments>
      <points geometry={boltHeads} frustumCulled={false} renderOrder={8}>
        <pointsMaterial map={glow} size={0.05 * ARENA_SCALE} sizeAttenuation vertexColors {...additive} userData={keep} />
      </points>
      <lineSegments geometry={lanceGeo} frustumCulled={false} renderOrder={8}>
        <lineBasicMaterial vertexColors {...additive} userData={keep} />
      </lineSegments>
      <points geometry={debrisGeo} frustumCulled={false} renderOrder={8}>
        <pointsMaterial map={glow} size={0.045 * ARENA_SCALE} sizeAttenuation vertexColors {...additive} userData={keep} />
      </points>
      {Array.from({ length: MAX_FLASHES }, (_, i) => (
        <sprite key={`f${i}`} ref={(s) => { flashSprites.current[i] = s }} visible={false} renderOrder={9}>
          <spriteMaterial map={glow} {...additive} opacity={0} userData={keep} />
        </sprite>
      ))}
      {sim.ships.map((_, i) => (
        <group key={`r${i}`}>
          <sprite ref={(s) => { riftCore.current[i] = s }} visible={false} renderOrder={9}>
            <spriteMaterial map={glow} color="#b79bff" {...additive} opacity={0} userData={keep} />
          </sprite>
          <sprite ref={(s) => { riftRing.current[i] = s }} visible={false} renderOrder={9}>
            <spriteMaterial map={ring} color="#7fb6ff" {...additive} opacity={0} userData={keep} />
          </sprite>
        </group>
      ))}
    </group>
    </group>
  )
}
