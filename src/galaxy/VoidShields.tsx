import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { NOISE3 } from './glsl'
import { PLANET_RADIUS, arriveFade } from './PlanetBody'
import { zoneSpot } from './ZoneReticle'

// Void shields. A battlezone captured by a team gets a shield dome over its own spot on the planet (the same fixed spot its reticle and
// explosions use), as in the lore: shields cover regions and fortress sites, never a whole world.
//
// The look follows the 40K art: at rest the dome is a clear glass bubble, nearly invisible, seen mostly as a bright thin edge (and a
// brighter rim where you look along the shell), with faint drifting energy veins and a soft sheen inside. The colour is pale, a tint of
// the winning team's colour over white. It stands up off the surface as a real bubble, so it makes an arc against the sky. When a shot
// "hits", the point flashes, a ripple runs out (the hexagon cells of the shield flare briefly inside it) and lightning crawls over the
// shell. When one team holds every battlezone on the planet the domes widen until they overlap, and the edges of the domes cross as
// bright seams.

export interface ShieldZone { id: string; name: string; team: 'A' | 'B'; at: number }

const TEAM_TINT: Record<'A' | 'B', [number, number, number]> = { A: [0.55, 0.85, 1.0], B: [1.0, 0.7, 0.42] }
const TEAM_TEXT: Record<'A' | 'B', string> = { A: '#9fe0ff', B: '#ffc08f' }
const DOME_RADIUS = 0.4 // how far a dome reaches over the surface from its spot (radians), about 23 degrees
const NETWORK_RADIUS = 0.85 // when the planet is fully held: wide enough that the domes overlap
const POWER_UP_S = 1.8
const LIGHT = new THREE.Vector3(-0.8, 0.35, 0.55)

// fine enough that the bubble's outline is smooth
const SHIELD_GEOMETRY = new THREE.SphereGeometry(PLANET_RADIUS, 160, 112)

const VERT = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vWP;
  varying vec3 vN;
  varying vec3 vCW;
  uniform vec3 uCenter;
  uniform float uRadius, uProgress, uHeight, uTime;
  void main() {
    vec3 dir = normalize(position);
    float prog = clamp(uProgress, 0.0, 1.0);
    // while powering up the dome spreads over the surface and inflates; the bubble's outline is a rounded arch
    float e = uRadius * (1.0 - pow(1.0 - prog, 3.0));
    float ang = acos(clamp(dot(dir, uCenter), -1.0, 1.0));
    float t = clamp(ang / max(e, 0.001), 0.0, 1.0);
    float arch = sqrt(max(1.0 - t * t, 0.0));
    float inflate = smoothstep(0.0, 1.0, prog);
    vObj = dir;
    vN = normalize(mat3(modelMatrix) * dir);
    vCW = normalize(mat3(modelMatrix) * uCenter);
    float breathe = 1.0 + 0.06 * sin(uTime * 1.3); // the bubble swells and settles a little, slowly
    vec4 wp = modelMatrix * vec4(position * (1.01 + uHeight * breathe * arch * inflate), 1.0);
    vWP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAG = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vWP;
  varying vec3 vN;
  varying vec3 vCW;
  uniform vec3 uCenter, uU, uV, uTint, uLight;
  uniform float uRadius, uProgress, uTime, uArrive, uSeed, uFull;
  uniform vec4 uHit0, uHit1, uHit2; // each: xyz = where a shot hit (on the sphere), w = when (-1 = none)
  ${NOISE3}

  float sq(float x) { return x * x; } // (pow with a negative base is undefined on some graphics cards)
  float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

  // a hexagon grid: xy = position inside the cell
  vec2 hexCell(vec2 p) {
    const vec2 s = vec2(1.7320508, 1.0);
    vec4 hC = floor(vec4(p, p - vec2(1.0, 0.5)) / s.xyxy) + 0.5;
    vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
    return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
  }
  float hexEdge(vec2 p) { p = abs(p); return max(dot(p, vec2(0.8660254, 0.5)), p.y); }

  // one shot hitting the shield: a flash, a ripple running out, and lightning crawling over the shell
  // (returns x = flash, y = ripple, z = lightning; written without an early return, which some graphics cards get wrong)
  vec3 strike(vec4 hit, vec3 p) {
    float on = step(0.0, hit.w) * step(uTime - hit.w, 2.4);
    float age = clamp(uTime - hit.w, 0.0, 2.0);
    float d = acos(clamp(dot(p, hit.xyz), -1.0, 1.0));
    // every part fades IN first and then OUT: nothing pops on or snaps off
    float fadeIn = smoothstep(0.0, 0.3, age);
    float flashEnv = fadeIn * (1.0 - smoothstep(0.3, 1.3, age));
    float flash = exp(-d * d / 0.008) * flashEnv;
    float ripple = exp(-sq((d - age * 0.45) / 0.06)) * smoothstep(0.0, 0.35, age) * (1.0 - smoothstep(0.8, 2.3, age));
    // lightning: thin branching electric veins that crawl out from the hit, quickly, then die away
    float reach = min(0.45, age * 1.6 + 0.06);
    float life = smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(0.35, 1.5, age));
    vec3 q = p * 24.0 + vec3(hit.w * 3.1, hit.w * 1.7, 5.0);
    float f1 = pow(1.0 - abs(noise3(q) * 2.0 - 1.0), 12.0);
    float f2 = pow(1.0 - abs(noise3(q * 2.1 + 7.0) * 2.0 - 1.0), 12.0);
    float bolts = (f1 + 0.6 * f2) * (1.0 - smoothstep(reach * 0.7, reach, d)) * smoothstep(0.015, 0.05, d) * life;
    return vec3(flash, ripple, bolts) * on;
  }

  void main() {
    vec3 p = normalize(vObj);
    float c = dot(p, uCenter);
    float ang = acos(clamp(c, -1.0, 1.0));
    float prog = clamp(uProgress, 0.0, 1.0);

    // how far the dome has spread; nothing beyond that
    float e = uRadius * (1.0 - pow(1.0 - prog, 3.0));
    float inside = 1.0 - smoothstep(e - 0.11, e, ang); // the skin thins out toward its edge instead of ending sharply
    float outer = 1.0 - smoothstep(e, e + 0.22, ang); // the glow carries on past the edge and fades out softly, so there is no hard cut
    if (max(inside, outer) <= 0.001) discard;

    vec3 V = normalize(cameraPosition - vWP);
    // the bubble's own surface direction: straight up at the top, leaning over to stand upright at its edge
    vec3 nW = normalize(vN);
    vec3 tW = normalize(nW - vCW * dot(nW, vCW));
    float lean = 1.5707963 * pow(clamp(ang / max(e, 0.001), 0.0, 1.0), 2.2) * smoothstep(0.0, 1.0, prog);
    vec3 N = normalize(nW * cos(lean) + tW * sin(lean));
    if (dot(N, V) < 0.0) N = -N; // seen from the other side of the shell it is the same glass
    float fr = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);

    // the bright thin edge where the bubble meets the ground, and the front of the spread while powering up
    float edgeLine = exp(-sq((ang - e) / 0.075)) * (0.4 + 0.35 * uFull) * (0.82 + 0.36 * (0.5 + 0.5 * sin(uTime * 1.3)));
    float edgeGlow = exp(-sq((ang - e) / 0.2)) * 0.2;
    float front = exp(-sq((ang - e) / 0.07)) * (1.0 - prog) * 0.55;

    // faint energy veins drifting through the glass, and a soft sheen
    vec3 q = p * 5.0 + vec3(uTime * 0.05, uSeed, -uTime * 0.04);
    float v1 = pow(1.0 - abs(noise3(q) * 2.0 - 1.0), 8.0);
    float v2 = pow(1.0 - abs(noise3(q * 2.3 + 4.1) * 2.0 - 1.0), 8.0);
    float veins = v1 * 0.7 + v2 * 0.45;
    float spec = pow(max(dot(reflect(-normalize(uLight), N), V), 0.0), 40.0);
    float sheen = spec * 0.5 + (0.01 + 0.07 * fr) * (0.5 + 0.5 * sin(ang * 9.0 - uTime * 0.6));

    // shots hitting the shield: a flash, a ripple (the hexagon cells flare inside it) and lightning crawling over the shell
    vec2 hq = vec2(dot(p, uU), dot(p, uV)) / max(c, 0.2) * 7.0;
    float hexLine = smoothstep(0.36, 0.47, hexEdge(hexCell(hq)));
    vec3 hits = strike(uHit0, p) + strike(uHit1, p) + strike(uHit2, p);
    float flash = hits.x, ripple = hits.y, bolts = hits.z;

    // the glass itself is nearly clear: light is added on top of the planet, so anything much above a whisper washes it out
    float pulse = 0.5 + 0.5 * sin(uTime * 1.3); // a slow, smooth breath
    float rest = (0.012 + 0.04 * fr + fr * (0.5 + 0.25 * uFull) + veins * (0.05 + 0.3 * fr) + sheen) * (0.78 + 0.44 * pulse);
    float a = (rest + ripple * (0.12 + 0.6 * hexLine) + flash * 0.55 + bolts * 0.6) * inside + (edgeLine + edgeGlow + front) * outer;
    a *= uArrive;
    vec3 col = mix(uTint, vec3(1.0), clamp(0.3 + bolts + flash + front * 0.5 + edgeLine * 0.25, 0.0, 1.0));
    gl_FragColor = vec4(col * a, a);
  }
`

function labelTexture(team: 'A' | 'B') {
  const cv = document.createElement('canvas')
  cv.width = 512
  cv.height = 128
  const c = cv.getContext('2d')!
  const col = TEAM_TEXT[team]
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
  const mat = useRef<THREE.ShaderMaterial>(null)
  const spot = useMemo(() => zoneSpot(zone.id), [zone.id])
  const radius = useRef(full ? NETWORK_RADIUS : DOME_RADIUS)
  const hits = useRef({ next: 0.1, slot: 0, last: -1 })
  const tmp = useMemo(() => ({ q: new THREE.Quaternion(), centre: new THREE.Vector3(), toCam: new THREE.Vector3(), world: new THREE.Vector3(), t: new THREE.Vector3(), a: new THREE.Vector3() }), [])
  const tex = useMemo(() => labelTexture(zone.team), [zone.team])
  useEffect(() => () => tex.dispose(), [tex])
  // DEV-TOOLS: the test panel's "fire a shot" button makes every shield take a hit right away
  useEffect(() => {
    const hit = () => { hits.current.next = 0 }
    window.addEventListener('shield-test-hit', hit)
    return () => window.removeEventListener('shield-test-hit', hit)
  }, [])

  const uniforms = useMemo(() => {
    const up = Math.abs(spot.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const u = new THREE.Vector3().crossVectors(up, spot).normalize()
    const v = new THREE.Vector3().crossVectors(spot, u)
    return {
      uCenter: { value: spot.clone() },
      uU: { value: u },
      uV: { value: v },
      uTint: { value: new THREE.Vector3(...TEAM_TINT[zone.team]) },
      uLight: { value: LIGHT },
      uRadius: { value: DOME_RADIUS },
      uHeight: { value: 0.085 },
      uProgress: { value: 1 },
      uFull: { value: 0 },
      uTime: { value: 0 },
      uArrive: arriveFade,
      uSeed: { value: (zone.id.length * 7.3) % 5 },
      uHit0: { value: new THREE.Vector4(0, 0, 1, -1) },
      uHit1: { value: new THREE.Vector4(0, 0, 1, -1) },
      uHit2: { value: new THREE.Vector4(0, 0, 1, -1) },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one stable uniforms object per shield; radius and progress are set every frame
  }, [spot, zone.team, zone.id])

  useFrame((s, dt) => {
    const g = group.current
    // the material's own uniforms (what the renderer actually reads), not the object this component made
    const U = mat.current?.uniforms as typeof uniforms | undefined
    if (!g || !g.parent || !U) return
    const now = s.clock.elapsedTime
    const prog = zone.at ? Math.min(1, (Date.now() - zone.at) / 1000 / POWER_UP_S) : 1
    const slow = (import.meta.env.DEV && (window as unknown as { __shieldSlow?: number }).__shieldSlow) || 1 // dev only: slow motion, to look at an effect
    U.uTime.value = now / slow
    // dev only: `__shieldHold = 0.2` freezes the latest hit at that age (seconds), to look at one moment of it
    const hold = import.meta.env.DEV ? (window as unknown as { __shieldHold?: number }).__shieldHold : undefined
    if (hold !== undefined && hits.current.last >= 0) U.uTime.value = hits.current.last + hold
    U.uProgress.value = prog
    // widen to one joined network when the planet is fully held (and back again)
    const target = full ? NETWORK_RADIUS : DOME_RADIUS
    radius.current += (target - radius.current) * Math.min(1, dt * 2.2)
    U.uRadius.value = radius.current
    U.uHeight.value = 0.085 + 0.1 * (radius.current - DOME_RADIUS) // a thin skin over the ground; a wider dome stands a touch taller
    U.uFull.value = Math.min(1, Math.max(0, (radius.current - DOME_RADIUS) / (NETWORK_RADIUS - DOME_RADIUS)))

    // shots hitting the shield: a burst of them while it powers up, then now and then
    const h = hits.current
    if (now >= h.next) {
      const ang = Math.random() * Math.PI * 2
      const rho = Math.random() * radius.current * 0.8
      tmp.a.set(Math.abs(spot.y) > 0.95 ? 1 : 0, Math.abs(spot.y) > 0.95 ? 0 : 1, 0)
      tmp.t.crossVectors(tmp.a, spot).normalize().applyAxisAngle(spot, ang)
      tmp.a.copy(spot).applyAxisAngle(tmp.t, rho)
      ;[U.uHit0, U.uHit1, U.uHit2][h.slot % 3].value.set(tmp.a.x, tmp.a.y, tmp.a.z, now / slow)
      h.slot++
      h.last = now / slow
      h.next = now + (prog < 1 ? 0.7 + Math.random() * 0.4 : 2.6 + Math.random() * 2.4)
    }

    // the label: visible while its spot faces the viewer, like the reticle's; it arrives as the dome finishes
    const parent = g.parent
    parent.getWorldQuaternion(tmp.q)
    parent.getWorldPosition(tmp.centre)
    tmp.toCam.copy(s.camera.position).sub(tmp.centre).normalize()
    tmp.world.copy(spot).applyQuaternion(tmp.q)
    const facing = tmp.world.dot(tmp.toCam)
    if (label.current) {
      const edge = Math.min(1, Math.max(0, (facing - 0.1) / 0.35))
      const pop = Math.min(1, Math.max(0, (prog - 0.55) / 0.45))
      const joined = U.uFull.value // one joined network: the banner says it instead
      ;(label.current.material as THREE.SpriteMaterial).opacity = edge * pop * (1 - joined) * arriveFade.value
      label.current.position.copy(spot).multiplyScalar(PLANET_RADIUS * (1.04 + U.uHeight.value * Math.min(1, prog * 1.4)))
    }
  })

  return (
    <group ref={group}>
      <mesh geometry={SHIELD_GEOMETRY} renderOrder={9} frustumCulled={false}>
        <shaderMaterial
          ref={mat}
          uniforms={uniforms}
          vertexShader={VERT}
          fragmentShader={FRAG}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.FrontSide}
        />
      </mesh>
      <sprite ref={label} scale={[0.62, 0.155, 1]} renderOrder={12}>
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
