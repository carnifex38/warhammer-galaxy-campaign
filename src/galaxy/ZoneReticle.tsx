import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// A green targeting reticle that locks onto a battlezone's own point on the planet when it is pointed at. Every battlezone has a
// fixed point on the planet's surface (worked out from its id, so it is the same every time, and it turns with the planet). The
// reticle itself is drawn flat on the screen over that point, like a HUD, with long guide lines to the top, bottom and sides of
// the map; if the point is on the far side the planet turns to bring it into view. Explosions go off on the surface all round the
// point (flash, fireball, shock ring and flying embers) as cards lying on the surface, so the planet hides any behind it.

const GREEN = '#62ff9d'
const RADIUS = 0.62 // the planet's radius (PLANET_RADIUS in Galaxy3D)
const BOOMS = 14 // explosions that can be going at once
const EMBERS = 8 // embers thrown out by each explosion
const SPREAD = 0.2 // how far from the point they go off (radians over the surface)

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * The battlezone's point on the planet: a direction from its centre, in the planet's own frame, always the same for the same id.
 * (Kept between about 25 degrees south and 40 north, so it is never at a pole and can always be turned to face the viewer.)
 */
export function zoneSpot(zoneId: string): THREE.Vector3 {
  const h = hash(zoneId)
  const lon = ((h & 0xfff) / 4095) * Math.PI * 2
  const lat = THREE.MathUtils.degToRad(-25 + (((h >>> 12) & 0xfff) / 4095) * 65)
  return new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon))
}

/** Draw a shape twice: a dark edge first, then the green line, so it stays readable over a bright planet. */
function inked(c: CanvasRenderingContext2D, width: number, shape: () => void) {
  c.strokeStyle = 'rgba(0, 24, 8, 0.75)'
  c.lineWidth = width + 5
  shape()
  c.strokeStyle = GREEN
  c.lineWidth = width
  shape()
}

function drawCross(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 256
  const c = cv.getContext('2d')!
  c.translate(128, 128)
  c.lineCap = 'square'
  // the crosshair: four arms with a gap in the middle, and a tick out on each arm
  for (let i = 0; i < 4; i++) {
    c.save()
    c.rotate((i * Math.PI) / 2)
    inked(c, 4, () => { c.beginPath(); c.moveTo(0, -22); c.lineTo(0, -64); c.stroke() })
    inked(c, 4, () => { c.beginPath(); c.moveTo(-8, -88); c.lineTo(8, -88); c.stroke() })
    c.restore()
  }
  c.fillStyle = 'rgba(0, 24, 8, 0.75)'
  c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill()
  c.fillStyle = GREEN
  c.beginPath(); c.arc(0, 0, 3.5, 0, Math.PI * 2); c.fill()
  // corner brackets
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    inked(c, 5, () => { c.beginPath(); c.moveTo(sx * 112, sy * 82); c.lineTo(sx * 112, sy * 112); c.lineTo(sx * 82, sy * 112); c.stroke() })
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function drawRing(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 256
  const c = cv.getContext('2d')!
  c.translate(128, 128)
  c.setLineDash([16, 12])
  inked(c, 3, () => { c.beginPath(); c.arc(0, 0, 100, 0, Math.PI * 2); c.stroke() })
  c.setLineDash([])
  for (let i = 0; i < 3; i++) { // three bright arcs on the ring
    inked(c, 6, () => { c.beginPath(); c.arc(0, 0, 100, i * 2.094 + 0.2, i * 2.094 + 0.75); c.stroke() })
  }
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function drawGlow(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const c = cv.getContext('2d')!
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.2, 'rgba(255,236,170,0.95)')
  g.addColorStop(0.5, 'rgba(255,140,40,0.55)')
  g.addColorStop(1, 'rgba(255,60,0,0)')
  c.fillStyle = g
  c.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function drawShock(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const c = cv.getContext('2d')!
  const g = c.createRadialGradient(64, 64, 46, 64, 64, 63)
  g.addColorStop(0, 'rgba(255,200,120,0)')
  g.addColorStop(0.8, 'rgba(255,215,150,0.95)')
  g.addColorStop(0.9, 'rgba(255,150,60,0.35)')
  g.addColorStop(1, 'rgba(255,120,40,0)')
  c.fillStyle = g
  c.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

interface Boom { t0: number; dir: THREE.Vector3; size: number; life: number; flat: THREE.Quaternion }

export function ZoneReticle({ zone }: { zone: { id: string; name: string } | null }) {
  const root = useRef<THREE.Group>(null)
  const cross = useRef<THREE.Sprite>(null)
  const ring = useRef<THREE.Sprite>(null)
  const label = useRef<THREE.Sprite>(null)
  // `spot` is a point on the planet's surface, in the planet's own frame (so it turns with the planet)
  const st = useRef({ id: '', name: '', level: 0, since: 0, spot: new THREE.Vector3(0, 0, 1), active: false, seekUntil: 0 })
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), toCam: new THREE.Vector3(), centre: new THREE.Vector3(), down: new THREE.Vector3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), world: new THREE.Vector3(), right: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), ax: new THREE.Vector3(), p: new THREE.Vector3(), t: new THREE.Vector3(), m: new THREE.Matrix4() }), [])
  // the explosions
  const boomGroup = useRef<THREE.Group>(null)
  const flash = useRef<(THREE.Mesh | null)[]>([])
  const fire = useRef<(THREE.Mesh | null)[]>([])
  const shock = useRef<(THREE.Mesh | null)[]>([])
  const booms = useRef<Boom[]>(Array.from({ length: BOOMS }, () => ({ t0: -1, dir: new THREE.Vector3(0, 0, 1), size: 0.1, life: 1, flat: new THREE.Quaternion() })))
  const boomClock = useRef({ next: 0, burst: 0, ember: 0 })
  const glowTex = useMemo(() => drawGlow(), [])
  const shockTex = useMemo(() => drawShock(), [])
  const embers = useMemo(() => {
    const n = BOOMS * EMBERS
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    return { geo, vel: new Float32Array(n * 3), born: new Float32Array(n).fill(-10), life: new Float32Array(n).fill(1) }
  }, [])
  useEffect(() => () => { glowTex.dispose(); shockTex.dispose(); embers.geo.dispose() }, [glowTex, shockTex, embers])
  const crossTex = useMemo(() => drawCross(), [])
  const ringTex = useMemo(() => drawRing(), [])
  const labelCanvas = useMemo(() => { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; return cv }, [])
  const labelTex = useMemo(() => { const t = new THREE.CanvasTexture(labelCanvas); t.colorSpace = THREE.SRGBColorSpace; return t }, [labelCanvas])
  useEffect(() => () => { crossTex.dispose(); ringTex.dispose(); labelTex.dispose() }, [crossTex, ringTex, labelTex])

  // the guide lines are plain page elements laid over the map (made here, moved every frame, removed when the reticle goes)
  const gl = useThree((t) => t.gl)
  const lines = useRef<{ box: HTMLDivElement; up: HTMLDivElement; down: HTMLDivElement; left: HTMLDivElement; right: HTMLDivElement } | null>(null)
  useEffect(() => {
    const host = gl.domElement.parentElement
    if (!host) return
    const box = document.createElement('div')
    box.className = 'zone-lines'
    const mk = (cls: string) => { const d = document.createElement('div'); d.className = `zone-line ${cls}`; box.appendChild(d); return d }
    lines.current = { box, up: mk('up'), down: mk('down'), left: mk('left'), right: mk('right') }
    host.appendChild(box)
    return () => { box.remove(); lines.current = null }
  }, [gl])

  useFrame((s, dt) => {
    const g = root.current
    if (!g) return
    const k = st.current
    const now = s.clock.elapsedTime
    const parent = g.parent // the planet's spinning group
    if (!parent) return
    parent.getWorldQuaternion(tmp.q)
    tmp.qi.copy(tmp.q).invert()
    parent.getWorldPosition(tmp.centre)
    tmp.toCam.copy(s.camera.position).sub(tmp.centre).normalize() // from the planet toward the viewer

    /** Lock onto the battlezone's point (fixed in the planet's own frame). */
    const lock = () => {
      k.spot.copy(zoneSpot(k.id))
      k.since = now
      k.seekUntil = now + 4 // if the point is on the far side, turn the planet to bring it round
      boomClock.current.burst = 6 // a quick volley as it locks on
    }

    // a battlezone is pointed at (a different one, or the same one again after pointing away): pick its point. That point is then
    // followed for as long as it stays pointed at, even while it is behind the planet.
    if (zone && (zone.id !== k.id || !k.active)) {
      k.id = zone.id
      lock()
      if (zone.name !== k.name) {
        k.name = zone.name
        const c = labelCanvas.getContext('2d')!
        c.clearRect(0, 0, 512, 96)
        c.fillStyle = GREEN
        c.strokeStyle = 'rgba(0, 24, 8, 0.85)'
        c.lineWidth = 7
        c.lineJoin = 'round'
        c.textAlign = 'center'
        c.font = 'bold 34px ui-monospace, Consolas, monospace'
        c.strokeText(zone.name.toUpperCase(), 256, 38)
        c.fillText(zone.name.toUpperCase(), 256, 38)
        c.font = '22px ui-monospace, Consolas, monospace'
        c.strokeText('TARGET ACQUIRED', 256, 74)
        c.fillText('TARGET ACQUIRED', 256, 74)
        labelTex.needsUpdate = true
      }
    }
    if (zone) k.active = true
    else if (k.level < 0.05) k.active = false // only once it has faded away, so a flicker of the pointer keeps the same point
    k.level += ((zone ? 1 : 0) - k.level) * Math.min(1, dt * 7)

    // ---- explosions all round the point, on the surface ----
    const bc = boomClock.current
    tmp.world.copy(k.spot).applyQuaternion(tmp.q)
    const faceNow = tmp.world.dot(tmp.toCam)
    if (k.level > 0.4 && faceNow > -0.25 && now >= bc.next) {
      const slot = booms.current.find((b) => b.t0 < 0 || now - b.t0 > b.life)
      if (slot) {
        // a spot a stable-looking random distance and way round the point
        const ang = Math.random() * Math.PI * 2
        const rho = 0.03 + Math.random() * SPREAD
        tmp.u.set(0, 1, 0).cross(k.spot)
        if (tmp.u.lengthSq() < 1e-6) tmp.u.set(1, 0, 0)
        tmp.u.normalize()
        tmp.v.crossVectors(k.spot, tmp.u)
        tmp.ax.copy(tmp.u).multiplyScalar(Math.cos(ang)).addScaledVector(tmp.v, Math.sin(ang))
        slot.dir.copy(k.spot).applyAxisAngle(tmp.ax, rho)
        // the card lies on the surface, lined up with the planet's north
        tmp.u.set(0, 1, 0).cross(slot.dir)
        if (tmp.u.lengthSq() < 1e-6) tmp.u.set(1, 0, 0)
        tmp.u.normalize()
        tmp.v.crossVectors(slot.dir, tmp.u)
        slot.flat.setFromRotationMatrix(tmp.m.makeBasis(tmp.u, tmp.v, slot.dir))
        slot.t0 = now
        slot.size = 0.022 + Math.random() * 0.035
        slot.life = 0.8 + Math.random() * 0.7
        // embers: thrown up off the surface and a little sideways, then pulled back
        const pos = embers.geo.getAttribute('position') as THREE.BufferAttribute
        for (let e = 0; e < EMBERS; e++) {
          const i = bc.ember++ % (BOOMS * EMBERS)
          tmp.t.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(slot.dir).normalize()
          const up = (0.25 + Math.random() * 0.45) * (slot.size / 0.1)
          const side = 0.1 + Math.random() * 0.2
          embers.vel[i * 3] = slot.dir.x * up + tmp.t.x * side
          embers.vel[i * 3 + 1] = slot.dir.y * up + tmp.t.y * side
          embers.vel[i * 3 + 2] = slot.dir.z * up + tmp.t.z * side
          embers.born[i] = now
          embers.life[i] = 0.6 + Math.random() * 0.6
          pos.setXYZ(i, slot.dir.x * RADIUS, slot.dir.y * RADIUS, slot.dir.z * RADIUS)
        }
      }
      bc.next = now + (bc.burst > 0 ? 0.07 : 0.1 + Math.random() * 0.3)
      if (bc.burst > 0) bc.burst--
    }
    let anyBoom = false
    booms.current.forEach((b, i) => {
      const fl = flash.current[i], fi = fire.current[i], sh = shock.current[i]
      if (!fl || !fi || !sh) return
      const u = b.t0 < 0 ? 1 : (now - b.t0) / b.life
      const on = u >= 0 && u < 1
      fl.visible = fi.visible = sh.visible = on
      if (!on) return
      anyBoom = true
      const out = 1 - Math.pow(1 - u, 3) // fast at first, then settling
      // a bright flash, a longer fireball that rises a little, and a ring of shock running out over the surface
      const base = RADIUS * 1.0
      tmp.p.copy(b.dir)
      // flat cards lying on the surface: a bright flash, a longer fireball that lifts a little, and a ring of shock running outward.
      // They are depth-tested, so the planet hides any explosion that is behind it.
      fl.position.copy(tmp.p).multiplyScalar(base + 0.004)
      fl.quaternion.copy(b.flat)
      fl.scale.setScalar(b.size * (0.5 + 1.6 * out))
      ;(fl.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - u, 2)
      fi.position.copy(tmp.p).multiplyScalar(base + 0.005 + b.size * 0.25 * u)
      fi.quaternion.copy(b.flat)
      fi.scale.setScalar(b.size * (0.8 + 2.0 * out))
      ;(fi.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.pow(1 - u, 1.5) * smooth(0, 0.12, u)
      sh.position.copy(tmp.p).multiplyScalar(base + 0.003)
      sh.quaternion.copy(b.flat)
      sh.scale.setScalar(b.size * (0.5 + 4 * out))
      ;(sh.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.pow(1 - u, 1.5)
    })
    // the embers
    {
      const pos = embers.geo.getAttribute('position') as THREE.BufferAttribute
      const col = embers.geo.getAttribute('color') as THREE.BufferAttribute
      for (let i = 0; i < BOOMS * EMBERS; i++) {
        const age = now - embers.born[i]
        const f = age < 0 || age > embers.life[i] ? 0 : 1 - age / embers.life[i]
        if (f > 0) {
          anyBoom = true
          tmp.p.set(pos.getX(i), pos.getY(i), pos.getZ(i))
          const len = tmp.p.length() || 1
          // gravity pulls toward the planet's centre
          embers.vel[i * 3] -= (tmp.p.x / len) * 0.9 * dt
          embers.vel[i * 3 + 1] -= (tmp.p.y / len) * 0.9 * dt
          embers.vel[i * 3 + 2] -= (tmp.p.z / len) * 0.9 * dt
          pos.setXYZ(i, tmp.p.x + embers.vel[i * 3] * dt, tmp.p.y + embers.vel[i * 3 + 1] * dt, tmp.p.z + embers.vel[i * 3 + 2] * dt)
        }
        col.setXYZ(i, f, f * (0.45 + 0.4 * f), f * 0.12) // fades to black, which disappears when added to the planet
      }
      pos.needsUpdate = true
      col.needsUpdate = true
    }
    if (boomGroup.current) boomGroup.current.visible = anyBoom

    g.visible = k.level > 0.01
    if (!g.visible) { if (lines.current) lines.current.box.style.opacity = '0'; return }

    // where the spot is now, in the world, and whether it faces the viewer
    tmp.world.copy(k.spot).applyQuaternion(tmp.q)
    let facing = tmp.world.dot(tmp.toCam)
    if (zone && now < k.seekUntil) {
      // the point is on the far side (or off to one side): turn the planet quickly until it comes round to face the viewer
      const gap = ((Math.atan2(tmp.toCam.x, tmp.toCam.z) - Math.atan2(tmp.world.x, tmp.world.z) + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      if (Math.abs(gap) < 0.1) k.seekUntil = 0
      else {
        parent.rotation.y += Math.max(-1.8 * dt, Math.min(1.8 * dt, gap))
        parent.updateMatrixWorld()
        parent.getWorldQuaternion(tmp.q)
        tmp.qi.copy(tmp.q).invert()
        tmp.world.copy(k.spot).applyQuaternion(tmp.q)
        facing = tmp.world.dot(tmp.toCam)
      }
    }
    // closing in: the reticle starts large and tightens onto the spot
    const e = 1 - Math.pow(1 - Math.min(1, (now - k.since) / 0.5), 3)
    const size = 0.46 * (1 + (1 - e) * 0.9)
    const alpha = k.level * (0.55 + 0.4 * e)
    // the reticle is drawn on the screen, flat and facing you, at wherever the spot is on the planet right now (so it follows the
    // spot as the planet turns or the camera orbits, is never sliced by the planet, and simply fades as the spot nears the edge)
    tmp.pos.copy(k.spot).multiplyScalar(RADIUS * 1.012)
    const edge = Math.min(1, Math.max(0, facing / 0.3))
    for (const sp of [cross.current, ring.current]) {
      if (!sp) continue
      sp.position.copy(tmp.pos)
      sp.scale.set(size, size, 1)
      ;(sp.material as THREE.SpriteMaterial).opacity = alpha * edge
    }
    if (ring.current) (ring.current.material as THREE.SpriteMaterial).rotation = now * 0.7

    // the guide lines: from just outside the reticle to the top and the left and right edges of the map
    const L = lines.current
    if (L) {
      const w = gl.domElement.clientWidth
      const h = gl.domElement.clientHeight
      tmp.world.copy(tmp.pos)
      parent.localToWorld(tmp.world)
      tmp.right.set(1, 0, 0).applyQuaternion(s.camera.quaternion).multiplyScalar(size * 0.5).add(tmp.world)
      tmp.world.project(s.camera)
      tmp.right.project(s.camera)
      const x = (tmp.world.x * 0.5 + 0.5) * w
      const y = (-tmp.world.y * 0.5 + 0.5) * h
      const half = Math.abs(tmp.right.x - tmp.world.x) * 0.5 * w // half the reticle's width on the screen
      const gap = half + 6 // just outside the reticle's corner brackets
      const gapDown = (half / (size * 0.5)) * (0.36 + 0.07) + 6 // clear of the name under it
      // while the point is behind the planet the reticle is hidden but its lines stay, faintly, so you can still see where it is
      L.box.style.opacity = String(alpha * (0.25 + 0.75 * edge))
      L.up.style.cssText = `left:${x}px;top:0;height:${Math.max(0, y - gap)}px`
      L.down.style.cssText = `left:${x}px;top:${y + gapDown}px;height:${Math.max(0, h - y - gapDown)}px`
      L.left.style.cssText = `top:${y}px;left:0;width:${Math.max(0, x - gap)}px`
      L.right.style.cssText = `top:${y}px;left:${x + gap}px;width:${Math.max(0, w - x - gap)}px`
    }
    if (label.current) {
      // the name sits just under the reticle on the screen (not on the planet), drawn over the planet so the curve of the
      // surface never cuts it, and fades as the spot turns away
      tmp.down.set(0, -1, 0).applyQuaternion(s.camera.quaternion).applyQuaternion(tmp.qi).multiplyScalar(0.36)
      label.current.position.copy(tmp.pos).add(tmp.down)
      label.current.scale.set(0.62, 0.62 * (96 / 512), 1)
      const seen = Math.min(1, Math.max(0, (facing - 0.05) / 0.25))
      ;(label.current.material as THREE.SpriteMaterial).opacity = k.level * e * seen
    }
  })

  // drawn over everything (no depth test), so the planet's curve can never cut it; it fades out instead when the spot turns away
  const common = { transparent: true, depthWrite: false, depthTest: false } as const
  const card = { transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 } as const
  return (
    <>
      <group ref={root} visible={false}>
        <sprite ref={ring} renderOrder={8}><spriteMaterial map={ringTex} {...common} opacity={0} /></sprite>
        <sprite ref={cross} renderOrder={9}><spriteMaterial map={crossTex} {...common} opacity={0} /></sprite>
        <sprite ref={label} renderOrder={10}><spriteMaterial map={labelTex} {...common} opacity={0} /></sprite>
      </group>
      {/* explosions: cards lying on the surface, with the depth test on so the planet hides the ones behind it */}
      <group ref={boomGroup} visible={false}>
        {Array.from({ length: BOOMS }, (_, i) => (
          <group key={i}>
            <mesh ref={(el) => { shock.current[i] = el }} renderOrder={6} visible={false}><planeGeometry args={[1, 1]} /><meshBasicMaterial map={shockTex} {...card} opacity={0} /></mesh>
            <mesh ref={(el) => { fire.current[i] = el }} renderOrder={7} visible={false}><planeGeometry args={[1, 1]} /><meshBasicMaterial map={glowTex} color="#ff8a35" {...card} opacity={0} /></mesh>
            <mesh ref={(el) => { flash.current[i] = el }} renderOrder={7} visible={false}><planeGeometry args={[1, 1]} /><meshBasicMaterial map={glowTex} color="#fff0c0" {...card} opacity={0} /></mesh>
          </group>
        ))}
        <points geometry={embers.geo} frustumCulled={false} renderOrder={7}>
          <pointsMaterial size={0.012} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
        </points>
      </group>
    </>
  )
}
