import * as THREE from 'three'
import { NOISE3, NOISE3_LOOP } from './glsl'
import { REAL_FRAG, HERO_HEAD, HERO_TAIL, HERO_BODIES } from './planetShaders'

// Planets are drawn from textures, not by running the whole procedural shader for every pixel on every frame.
//
// The planet's surface (its colours, clouds, glowing cities, relief) is worked out ONCE by the same shader code, written into a few
// textures, a thin band of rows at a time so the page never freezes while it happens. After that the planet is drawn by a small
// shader that only reads those textures and does the lighting, which any graphics card can run smoothly. The result looks the
// same as before; it just costs a fraction of the work, and the long shader compile is avoided too (the baking program uses real
// loops, so it stays small).
//
// Everything that depends on the lighting (which side faces the sun, the glint on the sea, the night-side glow) is NOT baked:
// the cheap shader still does that every frame, so the planet turns and is lit exactly as before.


const BAKE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** Each pixel of the baking texture is a direction on the sphere (longitude across, latitude up), worked out per pixel. */
const DIR = /* glsl */ `
  varying vec2 vUv;
  vec3 dirOf(vec2 t) {
    float lon = (t.x - 0.5) * 6.2831853;
    float lat = (t.y - 0.5) * 3.14159265;
    return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  }
`

/** The sphere direction -> texture coordinates, the exact inverse of the baking vertex shader. */
const SPH = /* glsl */ `
  vec2 sph(vec3 p) {
    return vec2(atan(p.x, p.z) / 6.2831853 + 0.5, asin(clamp(p.y, -1.0, 1.0)) / 3.14159265 + 0.5);
  }
`

// ---------------------------------------------------------------------------------------------------------------- generic worlds

/** What a generic world needs from its surface: colour, land, cloud, city and road lights, lava, relief. */
function bakeFragmentReal(): string {
  const head = REAL_FRAG.slice(0, REAL_FRAG.indexOf('void main()')).replace(NOISE3, NOISE3_LOOP)
  return `
  ${head.replace('varying vec3 vObj;', DIR)}
  layout(location = 0) out highp vec4 o0;
  layout(location = 1) out highp vec4 o1;
  layout(location = 2) out highp vec4 o2;
  layout(location = 3) out highp vec4 o3;

  void main() {
    vec3 p = dirOf(vUv);
    float rid;
    float h0 = terrain(p, rid);
    float cr = craterField(p) * uCraters;
    float H = h0 + cr * 0.35;

    // relief
    float e = 0.012, r2;
    vec3 slope = vec3(surface(p + vec3(e, 0.0, 0.0), r2) - H, surface(p + vec3(0.0, e, 0.0), r2) - H, surface(p + vec3(0.0, 0.0, e), r2) - H) / e;
    float isLand = smoothstep(uSea - 0.012, uSea + 0.012, h0);

    // surface colour
    float tone = fbm3d(p * uScale * 1.2 + uSeed + 9.0);
    vec3 land = mix(uLandA, uLandB, smoothstep(0.25, 0.75, tone));
    land *= 0.8 + 0.4 * smoothstep(0.2, 0.8, h0);
    land *= 1.0 + cr * 0.6;
    land *= 0.88 + 0.24 * rid;
    land *= 0.9 + 0.2 * fbm3d(p * uScale * 10.0 + uSeed);
    land *= 1.0 - 0.28 * max(step(0.95, uCity) * 0.0 + uGrid, 0.0) * step(0.5, noise3(p * 70.0 + uSeed));
    vec3 ocean = mix(uDeep, uShallow, smoothstep(uSea - 0.2, uSea, h0));
    vec3 col = mix(ocean, land, isLand);
    float ice = smoothstep(0.76, 0.92, abs(p.y) + (h0 - 0.5) * 0.3) * uIce;
    col = mix(col, vec3(0.9, 0.94, 1.0), ice);
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 0.9);

    // clouds
    vec3 cq = p * 2.2 + uSeed;
    vec3 cw = vec3(fbm3d(cq + vec3(uTime * 0.01, 0.0, 0.0) + 1.7), fbm3d(cq + 4.3), fbm3d(cq + 8.1)) - 0.5;
    float swirl = fbm3d(cq * 1.3 + cw * 2.4);
    float band = 0.5 + 0.5 * sin(p.y * 9.0 + cw.x * 5.0);
    float cloud = smoothstep(0.42, 0.85, swirl * 0.8 + band * 0.25) * uCloud;

    // lights that only wait for night to be switched on (the night factor itself is applied when drawing)
    float clusters = smoothstep(0.48 - 0.25 * uGrid, 0.72 - 0.25 * uGrid, fbm3d(p * 5.0 + uSeed + 40.0));
    float dots = step(0.7 - 0.12 * uGrid, noise3(p * 90.0));
    float cityN = clusters * dots * isLand * uCity * (1.0 - cloud * 0.6) * 1.7;
    float gridG = 0.0;
    if (uGrid > 0.0) gridG = gridGlow(p) * isLand * uGrid * (1.0 - cloud * 0.7);

    // lava and cracks glow on their own
    float vein = abs(fbm3d(p * uScale * 1.6 + uSeed + 21.0) - 0.5);
    float lowland = smoothstep(0.58, 0.32, h0);
    float g = clamp(1.0 - vein * 10.0, 0.0, 1.0);
    vec3 lavaCol = mix(vec3(0.75, 0.1, 0.02), vec3(1.0, 0.78, 0.35), g * g);
    float molten = uLava * isLand * (0.35 + 0.65 * lowland) + uCrack;

    o0 = vec4(col, isLand);
    o1 = vec4(cloud, cityN, gridG, pow(g, 1.5) * molten * 0.12);
    o2 = vec4(slope * 0.07, 0.0);
    o3 = vec4(lavaCol * pow(g, 3.0) * molten * 1.3, 0.0);
  }
`
}

/** The drawing shader for a generic world: all the lighting of the original, reading the baked surface. */
function liteFragmentReal(): string {
  return `
  varying vec3 vObj;
  varying vec3 vWN;
  varying vec3 vWP;
  uniform sampler2D tA, tB, tC, tD;
  uniform float uAmbient, uHaze;
  uniform vec3 uCloudCol, uAtmo, uLight;
  uniform mat3 uModelRot;
  ${SPH}
  void main() {
    vec2 uv = sph(normalize(vObj));
    vec4 a = texture2D(tA, uv);
    vec4 b = texture2D(tB, uv);
    vec3 col = a.rgb;
    float isLand = a.a;
    float cloud = b.r, cityN = b.g, gridG = b.b, moltenGlow = b.a;
    vec3 N = normalize(vWN);
    vec3 V = normalize(cameraPosition - vWP);
    vec3 L = normalize(uLight);
    vec3 Nb = normalize(mix(N, normalize(N - uModelRot * texture2D(tC, uv).rgb), isLand));

    float ndl = dot(N, L);
    float soft = smoothstep(-0.2, 0.6, ndl);
    float diff = max(dot(Nb, L), 0.0);
    vec3 lit = col * (uAmbient + soft * (0.22 + 1.05 * diff));
    vec3 cloudLit = uCloudCol * (0.03 + soft * (0.35 + 0.8 * max(ndl, 0.0)));
    lit = mix(lit, cloudLit, cloud * 0.9);
    lit += vec3(0.8, 0.9, 1.0) * pow(max(dot(reflect(-L, Nb), V), 0.0), 28.0) * (1.0 - isLand) * (1.0 - cloud) * soft * 0.35;

    float night = 1.0 - smoothstep(-0.05, 0.2, ndl);
    lit += vec3(1.0, 0.78, 0.45) * cityN * night;
    lit += vec3(1.0, 0.68, 0.28) * gridG * (0.3 + 0.9 * night);
    lit *= 1.25;

    float limb = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    lit += uAtmo * limb * (0.12 + 0.9 * soft) * uHaze * 0.7;
    lit += uAtmo * 0.15 * soft * limb * uHaze * 0.5;
    lit += mix(vec3(1.0, 0.5, 0.25), uAtmo, 0.3) * exp(-pow(ndl * 5.0, 2.0)) * 0.1 * uHaze;

    lit += texture2D(tD, uv).rgb;
    lit += vec3(1.0, 0.3, 0.05) * moltenGlow * (1.0 - soft * 0.5);

    gl_FragColor = vec4(lit, 1.0);
  }
`
}

// ---------------------------------------------------------------------------------------------------------------- hero worlds

/** Lines of the original lighting set-up that the baking shader does not have (there is no sun or camera while baking). */
const LIGHTING_LINES = [
  'vec3 N = normalize(vWN);',
  'vec3 V = normalize(cameraPosition - vWP);',
  'vec3 L = normalize(uLight);',
  'float ndl = dot(N, L);',
  'float soft = smoothstep(-0.2, 0.6, ndl);',
  'float night = 1.0 - smoothstep(-0.05, 0.2, ndl);',
  'vec3 Nb = normalize(N - (uModelRot * slope) * 0.05);',
]

/**
 * A hero world's own look, written out. Its glow is always "something x (a + b x night)", a straight line in `night`, so the glow
 * is baked twice (in full day and in full night) and the drawing shader blends between the two by how dark that spot is.
 */
function bakeFragmentHero(hero: number): string {
  const lines = HERO_HEAD.replace(NOISE3, NOISE3_LOOP).split('\n').filter((l) => !LIGHTING_LINES.includes(l.trim()))
  let head = lines.join('\n')
  head = head.replace('uniform float uTime, uSeed;', `uniform float uTime, uSeed, uNight, uPass;
  layout(location = 0) out highp vec4 o0;
  layout(location = 1) out highp vec4 o1;
  layout(location = 2) out highp vec4 o2;`)
  head = head.replace('varying vec3 vObj;', DIR).replace('vec3 p = vObj;', 'vec3 p = dirOf(vUv);\n    float night = uNight;')
  return `#define HERO ${hero}\n${head}    {\n${HERO_BODIES[hero]}    }
    if (uPass < 0.5) o0 = vec4(col, water); else o0 = vec4(glow, 0.0);
    o1 = vec4(glow, cloud);
    o2 = vec4(slope * 0.05, 0.0);
  }
`
}

/** The few constants a hero world sets in its own look (they are the same everywhere on it, so they need no texture). */
function heroConstants(hero: number): { cloudCol: string; rim: string } {
  const body = HERO_BODIES[hero]
  const grab = (name: string) => new RegExp(`\\b${name}\\s*=\\s*vec3\\(([^)]*)\\)`).exec(body)?.[1] ?? '1.0, 1.0, 1.0'
  return { cloudCol: grab('cloudCol'), rim: grab('rim') }
}

/** The drawing shader for a hero world: the original lighting code, word for word, fed from the baked surface. */
function liteFragmentHero(hero: number): string {
  const k = heroConstants(hero)
  return `#define HERO ${hero}
  varying vec3 vObj;
  varying vec3 vWN;
  varying vec3 vWP;
  uniform sampler2D tA, tB, tC, tD;
  uniform vec3 uLight;
  uniform mat3 uModelRot;
  ${SPH}
  void main() {
    vec2 uv = sph(normalize(vObj));
    vec4 a = texture2D(tA, uv);
    vec4 b = texture2D(tB, uv);
    vec3 N = normalize(vWN);
    vec3 V = normalize(cameraPosition - vWP);
    vec3 L = normalize(uLight);
    float ndl = dot(N, L);
    float soft = smoothstep(-0.2, 0.6, ndl);
    float night = 1.0 - smoothstep(-0.05, 0.2, ndl);
    vec3 col = a.rgb;
    float water = a.a;
    float cloud = b.a;
    vec3 glow = mix(b.rgb, texture2D(tD, uv).rgb, night);
    vec3 Nb = normalize(N - uModelRot * texture2D(tC, uv).rgb);
    vec3 cloudCol = vec3(${k.cloudCol});
    vec3 rim = vec3(${k.rim});
${HERO_TAIL}`
}

// ---------------------------------------------------------------------------------------------------------------- the baker

export const liteFragmentFor = (hero: number) => (hero > 0 && HERO_BODIES[hero] ? liteFragmentHero(hero) : liteFragmentReal())

/** Can this graphics card draw into half-float textures (needed to hold the baked values)? */
export function canBake(gl: THREE.WebGLRenderer): boolean {
  return gl.capabilities.isWebGL2 && (gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float'))
}

export interface BakedSurface { a: THREE.Texture; b: THREE.Texture; c: THREE.Texture; d: THREE.Texture }

/** The two sizes planets are baked at: every planet gets the soft one in the background; the one you pick gets the sharp one. */
export const SIZE_LOW: [number, number] = [512, 256]
export const SIZE_HIGH: [number, number] = [1024, 512]

/** The textures of one stage (and the second set that holds the full-night glow of a hero world). */
interface Targets { main: THREE.WebGLRenderTarget; night: THREE.WebGLRenderTarget | null; w: number; h: number }

/**
 * One planet's surface being baked, at one size. Call `compile()` once, then `step()` every frame until `done`. Each step draws a
 * band of rows sized to take a few milliseconds on this graphics card; `surface` is the finished set of textures.
 */
export class PlanetBake {
  done = false
  surface: BakedSurface | null = null
  private readonly gl: THREE.WebGLRenderer
  private readonly isHero: boolean
  private readonly size: [number, number]
  private readonly material: THREE.ShaderMaterial
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.Camera()
  private readonly opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false }
  private work: Targets
  private pass = 0
  private y = 0
  private rows = 2
  private readonly probe = new Uint16Array(4)

  /** `size`: the texture size; 1x1 is only used to get the program compiled ahead of time. */
  constructor(gl: THREE.WebGLRenderer, uniforms: Record<string, { value: unknown }>, hero: number, size: [number, number] = SIZE_LOW) {
    this.gl = gl
    this.isHero = hero > 0 && !!HERO_BODIES[hero]
    this.size = size
    this.work = this.makeTargets(this.size)
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...uniforms, uOct: { value: 6 }, uNight: { value: 0 }, uPass: { value: 0 }, uTime: { value: 0 } },
      vertexShader: BAKE_VERT,
      fragmentShader: this.isHero ? bakeFragmentHero(hero) : bakeFragmentReal(),
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    quad.frustumCulled = false
    this.scene.add(quad)
  }

  private makeTargets([w, h]: [number, number]): Targets {
    const main = new THREE.WebGLRenderTarget(w, h, { ...this.opts, count: this.isHero ? 3 : 4 })
    const night = this.isHero ? new THREE.WebGLRenderTarget(w, h, this.opts) : null
    for (const t of [...main.textures, ...(night ? night.textures : [])]) {
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.ClampToEdgeWrapping
    }
    return { main, night, w, h }
  }

  /** Start the program compiling (in parallel with the page where the browser can) and wait until it is ready. */
  async compile(): Promise<void> {
    const gl = this.gl
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(this.work.main) // the program is built for drawing into a texture, so compile it that way
    const ready = gl.compileAsync(this.scene, this.camera)
    gl.setRenderTarget(prev)
    await ready
  }

  /** Bake one more band of rows. */
  step(): void {
    if (this.done) return
    const gl = this.gl
    const { w, h } = this.work
    const ts = performance.now()
    const target = this.pass === 0 ? this.work.main : this.work.night!
    const rows = Math.min(this.rows, h - this.y)
    const prevTarget = gl.getRenderTarget()
    const prevAuto = gl.autoClear
    gl.autoClear = false
    target.scissorTest = true
    target.scissor.set(0, this.y, w, rows)
    target.viewport.set(0, 0, w, h)
    this.material.uniforms.uPass.value = this.pass
    this.material.uniforms.uNight.value = this.pass
    gl.setRenderTarget(target)
    gl.render(this.scene, this.camera)
    // Draw calls only queue work for the graphics card, so how long they take on the page says nothing about the card. Reading one
    // pixel back makes the page wait until this band is really finished, which tells how long it took; the next band is sized to
    // take about 8 ms, so frames stay short on a fast card and on a slow one.
    gl.readRenderTargetPixels(target, 0, this.y, 1, 1, this.probe, 0)
    gl.setRenderTarget(prevTarget)
    gl.autoClear = prevAuto
    const took = Math.max(0.5, performance.now() - ts)
    this.rows = Math.max(1, Math.min(160, Math.round(rows * Math.min(1.6, Math.max(0.4, 8 / took)))))

    this.y += rows
    if (this.y < h) return
    this.y = 0
    this.pass++
    if (this.pass < (this.isHero ? 2 : 1)) return

    const t = this.work.main.textures
    this.surface = { a: t[0], b: t[1], c: t[2], d: this.work.night ? this.work.night.texture : t[3] }
    this.done = true
  }

  private dispose(t: Targets | null) {
    t?.main.dispose()
    t?.night?.dispose()
  }

  /** Free the baking program's geometry (the finished textures are freed by `disposeSurface`). */
  disposeWork() {
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose() })
  }

  disposeSurface() {
    this.dispose(this.work)
  }

  /** Keep the compiled program alive in the renderer's cache (see the warm-up). */
  get programMaterial(): THREE.Material {
    return this.material
  }
}
