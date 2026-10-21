import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// A green targeting reticle that locks onto a spot of the planet when a battlezone is pointed at. The spot is a real point on the
// planet's surface: the reticle is drawn inside the planet's own spinning group, so it turns with the planet, and orbiting the
// camera just shows it from another side (it goes behind the planet when the spot turns away, and is picked up again). It starts
// on the face the viewer can see, at a place worked out from the battlezone's id, so a battlezone points at roughly the same
// part of the view each time.

const GREEN = '#62ff9d'
const RADIUS = 0.62 // the planet's radius (PLANET_RADIUS in Galaxy3D)

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

export function ZoneReticle({ zone }: { zone: { id: string; name: string } | null }) {
  const root = useRef<THREE.Group>(null)
  const cross = useRef<THREE.Sprite>(null)
  const ring = useRef<THREE.Sprite>(null)
  const label = useRef<THREE.Sprite>(null)
  // `spot` is a point on the planet's surface, in the planet's own frame (so it turns with the planet)
  const st = useRef({ id: '', name: '', level: 0, since: 0, spot: new THREE.Vector3(0, 0, 1), salt: 0, hiddenSince: -1 })
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), toCam: new THREE.Vector3(), centre: new THREE.Vector3(), down: new THREE.Vector3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), world: new THREE.Vector3(), right: new THREE.Vector3() }), [])
  const crossTex = useMemo(() => drawCross(), [])
  const ringTex = useMemo(() => drawRing(), [])
  const labelCanvas = useMemo(() => { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; return cv }, [])
  const labelTex = useMemo(() => { const t = new THREE.CanvasTexture(labelCanvas); t.colorSpace = THREE.SRGBColorSpace; return t }, [labelCanvas])
  useEffect(() => () => { crossTex.dispose(); ringTex.dispose(); labelTex.dispose() }, [crossTex, ringTex, labelTex])

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
      tmp.world.copy(zoneSpot(k.id, tmp.toCam, tmp.right, k.salt))
      k.spot.copy(tmp.world).applyQuaternion(tmp.qi)
      k.since = now
      k.hiddenSince = -1
    }

    if (zone && zone.id !== k.id) { // a new battlezone is pointed at
      k.id = zone.id
      k.salt = 0
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
    k.level += ((zone ? 1 : 0) - k.level) * Math.min(1, dt * 7)
    g.visible = k.level > 0.01
    if (!g.visible) return

    // where the spot is now, in the world, and whether it faces the viewer
    tmp.world.copy(k.spot).applyQuaternion(tmp.q)
    const facing = tmp.world.dot(tmp.toCam)
    if (zone) {
      // if the spot has turned away for a moment, pick up a new one on the visible side
      if (facing < 0.08) { if (k.hiddenSince < 0) k.hiddenSince = now; else if (now - k.hiddenSince > 0.5) { k.salt++; lock() } } else k.hiddenSince = -1
    }

    // closing in: the reticle starts large and tightens onto the spot
    const e = 1 - Math.pow(1 - Math.min(1, (now - k.since) / 0.5), 3)
    const size = 0.46 * (1 + (1 - e) * 1.7)
    const alpha = k.level * (0.55 + 0.4 * e)
    tmp.pos.copy(k.spot).multiplyScalar(RADIUS * 1.02)
    for (const sp of [cross.current, ring.current]) {
      if (!sp) continue
      sp.position.copy(tmp.pos)
      sp.scale.set(size, size, 1)
      ;(sp.material as THREE.SpriteMaterial).opacity = alpha
    }
    if (ring.current) (ring.current.material as THREE.SpriteMaterial).rotation = now * 0.7
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

  const common = { transparent: true, depthWrite: false, depthTest: true } as const
  return (
    <group ref={root} visible={false}>
      <sprite ref={ring} renderOrder={8}><spriteMaterial map={ringTex} color={GREEN} {...common} opacity={0} /></sprite>
      <sprite ref={cross} renderOrder={9}><spriteMaterial map={crossTex} color={GREEN} {...common} opacity={0} /></sprite>
      <sprite ref={label} renderOrder={10}><spriteMaterial map={labelTex} {...common} depthTest={false} opacity={0} /></sprite>
    </group>
  )
}
