import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import SpaceHulk from './SpaceHulk'
import TheRock from './TheRock'
import { isHulkName } from './data'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PLANET_VERT, REAL_FRAG, HERO_HEAD, HERO_TAIL, HERO_BODIES } from './planetShaders'
import { PlanetBake, canBake, liteFragmentFor } from './planetBake'
import BaalMoons from './BaalMoons'
import CadiaPylons from './CadiaPylons'
import MacraggeOrbit from './MacraggeOrbit'
import MarsShipyard from './MarsShipyard'
import NecromundaSpires from './NecromundaSpires'
import ShatteredField from './ShatteredField'
import { lookFor, lookNameFor, seedFor, type Era } from './planetLooks'

/** Dev only: `?freeze` stops the planet turning, so a feature can be checked. */
const FROZEN = import.meta.env.DEV && new URLSearchParams(location.search).has('freeze')

export const PLANET_RADIUS = 0.62


const heroCache = new Map<number, string>()

/**
 * The shader for one hero planet. Each planet gets a shader containing only its own look: the graphics
 * driver then compiles a small program instead of one huge one (this is what made planets slow to open).
 */
function heroFragment(hero: number): string {
  let src = heroCache.get(hero)
  if (!src) {
    src = `#define HERO ${hero}\n` + HERO_HEAD + '    {\n' + HERO_BODIES[hero] + '    }\n' + HERO_TAIL
    heroCache.set(hero, src)
  }
  return src
}

/** Which fragment shader draws a planet with this hero id. */
function fragmentFor(hero: number): string {
  return withArriveFade(hero > 0 && HERO_BODIES[hero] ? heroFragment(hero) : REAL_FRAG)
}

/**
 * How solid the picked planet is while it arrives (0 to 1). It lives in the shaders themselves, so the planets compiled in
 * the background at start-up are exactly the ones drawn later, and opening a planet never waits on a compile.
 */
export const arriveFade = { value: 1 }

function withArriveFade(src: string): string {
  return `uniform float uArrive;
${src.replace(/gl_FragColor\s*=\s*([^;]+);/g, 'gl_FragColor = $1; gl_FragColor.a *= uArrive;')}`
}

const ATMO_VERT = /* glsl */ `
  varying vec3 vN;
  void main() {
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const ATMO_FRAG = withArriveFade(/* glsl */ `
  uniform vec3 uAtmo;
  uniform float uStrength;
  varying vec3 vN;
  void main() {
    float i = pow(max(0.0, 0.62 - dot(vN, vec3(0.0, 0.0, 1.0))), 3.0) * uStrength;
    gl_FragColor = vec4(uAtmo * i * 1.4, i);
  }
`)

function makePlanetUniforms(name: string, era: Era) {
  const look = lookFor(name, era)
  return {
    uTime: { value: 0 },
    uSea: { value: look.sea },
    uIce: { value: look.ice },
    uCloud: { value: look.cloud },
    uCity: { value: look.city },
    uLava: { value: look.lava },
    uCrack: { value: look.crack },
    uScale: { value: look.scale },
    uSeed: { value: seedFor(name) },
    uDeep: { value: new THREE.Color(look.deep) },
    uShallow: { value: new THREE.Color(look.shallow) },
    uLandA: { value: new THREE.Color(look.landA) },
    uLandB: { value: new THREE.Color(look.landB) },
    uCloudCol: { value: new THREE.Color(look.cloudCol) },
    uAtmo: { value: new THREE.Color(look.atmo) },
    uLight: { value: new THREE.Vector3(-0.8, 0.35, 0.55) },
    uModelRot: { value: new THREE.Matrix3() },
        uHaze: { value: look.atmoStrength },
    uCraters: { value: look.craters },
    uAmbient: { value: look.ambient },
    uGrid: { value: look.grid },
    uArrive: arriveFade,
    uCells: { value: 27 }, // the 3x3x3 neighbourhood searched by the cell patterns (kept as a uniform so the loop is a real loop)
  }
}

/** One planet from each kind of shader, used to compile everything in the background at startup. */
export const WARMUP_PLANETS: { label: string; name: string; era: Era }[] = [
  { label: 'Terra', name: 'Terra', era: '40k' },
  { label: 'Mars', name: 'Mars', era: '40k' },
  { label: 'Macragge', name: 'Macragge', era: '40k' },
  { label: 'Necromunda', name: 'Necromunda', era: '40k' },
  { label: 'Cadia', name: 'Cadia', era: '30k' },
  { label: 'Baal', name: 'Baal', era: '40k' },
  { label: 'Fenris', name: 'Fenris', era: '40k' },
  { label: 'Prospero', name: 'Prospero', era: '30k' },
  { label: 'Prospero (ruin)', name: 'Prospero', era: '40k' },
  { label: 'other worlds', name: 'Tallarn', era: '40k' },
]

/** Which planet shaders the graphics driver has already compiled (by shader, not by planet: several planets share one). */
const compiledShaders = new Set<number>()
const shaderKey = (name: string, era: Era) => { const h = lookFor(name, era).hero; return h > 0 && HERO_BODIES[h] ? h : 0 }
export const shaderReady = (name: string, era: Era) => compiledShaders.has(shaderKey(name, era))
export const markShaderReady = (name: string, era: Era) => { compiledShaders.add(shaderKey(name, era)) }
const keptMaterials: THREE.Material[] = [] // held so a compiled program stays in the renderer's cache

/** A planet material built exactly like the real one, so compiling it first means opening that planet later is instant. */
export function createWarmupMaterial(name: string, era: Era) {
  return new THREE.ShaderMaterial({
    uniforms: makePlanetUniforms(name, era),
    vertexShader: PLANET_VERT,
    fragmentShader: fragmentFor(lookFor(name, era).hero),
    transparent: true,
  })
}

/**
 * Compile a world's baking program ahead of time (into a 1x1 texture, only to get the program built and cached). The returned
 * material must be kept alive, or the renderer drops the compiled program again.
 */
export async function warmBake(gl: THREE.WebGLRenderer, name: string, era: Era): Promise<THREE.Material> {
  const b = new PlanetBake(gl, makePlanetUniforms(name, era), lookFor(name, era).hero, true)
  await b.compile()
  b.disposeSurface()
  return b.programMaterial
}

/** Surfaces already baked, newest last; the oldest are freed so a long session does not fill the graphics memory. */
const bakedCache = new Map<string, PlanetBake>()
const BAKED_KEEP = 3

/** Dev only: `?direct` draws with the full shader on every frame, as before baking, to compare the looks. */
const DIRECT = import.meta.env.DEV && new URLSearchParams(location.search).has('direct')

/** Built once and reused by every planet that is picked, so choosing one does not rebuild the sphere. */
const PLANET_GEOMETRY = new THREE.SphereGeometry(PLANET_RADIUS, 96, 64)

function SpherePlanet({ name, era, position, surface }: { name: string; era: Era; position: [number, number, number]; surface?: ReactNode }) {
  const spin = useRef<THREE.Group>(null)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const planetUniforms = useMemo(() => makePlanetUniforms(name, era), [name, era])
  const hero = lookFor(name, era).hero
  const bakes = !DIRECT && canBake(gl)

  // The surface is baked into textures once, a band of rows per frame (see planetBake.ts); until it is done a plain placeholder
  // globe is shown. A card that cannot draw into float textures falls back to the full shader below.
  const bakeKey = `${name}|${era}`
  const [baked, setBaked] = useState<PlanetBake | null>(() => bakedCache.get(bakeKey) ?? null)
  const [, setVersion] = useState(0) // a sharper stage of the baked surface is ready
  const working = useRef<{ bake: PlanetBake; compiled: boolean } | null>(null)
  useEffect(() => {
    if (!bakes) return
    const hit = bakedCache.get(bakeKey)
    if (hit) { bakedCache.delete(bakeKey); bakedCache.set(bakeKey, hit); setBaked(hit); return }
    setBaked(null)
    let live = true
    const bake = new PlanetBake(gl, planetUniforms, hero)
    const job = { bake, compiled: false }
    working.current = job
    void (async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))) // let the placeholder draw first
      if (!live) return
      try { await bake.compile() } catch { /* it will compile when first drawn instead */ }
      if (live) job.compiled = true
    })()
    return () => {
      live = false
      if (working.current === job) working.current = null
      if (!bake.done) { bake.disposeSurface(); bake.disposeWork() }
    }
  }, [bakes, bakeKey, gl, planetUniforms, hero])

  // Without baking: if this planet's shader has not been compiled yet, show a plain placeholder globe straight away and compile the
  // real one in the background (off the main thread where the browser can), then swap it in. Nothing waits on the compile.
  const [ready, setReady] = useState(() => shaderReady(name, era))
  useEffect(() => {
    if (bakes) return
    if (shaderReady(name, era)) { setReady(true); return }
    setReady(false)
    let live = true
    void (async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))) // let the placeholder draw first
      if (!live) return
      const mat = createWarmupMaterial(name, era)
      keptMaterials.push(mat)
      const holder = new THREE.Mesh(new THREE.SphereGeometry(0.01, 4, 4), mat)
      holder.frustumCulled = false
      holder.layers.set(5) // compiled but never drawn: drawing it while it compiles makes the browser wait for the compile to finish (a multi-second freeze)
      scene.add(holder)
      try { await gl.compileAsync(scene, camera) } catch { /* it will compile when first drawn instead */ }
      scene.remove(holder)
      // dev only: `?shaderdelay=4000` pretends the compile took that many ms, to look at the placeholder
      const pretend = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('shaderdelay')) : 0
      if (pretend) await new Promise((r) => setTimeout(r, pretend))
      markShaderReady(name, era)
      if (live) setReady(true)
    })()
    return () => { live = false }
  }, [bakes, name, era, gl, scene, camera])
  const placeholderColor = useMemo(() => {
    const look = lookFor(name, era)
    return new THREE.Color(look.landA).lerp(new THREE.Color(look.deep), 0.5).multiplyScalar(0.55)
  }, [name, era])

  const atmoUniforms = useMemo(() => {
    const look = lookFor(name, era)
    // the realistic look keeps the edge glow much fainter so the atmosphere reads as haze, not a neon ring
    return { uAtmo: { value: new THREE.Color(look.atmo) }, uStrength: { value: look.atmoStrength * (look.hero > 0 ? 0.5 : 0.3) }, uArrive: arriveFade }
  }, [name, era])

  useFrame((s, dt) => {
    const job = working.current
    if (job && job.compiled && !job.bake.done) {
      const before = job.bake.version
      job.bake.step()
      if (job.bake.version !== before) { setBaked(job.bake); setVersion(job.bake.version) }
      if (job.bake.done) {
        bakedCache.set(bakeKey, job.bake)
        while (bakedCache.size > BAKED_KEEP) {
          const [oldKey, old] = bakedCache.entries().next().value as [string, PlanetBake]
          bakedCache.delete(oldKey)
          old.disposeSurface()
          old.disposeWork()
        }
        working.current = null
      }
    }
    planetUniforms.uTime.value = s.clock.elapsedTime
    if (spin.current) {
      if (!FROZEN) spin.current.rotation.y += dt * 0.1
      spin.current.updateMatrixWorld()
      planetUniforms.uModelRot.value.setFromMatrix4(spin.current.matrixWorld)
    }
  })

  const geometry = PLANET_GEOMETRY

  // dev only: `?rot=2` starts the planet turned by that many radians
  useEffect(() => {
    if (!import.meta.env.DEV || !spin.current) return
    const r = Number(new URLSearchParams(location.search).get('rot'))
    if (r) spin.current.rotation.y = r
  }, [])
  // Mars is tilted on its axis, so the equatorial shipyard ring shows as an open ellipse
  const tilt: [number, number, number] = hero === 2 ? [0.6, 0, 0.3] : [0, 0, 0]
  const liteUniforms = useMemo(() => {
    const sf = baked?.surface
    return sf ? { ...planetUniforms, tA: { value: sf.a }, tB: { value: sf.b }, tC: { value: sf.c }, tD: { value: sf.d } } : null
  }, [baked, baked?.version, planetUniforms])

  return (
    <group position={position}>
      <group rotation={tilt}>
        {/* everything in here turns together: the planet and, on Mars, the ring held up by its elevators */}
        <group ref={spin}>
          {surface}
          {bakes && liteUniforms ? (
            <mesh geometry={geometry} renderOrder={5}>
              <shaderMaterial
                key={`lite${hero}-${bakeKey}`}
                uniforms={liteUniforms}
                vertexShader={PLANET_VERT}
                fragmentShader={withArriveFade(liteFragmentFor(hero))}
                transparent
              />
            </mesh>
          ) : !bakes && ready ? (
            <mesh geometry={geometry} renderOrder={5}>
              <shaderMaterial
                key={`real${hero}-${era}`}
                uniforms={planetUniforms}
                vertexShader={PLANET_VERT}
                fragmentShader={fragmentFor(hero)}
                transparent
              />
            </mesh>
          ) : (
            <mesh geometry={geometry} renderOrder={5}>
              <meshBasicMaterial color={placeholderColor} transparent />
            </mesh>
          )}
          {hero === 2 && <MarsShipyard radius={PLANET_RADIUS} />}
          {hero === 4 && <NecromundaSpires radius={PLANET_RADIUS} />}
          {hero === 5 && <CadiaPylons radius={PLANET_RADIUS} />}
        </group>
      </group>
      {/* the sun lights the ring; these stay still while the planet and ring turn */}
      {hero >= 2 && (
        <>
          <ambientLight intensity={0.5} color="#a08060" />
          <directionalLight position={[-4, 1.5, 2.5]} intensity={2.2} color="#ffd9a8" />
        </>
      )}
      {hero === 3 && <MacraggeOrbit radius={PLANET_RADIUS} />}
      {hero === 6 && <BaalMoons radius={PLANET_RADIUS} />}
      <mesh scale={1.17} geometry={geometry} renderOrder={6}>
        <shaderMaterial
          uniforms={atmoUniforms}
          vertexShader={ATMO_VERT}
          fragmentShader={ATMO_FRAG}
          transparent
          depthWrite={false}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  )
}

/**
 * The close-up of a selected planet. Most planets are a detailed, slowly spinning sphere drawn by shaders
 * (its look depends on the planet's name and the era); destroyed worlds are a swirling field of debris.
 */
/** A number from a name, so each hulk gets its own shape. */
const nameSeed = (name: string) => [...name].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)

/** `surface`: anything that should ride on a round planet's surface and turn with it (a targeting reticle, say). */
export default function PlanetBody({ name, era, position, surface }: { name: string; era: Era; position: [number, number, number]; surface?: ReactNode }) {
  if (isHulkName(name)) return <SpaceHulk position={position} seed={nameSeed(name)} />
  if (lookNameFor(name, era) === 'rock') return <TheRock position={position} />
  if (lookNameFor(name, era) === 'shattered') {
    return (
      <group position={position}>
        <ShatteredField seed={seedFor(name)} />
      </group>
    )
  }
  return <SpherePlanet name={name} era={era} position={position} surface={surface} />
}
