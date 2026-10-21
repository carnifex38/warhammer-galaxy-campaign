import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// A green targeting reticle that settles on a spot of the planet when a battlezone is pointed at, and drifts slowly around it.
// Every battlezone has its own spot (worked out from its id), always on the side of the planet facing the viewer, so the same
// battlezone always points at the same place: the explosions planned for a claimed battlezone can use `zoneSpot` too.
// Sits inside the planet's own group, so it grows with the planet as it arrives and uses the planet's local units.

const GREEN = '#62ff9d'
const RADIUS = 0.62 // the planet's radius (PLANET_RADIUS in Galaxy3D)
const FACING = new THREE.Vector3(0, 0.3, 0.95).normalize() // the way the planet is first looked at from

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** The unit direction (from the planet's centre) that a battlezone points at. Stable for a given battlezone id. */
export function zoneSpot(zoneId: string): THREE.Vector3 {
  const h = hash(zoneId)
  const around = ((h & 0x3ff) / 1023) * Math.PI * 2 // which way round the viewer's line of sight
  const off = 0.12 + (((h >>> 10) & 0x3ff) / 1023) * 0.72 // how far off it (radians), so it never leaves the visible face
  const u = new THREE.Vector3().crossVectors(FACING, new THREE.Vector3(1, 0, 0)).normalize()
  const v = new THREE.Vector3().crossVectors(FACING, u).normalize()
  const axis = u.multiplyScalar(Math.cos(around)).add(v.multiplyScalar(Math.sin(around)))
  return FACING.clone().applyAxisAngle(axis, off)
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
  const st = useRef({ id: '', name: '', level: 0, since: 0, spot: new THREE.Vector3(0, 0, 1), seed: 0 })
  const tmp = useMemo(() => ({ dir: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3() }), [])
  const crossTex = useMemo(drawCross, [])
  const ringTex = useMemo(drawRing, [])
  const labelCanvas = useMemo(() => { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; return cv }, [])
  const labelTex = useMemo(() => { const t = new THREE.CanvasTexture(labelCanvas); t.colorSpace = THREE.SRGBColorSpace; return t }, [labelCanvas])
  useEffect(() => () => { crossTex.dispose(); ringTex.dispose(); labelTex.dispose() }, [crossTex, ringTex, labelTex])

  useFrame((s, dt) => {
    const g = root.current
    if (!g) return
    const k = st.current
    const now = s.clock.elapsedTime
    if (zone && zone.id !== k.id) { // a new battlezone is pointed at: lock onto its spot
      k.id = zone.id
      k.seed = (hash(zone.id) % 1000) / 1000
      k.spot.copy(zoneSpot(zone.id))
      k.since = now
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

    // drift slowly around the spot, as if scanning the surface
    tmp.dir.copy(k.spot)
    tmp.a.set(0, 1, 0).cross(tmp.dir).normalize()
    tmp.b.crossVectors(tmp.dir, tmp.a).normalize()
    tmp.dir.applyAxisAngle(tmp.a, 0.11 * Math.sin(now * 0.8 + k.seed * 6.28))
    tmp.dir.applyAxisAngle(tmp.b, 0.09 * Math.sin(now * 0.55 + k.seed * 11))
    tmp.dir.normalize().multiplyScalar(RADIUS * 1.02)

    // closing in: the reticle starts large and tightens onto the spot
    const e = 1 - Math.pow(1 - Math.min(1, (now - k.since) / 0.5), 3)
    const size = 0.46 * (1 + (1 - e) * 1.7)
    const alpha = k.level * (0.55 + 0.4 * e)
    for (const sp of [cross.current, ring.current]) {
      if (!sp) continue
      sp.position.copy(tmp.dir)
      sp.scale.set(size, size, 1)
      ;(sp.material as THREE.SpriteMaterial).opacity = alpha
    }
    if (ring.current) (ring.current.material as THREE.SpriteMaterial).rotation = now * 0.7
    if (label.current) {
      // the name sits just under the reticle, drawn over the planet (so the curve of the surface never cuts it), and fades if the
      // spot turns away from the viewer
      g.getWorldPosition(tmp.up)
      tmp.a.copy(s.camera.position).sub(tmp.up).normalize()
      const facing = tmp.dir.clone().normalize().dot(tmp.a)
      const seen = Math.min(1, Math.max(0, (facing - 0.05) / 0.25))
      label.current.position.copy(tmp.dir).add(tmp.b.set(0, -0.36, 0))
      label.current.scale.set(0.62, 0.62 * (96 / 512), 1)
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
