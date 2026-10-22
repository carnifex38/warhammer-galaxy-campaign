import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PLANET_RADIUS, arriveFade } from './PlanetBody'
import { zoneSpot } from './ZoneReticle'

// Void shields. A battlezone captured by a team gets a shield dome over its own spot on the planet (the same fixed spot its reticle and
// explosions use), as in the lore: shields cover regions and fortress sites, never a whole world. The dome is a see-through lattice of
// hexagon cells, edges glowing in the winning team's colour, brightest toward the rim; it spreads out over the surface from the spot
// with a bright leading ring when it powers up, then idles with a slow shimmer and now and then a ripple where a shot is "absorbed".
// When one team holds every battlezone on the planet the domes widen until they overlap into one joined network.

export interface ShieldZone { id: string; name: string; team: 'A' | 'B'; at: number }

const TEAM_COLOR: Record<'A' | 'B', string> = { A: '#38c6ff', B: '#ff7a3a' }
const DOME_RADIUS = 0.5 // how far a dome reaches over the surface from its spot (radians), about 29 degrees
const NETWORK_RADIUS = 1.08 // when the planet is fully held: wide enough that the domes overlap
const POWER_UP_S = 1.8

const SHIELD_GEOMETRY = new THREE.SphereGeometry(PLANET_RADIUS * 1.06, 96, 64)

const VERT = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vWP;
  void main() {
    vObj = normalize(position);
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAG = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vWP;
  uniform vec3 uCenter, uU, uV, uColor;
  uniform float uRadius, uProgress, uTime, uArrive, uSeed;
  uniform vec4 uHit[3];

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // a hexagon grid: xy = position inside the cell, zw = the cell's id
  vec4 hexCell(vec2 p) {
    const vec2 s = vec2(1.7320508, 1.0);
    vec4 hC = floor(vec4(p, p - vec2(1.0, 0.5)) / s.xyxy) + 0.5;
    vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
    return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
  }
  float hexEdge(vec2 p) { p = abs(p); return max(dot(p, vec2(0.8660254, 0.5)), p.y); }

  void main() {
    vec3 p = normalize(vObj);
    float c = dot(p, uCenter);
    float ang = acos(clamp(c, -1.0, 1.0));

    // the dome spreads out from its spot; a bright ring runs at the front while it does
    float e = uRadius * (1.0 - pow(1.0 - clamp(uProgress, 0.0, 1.0), 3.0));
    float inside = 1.0 - smoothstep(e - 0.05, e, ang);
    if (inside <= 0.001) discard;
    float front = exp(-pow((ang - e) / 0.03, 2.0)) * (1.0 - clamp(uProgress, 0.0, 1.0)) * 1.6;
    float rim = exp(-pow((ang - uRadius) / 0.035, 2.0)) * 0.55 * smoothstep(0.7, 1.0, uProgress);

    // hexagon cells laid flat on the surface around the spot (a gnomonic projection, so the cells stay even)
    vec2 q = vec2(dot(p, uU), dot(p, uV)) / max(c, 0.2) * 7.0;
    vec4 hc = hexCell(q);
    float edge = smoothstep(0.36, 0.47, hexEdge(hc.xy));
    float cellRand = hash(hc.zw + uSeed);
    float flicker = 0.55 + 0.45 * sin(uTime * (0.8 + cellRand) + cellRand * 6.283);
    float travel = 0.5 + 0.5 * sin(ang * 16.0 - uTime * 1.3);

    // the rim glows brighter where you look along the dome (it is a shell, thin edge-on)
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vWP);
    float fr = pow(1.0 - abs(dot(N, V)), 2.4);

    // a ripple from a "shot" hitting the shield
    float hit = 0.0;
    for (int i = 0; i < 3; i++) {
      float age = uTime - uHit[i].w;
      if (uHit[i].w >= 0.0 && age < 3.0) {
        float d = acos(clamp(dot(p, uHit[i].xyz), -1.0, 1.0));
        hit += exp(-pow((d - age * 0.5) / 0.06, 2.0)) * exp(-age * 1.2);
      }
    }

    float line = edge * (0.75 + 0.45 * flicker + 0.3 * travel + 1.6 * hit) + front + rim;
    // each cell also glows softly on its own, and the whole dome brightens toward its rim
    float cell = (1.0 - edge) * (0.05 + 0.16 * cellRand * flicker + 0.1 * travel);
    float fill = cell + (0.08 + 0.4 * fr) * (0.7 + 0.3 * flicker) + hit * 0.3;
    float a = (line + fill) * inside * uArrive;
    vec3 col = mix(uColor, vec3(1.0), clamp(front * 0.5 + hit * 0.4 + edge * 0.12, 0.0, 0.7));
    gl_FragColor = vec4(col * a, a);
  }
`

function labelTexture(team: 'A' | 'B') {
  const cv = document.createElement('canvas')
  cv.width = 512
  cv.height = 128
  const c = cv.getContext('2d')!
  const col = TEAM_COLOR[team]
  c.textAlign = 'center'
  c.lineJoin = 'round'
  c.strokeStyle = 'rgba(0, 10, 24, 0.85)'
  c.fillStyle = col
  c.lineWidth = 8
  c.font = 'bold 54px ui-monospace, Consolas, monospace'
  c.strokeText(`TEAM ${team} CAPTURED`, 256, 56)
  c.fillText(`TEAM ${team} CAPTURED`, 256, 56)
  c.lineWidth = 6
  c.font = '26px ui-monospace, Consolas, monospace'
  c.strokeText('VOID SHIELD ACTIVE', 256, 100)
  c.fillText('VOID SHIELD ACTIVE', 256, 100)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function Shield({ zone, full }: { zone: ShieldZone; full: boolean }) {
  const group = useRef<THREE.Group>(null)
  const label = useRef<THREE.Sprite>(null)
  const spot = useMemo(() => zoneSpot(zone.id), [zone.id])
  const radius = useRef(full ? NETWORK_RADIUS : DOME_RADIUS)
  const hits = useRef({ next: 1.2, slot: 0 })
  const tmp = useMemo(() => ({ q: new THREE.Quaternion(), centre: new THREE.Vector3(), toCam: new THREE.Vector3(), world: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3(), a: new THREE.Vector3() }), [])
  const tex = useMemo(() => labelTexture(zone.team), [zone.team])
  useEffect(() => () => tex.dispose(), [tex])

  const uniforms = useMemo(() => {
    const up = Math.abs(spot.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const u = new THREE.Vector3().crossVectors(up, spot).normalize()
    const v = new THREE.Vector3().crossVectors(spot, u)
    return {
      uCenter: { value: spot.clone() },
      uU: { value: u },
      uV: { value: v },
      uColor: { value: new THREE.Color(TEAM_COLOR[zone.team]) },
      uRadius: { value: DOME_RADIUS },
      uProgress: { value: 1 },
      uTime: { value: 0 },
      uArrive: arriveFade,
      uSeed: { value: (zone.id.length * 7.3) % 5 },
      uHit: { value: [new THREE.Vector4(0, 0, 1, -1), new THREE.Vector4(0, 0, 1, -1), new THREE.Vector4(0, 0, 1, -1)] },
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one stable uniforms object per shield; radius and progress are set every frame
  }, [spot, zone.team, zone.id])

  useFrame((s, dt) => {
    const g = group.current
    if (!g || !g.parent) return
    const now = s.clock.elapsedTime
    uniforms.uTime.value = now
    uniforms.uProgress.value = zone.at ? Math.min(1, (Date.now() - zone.at) / 1000 / POWER_UP_S) : 1
    // widen to one joined network when the planet is fully held (and back again)
    const target = full ? NETWORK_RADIUS : DOME_RADIUS
    radius.current += (target - radius.current) * Math.min(1, dt * 2.2)
    uniforms.uRadius.value = radius.current

    // now and then a shot is "absorbed": a ripple from a random point inside the dome
    const h = hits.current
    if (uniforms.uProgress.value >= 1 && now >= h.next) {
      const ang = Math.random() * Math.PI * 2
      const rho = Math.random() * radius.current * 0.8
      tmp.u.copy(uniforms.uU.value).multiplyScalar(Math.cos(ang)).addScaledVector(uniforms.uV.value, Math.sin(ang)).normalize()
      tmp.a.copy(spot).applyAxisAngle(tmp.u, rho)
      uniforms.uHit.value[h.slot % 3].set(tmp.a.x, tmp.a.y, tmp.a.z, now)
      h.slot++
      h.next = now + 2.5 + Math.random() * 3
    }

    // the label: visible while its spot faces the viewer, like the reticle's
    const parent = g.parent
    parent.getWorldQuaternion(tmp.q)
    parent.getWorldPosition(tmp.centre)
    tmp.toCam.copy(s.camera.position).sub(tmp.centre).normalize()
    tmp.world.copy(spot).applyQuaternion(tmp.q)
    const facing = tmp.world.dot(tmp.toCam)
    if (label.current) {
      const edge = Math.min(1, Math.max(0, (facing - 0.1) / 0.35))
      const pop = Math.min(1, Math.max(0, (uniforms.uProgress.value - 0.55) / 0.45)) // the label arrives as the dome finishes
      const joined = Math.min(1, Math.max(0, (radius.current - DOME_RADIUS) / (NETWORK_RADIUS - DOME_RADIUS))) // one joined network: the banner says it instead
      ;(label.current.material as THREE.SpriteMaterial).opacity = edge * pop * (1 - joined) * arriveFade.value
    }
  })

  return (
    <group ref={group}>
      <mesh geometry={SHIELD_GEOMETRY} renderOrder={9}>
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={VERT}
          fragmentShader={FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.FrontSide}
        />
      </mesh>
      <sprite ref={label} position={spot.clone().multiplyScalar(PLANET_RADIUS * 1.07)} scale={[0.62, 0.155, 1]} renderOrder={12}>
        <spriteMaterial map={tex} transparent depthTest={false} depthWrite={false} opacity={0} userData={{ keepOpacity: true }} />
      </sprite>
    </group>
  )
}

/** The shields of every captured battlezone on a planet. `total`: how many battlezones the planet has. */
export function VoidShields({ zones, total }: { zones: ShieldZone[]; total: number }) {
  const full = zones.length > 0 && zones.length === total && zones.every((z) => z.team === zones[0].team)
  return <>{zones.map((z) => <Shield key={`${z.id}-${z.team}`} zone={z} full={full} />)}</>
}
