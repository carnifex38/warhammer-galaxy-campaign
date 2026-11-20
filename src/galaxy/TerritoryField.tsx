import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rgb01, type Teams } from '../teams'

// Captured territory on the galaxy map. Every planet a team holds pushes that team's "influence" out around it (a soft bump that
// fades with distance); wherever one team's influence is the stronger, that is its territory. The edge of a territory is where the
// influence drops below a threshold, and the front line is where the two teams' influences are equal. All of it is worked out per
// pixel (a planet's influence stays inside the sector it is in, so each sector shows only its own territory) on one flat sheet lying on the galaxy, so the borders flow into each other as planets change hands, with nothing drawn by hand.

export interface TerritoryPlanet { x: number; z: number; team: 'A' | 'B'; /** the sector the planet is in: its influence stays inside that sector */ sector: string }
export interface TerritorySector { id: string; polygon: [number, number][] }

const MAX_PLANETS = 128

const VERT = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vXZ = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vXZ;
  uniform vec4 uPts[${MAX_PLANETS}]; // x, z, team (0 = A, 1 = B), the planet's sector number times 16 (0 for an unused slot)
  uniform float uSigma;
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uTime;
  uniform float uFade;
  uniform float uOn;
  uniform sampler2D uMask; // which sector is where: its number times 16 (0 = empty space)
  uniform vec4 uBox;       // x, z, width, height of the sheet

  const float EDGE = 0.34; // influence at which a territory ends

  void main() {
    float fa = 0.0;
    float fb = 0.0;
    float qa = 0.0; // the same influences raised to a power: dominated by the nearest planets, so a planet always owns its own spot
    float qb = 0.0;
    float s2 = uSigma * uSigma;
    float sector = texture2D(uMask, vec2((vXZ.x - uBox.x) / uBox.z, 1.0 - (vXZ.y - uBox.y) / uBox.w)).r * 255.0;
    float land = smoothstep(5.0, 11.0, sector);
    for (int i = 0; i < ${MAX_PLANETS}; i++) {
      vec4 p = uPts[i];
      if (p.w < 0.5 || abs(p.w - sector) > 5.0) continue;
      vec2 d = vXZ - p.xy;
      float g = exp(-dot(d, d) / s2);
      float g4 = g * g * g * g;
      if (p.z < 0.5) { fa += g; qa += g4; } else { fb += g; qb += g4; }
    }
    float top = max(fa, fb);
    float ma = sqrt(sqrt(qa)); // (the strongest nearby influence, softly)
    float mb = sqrt(sqrt(qb));
    float diff = ma - mb;
    vec3 col = diff >= 0.0 ? uColA : uColB;

    // inside a territory: a soft wash that is strongest near the planets it holds
    float inside = smoothstep(EDGE * 0.7, EDGE * 1.6, top);
    float wash = inside * (0.16 + 0.16 * smoothstep(EDGE, 1.4, top));

    // the outline of a territory: a thin bright band where the influence crosses the threshold (anti-aliased with the pixel size)
    float wEdge = fwidth(top) * 1.4 + 1e-4;
    float edge = 1.0 - smoothstep(0.0, wEdge, abs(top - EDGE));
    // (the outline is drawn only on the side facing open space: where both teams meet, the front line takes over)
    float low = min(ma, mb);
    float meet = smoothstep(EDGE * 0.5, EDGE * 1.1, low);
    edge *= (1.0 - meet);

    // the front line: where the two teams' influence is equal, with both of them strong enough to be there
    float wLine = fwidth(diff) * 1.7 + 1e-4;
    float line = (1.0 - smoothstep(0.0, wLine, abs(diff))) * smoothstep(EDGE * 0.45, EDGE * 0.9, low);
    float glow = (1.0 - smoothstep(0.0, wLine * 4.0, abs(diff))) * smoothstep(EDGE * 0.45, EDGE * 0.9, low);
    // it flickers like a battle line, moving along its length
    float pulse = 0.9 + 0.1 * sin(uTime * 1.2 + (vXZ.x + vXZ.y) * 3.0);
    vec3 fire = vec3(0.98, 0.64, 0.32);

    vec3 rgb = col;
    float a = wash + edge * 0.85;
    rgb = mix(rgb, vec3(1.0), edge * 0.25);
    // blend the front line on top
    float la = clamp(line * 0.85 * pulse + glow * 0.12, 0.0, 1.0);
    rgb = mix(rgb, fire, la);
    a = max(a, la);
    a *= uFade * uOn * land;
    if (a < 0.003) discard;
    gl_FragColor = vec4(rgb, a);
  }
`

/** The territory sheet. `box` is the area it covers; `planets` are the held planets; `spacing` is a typical distance between
 *  neighbouring planets (it sets how far a planet's influence reaches). `getFade` gives 0..1, to dim it with the rest of the map. */
export function TerritoryField({ planets, teams, box, spacing, polygons, on, getFade }: {
  planets: TerritoryPlanet[]
  teams: Teams
  box: { x: number; z: number; w: number; h: number }
  spacing: number
  /** the sectors the territory may cover (a planet's influence stays in its own) */
  polygons: TerritorySector[]
  on: boolean
  getFade: () => number
}) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(() => ({
    uPts: { value: Array.from({ length: MAX_PLANETS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uSigma: { value: 1 },
    uColA: { value: new THREE.Vector3() },
    uColB: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uOn: { value: on ? 1 : 0 },
    uMask: { value: null as THREE.Texture | null },
    uBox: { value: new THREE.Vector4() },
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const pts = uniforms.uPts.value
    for (let i = 0; i < MAX_PLANETS; i++) {
      const p = planets[i]
      const at = p ? polygons.findIndex((q) => q.id === p.sector) : -1
      if (p && at >= 0) pts[i].set(p.x, p.z, p.team === 'A' ? 0 : 1, (at + 1) * 16)
      else pts[i].set(0, 0, 0, 0)
    }
    const u = material.current?.uniforms
    if (u) u.uSigma.value = spacing * 1.5
    uniforms.uColA.value.set(...rgb01(teams.A.color))
    uniforms.uColB.value.set(...rgb01(teams.B.color))
  }, [planets, teams, spacing, polygons, uniforms])

  // a picture of where the sectors are: white inside them, softened at the edge
  const pad = 3
  const sheet = useMemo(() => ({ x: box.x - pad, z: box.z - pad, w: box.w + pad * 2, h: box.h + pad * 2 }), [box.x, box.z, box.w, box.h])
  useEffect(() => {
    const W = 1536
    const H = Math.max(64, Math.round(W * sheet.h / sheet.w))
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const g = c.getContext('2d')
    if (!g) return
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
    polygons.forEach(({ polygon: poly }, n) => {
      g.fillStyle = `rgb(${(n + 1) * 16}, 0, 0)`
      g.beginPath()
      poly.forEach(([x, z], i) => { const px = (x - sheet.x) / sheet.w * W, py = (z - sheet.z) / sheet.h * H; if (i) g.lineTo(px, py); else g.moveTo(px, py) })
      g.closePath(); g.fill()
    })
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.NoColorSpace
    tex.generateMipmaps = false
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    const u = material.current?.uniforms
    if (u) { u.uMask.value = tex; u.uBox.value.set(sheet.x, sheet.z, sheet.w, sheet.h) }
    return () => tex.dispose()
  }, [polygons, sheet])

  // fades in and out when switched on or off, rather than popping
  const shown = useRef(on ? 1 : 0)
  useFrame((_, dt) => {
    const m = material.current
    if (!m) return
    // (the material keeps its own copy of the uniforms, so the numbers are written through it)
    shown.current += ((on ? 1 : 0) - shown.current) * Math.min(1, dt * 6)
    m.uniforms.uOn.value = shown.current
    m.uniforms.uFade.value = getFade()
    m.uniforms.uTime.value += dt
    m.visible = shown.current > 0.01
  })

  return (
    <mesh position={[sheet.x + sheet.w / 2, 0.03, sheet.z + sheet.h / 2]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} raycast={() => null} frustumCulled={false}>
      <planeGeometry args={[sheet.w, sheet.h]} />
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={VERT} fragmentShader={FRAG} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}
