import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// A green targeting reticle that locks onto a spot of the planet when a battlezone is pointed at. The spot is a real point on the
// planet's surface (it turns with the planet, and orbiting the camera just shows it from another side), but the reticle itself is
// drawn flat on the screen over that point, like a HUD (it fades as the spot turns away, and a new spot is picked up).
// Long thin guide lines run from it to the top, bottom and both sides of the map, and follow it.
// Explosions go off on the planet's surface all around the point (flash, fireball, shock ring and flying embers), turning with the
// planet; the ones on the far side are hidden by the planet itself. It starts
// on the face the viewer can see, at a place worked out from the battlezone's id, so a battlezone points at roughly the same
// part of the view each time.

const GREEN = '#62ff9d'
const RADIUS = 0.62 // the planet's radius (PLANET_RADIUS in Galaxy3D)
const BOOMS = 14 // explosions that can be going at once
const EMBERS = 8 // embers thrown out by each explosion
const SPREAD = 0.3 // how far from the point they go off (radians over the surface)

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Where to lock on: a direction on the face the viewer sees, a stable pseudo-random distance from the middle for a given battlezone.
 * It starts on the side the planet's surface is coming from, so the spot crosses the whole visible face before it turns away.
 */
export function zoneSpot(zoneId: string, toward: THREE.Vector3, right: THREE.Vector3, salt = 0): THREE.Vector3 {
  const h = hash(`${zoneId}:${salt}`)
  const left = 0.15 + (((h >>> 10) & 0x3ff) / 1023) * 0.5 // radians to the left of the middle (the planet turns toward the right)
  const lift = (((h & 0x3ff) / 1023) - 0.5) * 0.9 // up or down a little
  const dir = toward.clone().multiplyScalar(Math.cos(left)).addScaledVector(right, -Math.sin(left)).normalize()
  return dir.applyAxisAngle(right, lift).normalize()
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

interface Boom { t0: number; dir: THREE.Vector3; size: number; life: number }

export function ZoneReticle({ zone }: { zone: { id: string; name: string } | null }) {
  const root = useRef<THREE.Group>(null)
  const cross = useRef<THREE.Sprite>(null)
  const ring = useRef<THREE.Sprite>(null)
  const label = useRef<THREE.Sprite>(null)
  // `spot` is a point on the planet's surface, in the planet's own frame (so it turns with the planet)
  const st = useRef({ id: '', name: '', level: 0, since: 0, spot: new THREE.Vector3(0, 0, 1), active: false })
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), toCam: new THREE.Vector3(), centre: new THREE.Vector3(), down: new THREE.Vector3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), world: new THREE.Vector3(), right: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), ax: new THREE.Vector3(), p: new THREE.Vector3(), t: new THREE.Vector3() }), [])
  // the explosions
  const boomGroup = useRef<THREE.Group>(null)
  const flash = useRef<(THREE.Sprite | null)[]>([])
  const fire = useRef<(THREE.Sprite | null)[]>([])
  const shock = useRef<(THREE.Sprite | null)[]>([])
  const booms = useRef<Boom[]>(Array.from({ length: BOOMS }, () => ({ t0: -1, dir: new THREE.Vector3(0, 0, 1), size: 0.1, life: 1 })))
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

    /** Lock onto a new spot: pick one on the face the viewer sees, then hold it in the planet's own frame. */
    const lock = () => {
      tmp.right.set(1, 0, 0).applyQuaternion(s.camera.quaternion)
      tmp.world.copy(zoneSpot(k.id, tmp.toCam, tmp.right))
      k.spot.copy(tmp.world).applyQuaternion(tmp.qi)
      k.since = now
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
        const rho = 0.05 + Math.random() * SPREAD
        tmp.u.set(0, 1, 0).cross(k.spot)
        if (tmp.u.lengthSq() < 1e-6) tmp.u.set(1, 0, 0)
        tmp.u.normalize()
        tmp.v.crossVectors(k.spot, tmp.u)
        tmp.ax.copy(tmp.u).multiplyScalar(Math.cos(ang)).addScaledVector(tmp.v, Math.sin(ang))
        slot.dir.copy(k.spot).applyAxisAngle(tmp.ax, rho)
        slot.t0 = now
        slot.size = 0.04 + Math.random() * 0.05
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
      // an explosion on the far side of the planet is simply not shown (no depth test, so nothing is ever cut by the planet)
      const seen = smooth(0.02, 0.3, tmp.world.copy(b.dir).applyQuaternion(tmp.q).dot(tmp.toCam))
      fl.position.copy(tmp.p).multiplyScalar(base + 0.012)
      fl.scale.setScalar(b.size * (0.4 + 1.6 * out))
      ;(fl.material as THREE.SpriteMaterial).opacity = Math.pow(1 - u, 2) * seen
      fi.position.copy(tmp.p).multiplyScalar(base + 0.012 + b.size * 0.5 * u)
      fi.scale.setScalar(b.size * (0.8 + 2.0 * out))
      ;(fi.material as THREE.SpriteMaterial).opacity = 0.55 * Math.pow(1 - u, 1.5) * smooth(0, 0.12, u) * seen
      sh.position.copy(tmp.p).multiplyScalar(base + 0.01)
      sh.scale.setScalar(b.size * (0.5 + 4.5 * out))
      ;(sh.material as THREE.SpriteMaterial).opacity = 0.5 * Math.pow(1 - u, 1.5) * seen
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
    const facing = tmp.world.dot(tmp.toCam)
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
  const add = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending } as const
  return (
    <>
      <group ref={root} visible={false}>
        <sprite ref={ring} renderOrder={8}><spriteMaterial map={ringTex} {...common} opacity={0} /></sprite>
        <sprite ref={cross} renderOrder={9}><spriteMaterial map={crossTex} {...common} opacity={0} /></sprite>
        <sprite ref={label} renderOrder={10}><spriteMaterial map={labelTex} {...common} opacity={0} /></sprite>
      </group>
      {/* explosions: each fades out as it turns to the far side of the planet */}
      <group ref={boomGroup} visible={false}>
        {Array.from({ length: BOOMS }, (_, i) => (
          <group key={i}>
            <sprite ref={(el) => { shock.current[i] = el }} renderOrder={6} visible={false}><spriteMaterial map={shockTex} {...add} opacity={0} /></sprite>
            <sprite ref={(el) => { fire.current[i] = el }} renderOrder={7} visible={false}><spriteMaterial map={glowTex} color="#ff8a35" {...add} opacity={0} /></sprite>
            <sprite ref={(el) => { flash.current[i] = el }} renderOrder={7} visible={false}><spriteMaterial map={glowTex} color="#fff0c0" {...add} opacity={0} /></sprite>
          </group>
        ))}
        <points geometry={embers.geo} frustumCulled={false} renderOrder={7}>
          <pointsMaterial size={0.02} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
        </points>
      </group>
    </>
  )
}
