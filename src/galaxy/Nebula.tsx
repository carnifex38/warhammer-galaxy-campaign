import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Era } from './planetLooks'
import { sliced } from '../idle'

// SkyNebula: very faint, wispy interstellar dust and nebulae far behind everything, on both maps.

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ---------------------------------------------------------------------------------------------------------------
// the sky: a tiling texture of wispy dust, baked once in small slices (so nothing ever freezes the screen)
// ---------------------------------------------------------------------------------------------------------------

const SKY_SIZE = 512

function hash2(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Value noise that repeats every P cells in both directions, so the texture tiles with no seams. */
function pnoise(x: number, y: number, P: number) {
  const xi = Math.floor(x), yi = Math.floor(y)
  let fx = x - xi, fy = y - yi
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)
  const x0 = ((xi % P) + P) % P, x1 = (x0 + 1) % P
  const y0 = ((yi % P) + P) % P, y1 = (y0 + 1) % P
  const a = hash2(x0, y0), b = hash2(x1, y0), c = hash2(x0, y1), d = hash2(x1, y1)
  const top = a + (b - a) * fx
  const bottom = c + (d - c) * fx
  return top + (bottom - top) * fy
}

function pfbm(x: number, y: number, P: number, octaves: number) {
  let v = 0, a = 0.5
  for (let i = 0; i < octaves; i++) {
    v += a * pnoise(x, y, P)
    x *= 2
    y *= 2
    P *= 2
    a *= 0.5
  }
  return v
}

let skyPromise: Promise<THREE.DataTexture> | null = null

/** The wispy sky texture. Built once, in 4 ms slices, and remembered. */
export function prepareSky(): Promise<THREE.DataTexture> {
  if (!skyPromise) skyPromise = bakeSky()
  return skyPromise
}

async function bakeSky(): Promise<THREE.DataTexture> {
  const data = new Uint8Array(SKY_SIZE * SKY_SIZE * 4)
  const P = 4 // the pattern repeats every 4 base cells across the texture
  await sliced(SKY_SIZE, (j) => {
    const y = (j / SKY_SIZE) * P
    for (let i = 0; i < SKY_SIZE; i++) {
      const x = (i / SKY_SIZE) * P
      // domain warp: bends the clouds into long, curling wisps
      const wx = pfbm(x + 5.1, y + 1.7, P, 2) * 1.5
      const wy = pfbm(x + 9.3, y + 6.2, P, 2) * 1.5
      const px = x + wx, py = y + wy
      const haze = smoothstep(0.42, 0.85, pfbm(px, py, P, 4))
      // thin filaments along the edges of a finer noise field, only inside the haze
      const ridge = 1 - Math.abs(2 * pfbm(px * 3 + 3.3, py * 3, P * 3, 3) - 1)
      const fil = Math.pow(ridge, 7) * smoothstep(0.25, 0.7, haze + 0.2)
      // a second cloud in another colour for variety
      const other = smoothstep(0.5, 0.9, pfbm(px + 20.5, py + 8.8, P, 3))
      const r = 0.05 * haze + 0.10 * fil + 0.06 * other
      const g = 0.05 * haze + 0.06 * fil + 0.10 * other
      const b = 0.12 * haze + 0.14 * fil + 0.12 * other
      const o = (j * SKY_SIZE + i) * 4
      data[o] = Math.min(255, r * 255)
      data[o + 1] = Math.min(255, g * 255)
      data[o + 2] = Math.min(255, b * 255)
      data[o + 3] = 255
    }
  }, 4)
  const tex = new THREE.DataTexture(data, SKY_SIZE, SKY_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

const DOME_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

// The tiling texture is projected onto the dome from three directions and blended, so there are no poles to pinch and no seam.
const DOME_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform sampler2D uTex;
  uniform vec3 uTint;
  uniform float uOpacity;
  void main() {
    vec3 d = normalize(vDir);
    vec3 w = pow(abs(d), vec3(6.0));
    w /= (w.x + w.y + w.z);
    const float S = 0.9;
    vec3 c = w.x * texture2D(uTex, d.zy * S + 0.13).rgb
           + w.y * texture2D(uTex, d.xz * S + 0.41).rgb
           + w.z * texture2D(uTex, d.xy * S + 0.77).rgb;
    gl_FragColor = vec4(c * uTint * uOpacity, 1.0);
  }
`

/** Faint dust and nebulae on a huge dome behind the whole map, following the camera so it is always the backdrop. */
export function SkyNebula({ era }: { era: Era }) {
  const camera = useThree((s) => s.camera)
  const mesh = useRef<THREE.Mesh>(null)
  const mat = useRef<THREE.ShaderMaterial>(null)
  const [tex, setTex] = useState<THREE.DataTexture | null>(null)
  useEffect(() => {
    let live = true
    void prepareSky().then((t) => { if (live) setTex(t) })
    return () => { live = false }
  }, [])

  const uniforms = useMemo(
    () => ({ uTex: { value: null as THREE.Texture | null }, uTint: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0 } }),
    [],
  )
  const tint = useMemo(() => ({ '40k': new THREE.Color(1, 0.8, 0.95), '30k': new THREE.Color(0.78, 0.92, 1) }), [])
  useFrame((_, dt) => {
    const m = mesh.current
    if (m) {
      m.position.copy(camera.position)
      m.rotation.y += dt * 0.004 // barely drifts
    }
    const u = mat.current?.uniforms // write through the material (its uniforms are not always the same object as `uniforms`)
    if (u) {
      u.uTex.value = tex
      u.uTint.value.lerp(tint[era], Math.min(1, dt * 2)) // the two eras are tinted a little differently
      u.uOpacity.value = Math.min(1, u.uOpacity.value + dt * 0.5) // fades in
    }
  })
  if (!tex) return null
  return (
    <mesh ref={mesh} frustumCulled={false} renderOrder={-30}>
      <sphereGeometry args={[100, 48, 32]} />
      <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={DOME_VERT} fragmentShader={DOME_FRAG} side={THREE.BackSide} transparent blending={THREE.AdditiveBlending} depthWrite={false} depthTest={false} />
    </mesh>
  )
}

