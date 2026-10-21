// What each planet looks like when you select it. Everything is drawn procedurally (no textures).
// Looks for well-known planets come from the lore as best I know it; any planet not listed in
// LOOK_BY_PLANET gets a generic look chosen from its name, so it stays the same every time.
// To change a planet's look, edit LOOK_BY_PLANET.

/** Which time the galaxy is shown in: the Dark Imperium of 40K, or the Horus Heresy of 30K. */
export type Era = '40k' | '30k'

export type LookName =
  | 'terran' | 'ocean' | 'desert' | 'forge' | 'ice' | 'jungle' | 'hive'
  | 'volcanic' | 'dead' | 'shattered' | 'dark' | 'terra' | 'mars' | 'macragge' | 'necromunda' | 'cadia' | 'baal' | 'fenris' | 'prospero' | 'prosperoRuin' | 'caliban' | 'rock'

export interface LookSpec {
  /** ocean colours (deep, shallow) */
  deep: string
  shallow: string
  /** land colours */
  landA: string
  landB: string
  cloudCol: string
  /** atmosphere glow colour */
  atmo: string
  atmoStrength: number
  /** fraction of the surface under water (0 = no oceans) */
  sea: number
  /** polar ice caps 0..1 */
  ice: number
  /** cloud cover 0..1 */
  cloud: number
  /** night-side city lights 0..1 */
  city: number
  /** glowing lava veins on land 0..1 */
  lava: number
  /** glowing cracks across the whole planet 0..1 */
  crack: number
  /** feature size: bigger = smaller, more broken-up continents */
  scale: number
  /** impact craters, realistic look: 0 = none, 1 = heavily cratered */
  craters: number
  /** light on the surface even away from the sun (0.015 normally; dark worlds are higher so you can see them) */
  ambient: number
  /** glowing networks of roads and ring-shaped structures across the land: 0 = none, 1 = Terra */
  grid: number
  /** a hand-built look with its own shader: 1 = Terra, 2 = Mars (0 = a normal planet) */
  hero: number
}

const base: LookSpec = {
  deep: '#0b2f6b', shallow: '#2a7fbf', landA: '#3f7a3a', landB: '#8a7a4a', cloudCol: '#ffffff',
  atmo: '#5aa8ff', atmoStrength: 1, sea: 0, ice: 0, cloud: 0, city: 0, lava: 0, crack: 0, scale: 1.6, craters: 0.5, ambient: 0.015, grid: 0, hero: 0,
}

export const LOOKS: Record<LookName, LookSpec> = {
  // blue-green world with oceans, continents, ice caps and white clouds
  terran: { ...base, sea: 0.5, ice: 1, cloud: 0.8, city: 0.12, craters: 0.12 },
  // almost all ocean
  ocean: { ...base, sea: 0.68, ice: 0.8, cloud: 0.85, landA: '#4c8a45', landB: '#8d8a5a', scale: 1.3, craters: 0.08 },
  // red/orange dunes, thin air
  desert: { ...base, landA: '#b9855a', landB: '#ecca94', cloudCol: '#f1e1c5', atmo: '#f2b685', atmoStrength: 0.7, cloud: 0.12, scale: 1.5, craters: 0.45 },
  // rust-red industrial world dotted with lights
  forge: { ...base, landA: '#54281d', landB: '#b8663f', cloudCol: '#b99478', atmo: '#e0805a', atmoStrength: 0.6, cloud: 0.15, city: 0.6, scale: 2.2, craters: 0.9 },
  // frozen white-blue world
  ice: { ...base, sea: 0.3, deep: '#5f87b3', shallow: '#b8d4ea', landA: '#e4edf6', landB: '#9db9d6', cloudCol: '#f4f9ff', atmo: '#aee0ff', ice: 1, cloud: 0.55, craters: 0.18 },
  // deep green death world under constant cloud
  jungle: { ...base, sea: 0.38, deep: '#0a2b2a', shallow: '#1f5a52', landA: '#26492a', landB: '#5b7238', cloudCol: '#eef3ea', atmo: '#9fd6b0', atmoStrength: 0.8, cloud: 0.85, scale: 2, craters: 0.08 },
  // one planet-wide city under a brown smog haze
  hive: { ...base, landA: '#4d4d56', landB: '#827d88', cloudCol: '#9a8467', atmo: '#d6a574', atmoStrength: 1.1, cloud: 0.5, city: 1, scale: 2.6, craters: 0.3, grid: 0.55 },
  // black rock split by rivers of lava
  volcanic: { ...base, landA: '#2a201b', landB: '#524239', cloudCol: '#4a3d38', atmo: '#ff6a30', atmoStrength: 0.6, cloud: 0.3, lava: 0.75, scale: 2, craters: 0.7 },
  // airless grey rock
  dead: { ...base, landA: '#4a443f', landB: '#9a9188', atmo: '#a79d90', atmoStrength: 0.15, scale: 3, craters: 1.1 },
  // a world broken apart: dead rock with glowing fractures
  shattered: { ...base, landA: '#4e4640', landB: '#7a6e63', atmo: '#ff6a30', atmoStrength: 0.35, crack: 0.9, scale: 3, craters: 0.8 },
  // night-side industrial world, blue-black with bright city lights
  dark: { ...base, landA: '#2d374d', landB: '#566480', cloudCol: '#3f4a6b', atmo: '#5a7cff', atmoStrength: 0.8, cloud: 0.6, city: 1, scale: 2.2, craters: 0.3, ambient: 0.09 },
  // polluted cradle of the Imperium: grey-brown continents under smog, covered in cities
  terra: { ...base, sea: 0.15, deep: '#33332f', shallow: '#5a5a4c', landA: '#8d4b30', landB: '#cfa070', cloudCol: '#f1e6cc', atmo: '#ffb860', atmoStrength: 1.3, cloud: 0.6, city: 1, scale: 1.8, craters: 0.2, hero: 1 },
  // Ultramar's capital: oceans, green land, snow-capped mountains, the star-shaped Fortress of Hera (own shader)
  macragge: { ...base, deep: '#0b2f6b', shallow: '#2a7fbf', landA: '#2f6f3a', landB: '#8a8a6a', atmo: '#6aaaff', atmoStrength: 1, sea: 0.5, ice: 1, cloud: 0.7, city: 0.5, scale: 1.6, craters: 0.08, hero: 3 },
  // the great hive world: ash wastes, glowing sprawls, toxic yellow-green smog, hive spires (own shader)
  necromunda: { ...base, landA: '#3a322a', landB: '#6a5a48', cloudCol: '#8f8333', atmo: '#c8cc40', atmoStrength: 1, cloud: 0.7, city: 1, scale: 2.6, craters: 0.1, hero: 4 },
  // Cadia before its fall (30K): a temperate fortress world, star-shaped Kasr forts, the four Cadian Pylons (own shader)
  cadia: { ...base, deep: '#0d1a26', shallow: '#254256', landA: '#3a4727', landB: '#8a8a60', atmo: '#bfd0e6', atmoStrength: 0.8, sea: 0.3, ice: 0.8, cloud: 0.5, city: 0.4, scale: 1.8, craters: 0.1, hero: 5 },
  // Baal: blood-red dune desert with dark mesas and great dust storms; two moons (own shader)
  baal: { ...base, landA: '#762410', landB: '#c74c28', cloudCol: '#cc6b48', atmo: '#ff6a40', atmoStrength: 0.8, cloud: 0.4, scale: 1.6, craters: 0.2, hero: 6 },
  // Fenris: cracked pack ice, dark snow-dusted mountains, blizzards, a great cyclone, the Fang (own shader)
  fenris: { ...base, deep: '#0d2038', shallow: '#6a90b4', landA: '#2c3340', landB: '#8a94a4', cloudCol: '#e6f0fa', atmo: '#9fd2ff', atmoStrength: 0.9, sea: 0.3, ice: 1, cloud: 0.7, scale: 1.8, craters: 0.1, hero: 7 },
  // Prospero in 30K: a pristine world of golden cities and the ringed capital Tizca (own shader)
  prospero: { ...base, deep: '#08204c', shallow: '#1a6688', landA: '#295c33', landB: '#a38f42', cloudCol: '#fff7ea', atmo: '#ffd98a', atmoStrength: 0.9, sea: 0.42, ice: 0.8, cloud: 0.45, city: 0.7, scale: 1.7, craters: 0.05, hero: 8 },
  // Prospero in 40K: the burnt ruin, Planet of the Sorcerers (own shader)
  prosperoRuin: { ...base, landA: '#1a1818', landB: '#524845', cloudCol: '#665c66', atmo: '#a65ae6', atmoStrength: 0.8, cloud: 0.35, scale: 2, craters: 0.3, hero: 9 },
  // Caliban in 30K: dark, brooding forest world under grey cloud, with fires smouldering in the gloom
  caliban: { ...base, sea: 0.12, deep: '#07130f', shallow: '#12261d', landA: '#1d2d20', landB: '#506049', cloudCol: '#7d8884', atmo: '#4f7fa8', atmoStrength: 0.5, cloud: 0.6, lava: 0.2, scale: 2.6, craters: 0.1, ambient: 0.09 },
  // Caliban in 40K is The Rock (drawn as its own model); these only colour the map
  rock: { ...base, landA: '#4a4a50', landB: '#7a7a86', atmo: '#8a9ab8', atmoStrength: 0.1 },
  // the forge world: rust-red desert under a thin dusty haze (drawn by its own shader in the realistic look)
  mars: { ...base, landA: '#6b2e1d', landB: '#c8693a', cloudCol: '#d9a070', atmo: '#ff8a5a', atmoStrength: 0.7, cloud: 0.2, city: 0.6, scale: 2.2, craters: 0.9, hero: 2 },
}

const LOOK_BY_PLANET: Record<string, LookName> = {
  // Solar
  Terra: 'terra', Mars: 'mars', Necromunda: 'necromunda', Chthonia: 'dead',
  // Ocularis Malifica
  Medusa: 'volcanic',
  // Obscurus
  Lucius: 'forge', Isstvan: 'dead', Fenris: 'fenris', Abyss: 'dark',
  // Pacificus
  Styggies: 'forge', Gehenna: 'volcanic',
  // Tempestus
  Graia: 'forge', Tallarn: 'desert', Barbarus: 'dead',
  // Ultima
  Baal: 'baal', Nostramo: 'dark', Olympia: 'forge', Chogoris: 'terran', Nocturne: 'volcanic',
  Nuceria: 'desert', Macragge: 'macragge', Ryza: 'forge',
}

// Planets whose look changed between the Horus Heresy and the 41st millennium.
const LOOK_BY_ERA: Record<Era, Record<string, LookName>> = {
  '40k': { Caliban: 'rock', Cadia: 'shattered', Prospero: 'prosperoRuin' },
  '30k': { Caliban: 'caliban', Cadia: 'cadia', Prospero: 'prospero' },
}

const FALLBACK: LookName[] = ['terran', 'desert', 'ice', 'jungle', 'volcanic', 'dead', 'ocean', 'dark', 'hive']

/** Dev only: `?look=hive` forces a look on every planet, for tuning. */
function devLook(): LookName | null {
  if (!import.meta.env.DEV) return null
  const l = new URLSearchParams(location.search).get('look')
  return l && l in LOOKS ? (l as LookName) : null
}

export function lookNameFor(planetName: string, era: Era): LookName {
  const forced = devLook()
  if (forced) return forced
  const known = LOOK_BY_ERA[era][planetName] ?? LOOK_BY_PLANET[planetName]
  if (known) return known
  let h = 0
  for (const ch of planetName) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACK[h % FALLBACK.length]
}

export function lookFor(planetName: string, era: Era): LookSpec {
  return LOOKS[lookNameFor(planetName, era)]
}

/** A stable per-planet number so two planets with the same look still have different continents. */
export function seedFor(planetName: string): number {
  let h = 7
  for (const ch of planetName) h = (h * 33 + ch.charCodeAt(0)) >>> 0
  return (h % 1000) / 10
}
