// Placeholder galaxy data, laid out in 3D from the reference maps.
// The galaxy lies flat in the X/Z plane, Y is "up", north (top of the maps) is -Z.
//
// Layout comes from the "sector division" reference image (1958 x 1552 px, called map 5 below):
// Segmentum Solar is a circle around Sol, and the other segmentums are annular wedges around it.
// The bright galactic core (map 5 pixel 1170,760) is the world origin.
// Planet names/positions also come from the Horus Heresy map ("map 4"), converted with `fromMap4()`.
//
// The organiser editor (milestone 3) will eventually replace this hand-placed layout.

export type TableStatus = 'open' | 'in_play'

export interface GameTable {
  id: string
  name: string
  status: TableStatus
  note: string
}

export interface Planet {
  id: string
  name: string
  x: number
  z: number
  tables: GameTable[]
}

export interface Sector {
  id: string
  name: string
  color: string
  /** Outline in world X/Z. */
  polygon: [number, number][]
  /** Where the name label sits, in world X/Z. */
  label: { x: number; z: number }
  planets: Planet[]
}

// ---------- coordinate conversion ----------

const SCALE = 0.0175
const CORE_PX = { x: 1170, y: 760 }
const SOL_PX = { x: 680, y: 815 } // centre of the Solar circle

/** Map 5 pixel -> world position. */
export function toWorld(px: number, py: number) {
  return { x: (px - CORE_PX.x) * SCALE, z: (py - CORE_PX.y) * SCALE }
}

/** Map 4 (Horus Heresy map) pixel -> map 5 pixel. The two maps share a layout; this fit was measured on Terra, Fenris and Baal. */
function fromMap4(x: number, y: number): [number, number] {
  return [0.98 * x + 55, 0.98 * y + 110]
}

const rad = (d: number) => (d * Math.PI) / 180

/** Point at radius r (map 5 px) and angle a (degrees, 0 = east, 90 = north) around Sol. */
function around(r: number, aDeg: number): [number, number] {
  return [SOL_PX.x + r * Math.cos(rad(aDeg)), SOL_PX.y - r * Math.sin(rad(aDeg))]
}

function arc(r: number, a0: number, a1: number): [number, number][] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 4))
  return Array.from({ length: n + 1 }, (_, i) => around(r, a0 + ((a1 - a0) * i) / n))
}

/** Annular wedge between two radii and two angles. */
function ring(r0: number, r1: number, a0: number, a1: number): [number, number][] {
  return [...arc(r1, a0, a1), ...arc(r0, a1, a0)]
}

// ---------- sectors ----------

const NOTES = ['Ruins and cover', 'Open plains', 'Industrial sprawl', 'Forest and hills']

type PlanetSpec = [name: string, px: number, py: number]
const p5 = (name: string, x: number, y: number): PlanetSpec => [name, x, y]
const p4 = (name: string, x: number, y: number): PlanetSpec => [name, ...fromMap4(x, y)]

export const DEFAULT_TABLES = 4

/** Battlezones are named with the NATO phonetic alphabet (the host can have up to 12). */
const NATO = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima']

/** Placeholder tables for a planet; the host can change how many there are. */
export function makeTables(planetId: string, _planetName: string, count: number): GameTable[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${planetId}-t${i + 1}`,
    name: `Battlezone ${NATO[i] ?? i + 1}`,
    status: 'open' as const, // the real status comes from the battlezone claims (an open battlezone until the host marks it in play)
    note: NOTES[i % NOTES.length],
  }))
}

function planet([name, px, py]: PlanetSpec): Planet {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const { x, z } = toWorld(px, py)
  return { id, name, x, z, tables: makeTables(id, name, DEFAULT_TABLES) }
}

function sector(
  id: string, name: string, color: string,
  outlinePx: [number, number][], labelAt: [r: number, aDeg: number], list: PlanetSpec[],
): Sector {
  const [lx, ly] = around(labelAt[0], labelAt[1])
  return {
    id,
    name,
    color,
    polygon: outlinePx.map(([x, y]) => {
      const w = toWorld(x, y)
      return [w.x, w.z] as [number, number]
    }),
    label: toWorld(lx, ly),
    planets: list.map(planet),
  }
}

// Radii in map-5 pixels, angles in degrees around Sol.
const SOLAR_R = 182
const INNER_RING_R = 405
const OBSCURUS_R = 760
const TEMPESTUS_R = 560
const ULTIMA_R = 1130

export const SECTORS: Sector[] = [
  sector('solar', 'Segmentum Solar', '#ffe3a3', arc(SOLAR_R, 0, 360), [0, 0], [
    p5('Terra', 672, 797),
    p5('Mars', 740, 770),
    p4('Cthonia', 545, 763),
    p4('Olmec', 487, 722),
    p4('Necromunda', 655, 858),
  ]),

  sector('ocularis', 'Ocularis Malifica', '#c24bff', ring(SOLAR_R, INNER_RING_R, 71, 150), [330, 112], [
    p5('Caliban', 593, 470),
    p5('Medusa', 475, 515),
    p4('Cypra Mundi', 665, 428),
    p5('Cadia', 560, 625),
  ]),

  // Obscurus wraps over the top of Ocularis: inner part east of it, outer part above it.
  sector(
    'obscurus', 'Segmentum Obscurus', '#6f86ff',
    [...arc(SOLAR_R, 46, 71), ...arc(INNER_RING_R, 71, 133.5), ...arc(OBSCURUS_R, 133.5, 46)],
    [570, 90],
    [
      p5('Rangda', 470, 205),
      p4('Opuscalus Noctis', 215, 185),
      p4('Hellion', 305, 343),
      p4('Morox', 575, 247),
      p4('Abyss', 730, 92),
      p4('Lucius', 780, 298),
      p4('Goth', 893, 380),
      p4('Isstvan', 978, 85),
      p5('Fenris', 790, 640),
    ],
  ),

  sector('pacificus', 'Segmentum Pacificus', '#d6a94a', ring(SOLAR_R, 408, 150, 221), [300, 185], [
    p4('Khur', 258, 583),
    p4('Stygies VIII', 330, 653),
    p5('Colchis', 438, 813), // the wiki puts Colchis in Segmentum Pacificus
    p4('Vasalius', 292, 770),
    p4('Gehenna', 418, 873),
  ]),

  sector('tempestus', 'Segmentum Tempestus', '#e0524d', ring(SOLAR_R, TEMPESTUS_R, 221, 315), [380, 268], [
    p4('Graia', 488, 957),
    p4('Taras', 580, 913),
    p4('Inwit', 710, 925),
    p4('Tallarn', 718, 1020),
    p4('Luth Tyre', 708, 1068),
    p5('Barbarus', 573, 1252),
    p5('Deliverance', 833, 1220),
    p4('Gryphonne', 760, 1205),
    p4('Galaspar', 535, 1262),
  ]),

  sector('ultima', 'Segmentum Ultima', '#2fb7a8', ring(SOLAR_R, ULTIMA_R, -45, 46), [640, 0], [
    p5('Baal', 1167, 552),
    p4('Quai Jinn', 1440, 135),
    p5('Nostramo', 1555, 382),
    p4('Desperation', 1735, 420),
    p5('Olympia', 1320, 760),
    p5('Chogoris', 1150, 935),
    p5('Chemos', 972, 918),
    p5('Nocturne', 1086, 1055),
    p5('Nuceria', 1575, 1000),
    p5('Macragge', 1481, 1217),
    p4('Ryza', 878, 752),
    p5('Prospero', 1089, 741), // the wiki puts Prospero in Segmentum Ultima
    p5('Seraphina', 1592, 732), // the wiki puts Seraphina in Segmentum Ultima (Wheel of Fire subsector)
  ]),
]

// ---------- helpers ----------

export function bbox(points: [number, number][]) {
  const xs = points.map((p) => p[0])
  const zs = points.map((p) => p[1])
  const x = Math.min(...xs)
  const z = Math.min(...zs)
  return { x, z, w: Math.max(...xs) - x, h: Math.max(...zs) - z }
}

/** World position of a sector's name label. */
export function sectorCenter(s: Sector) {
  return s.label
}

/** Bounding box of the whole galaxy. */
export const GALAXY_BOX = bbox(SECTORS.flatMap((s) => s.polygon))

export function openCount(tables: GameTable[]) {
  return tables.filter((t) => t.status === 'open').length
}

function insidePolygon(pt: [number, number], poly: [number, number][]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > pt[1] !== zj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) c = !c
  }
  return c
}

function distToSegment(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz || 1
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))
}

// ---------- the Space Hulks ----------
// Any number of hulks (up to MAX_HULKS) can drift in each sector; the host chooses how many. Each is a location
// players can pick, with its own battlezones, just like a planet.

export const MAX_HULKS = 3

/** Names for the hulk slots (sector order x 3). Slot 12 is Tempestus's first, the original Judgement of Carrion. */
const HULK_NAME_LIST = [
  'Pale Reliquary', 'Mournful Dirge', 'Saint of Ashes',
  'Ocular Ruin', 'Eye of Sorrow', 'Wrath Unending',
  'Cairn of Ages', 'Hollow Crusade', 'Last Anthem',
  'Drowned Psalm', 'Iron Vigil', 'Blessed Wreck',
  'Judgement of Carrion', 'Forsaken Bastion', 'Tomb of Vigilance',
  'Thorn of Ultima', 'Lament of Ships', 'Black Chalice',
]
const HULK_NAMES = new Set(HULK_NAME_LIST)
export const isHulkId = (id: string) => id.startsWith('space-hulk-')
export const isHulkName = (name: string) => HULK_NAMES.has(name)

const spotCache = new Map<string, { x: number; z: number }[]>()

/** Empty patches of a sector (far from planets, edges and each other) where hulks can float, best first. */
function clearSpots(sector: Sector, count: number) {
  const spots = spotCache.get(sector.id) ?? []
  spotCache.set(sector.id, spots)
  const b = bbox(sector.polygon)
  const N = 60
  while (spots.length < count) {
    let best = { x: sector.label.x, z: sector.label.z }
    let bestScore = -1
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const pt: [number, number] = [b.x + (b.w * i) / N, b.z + (b.h * j) / N]
        if (!insidePolygon(pt, sector.polygon)) continue
        const toPlanets = Math.min(...sector.planets.map((p) => Math.hypot(p.x - pt[0], p.z - pt[1])), 99)
        const toHulks = Math.min(...spots.map((q) => Math.hypot(q.x - pt[0], q.z - pt[1])), 99)
        let toEdge = 99
        for (let k = 0; k < sector.polygon.length; k++) {
          toEdge = Math.min(toEdge, distToSegment(pt, sector.polygon[k], sector.polygon[(k + 1) % sector.polygon.length]))
        }
        const score = Math.min(toPlanets, toEdge * 1.6, toHulks)
        if (score > bestScore) { bestScore = score; best = { x: pt[0], z: pt[1] } }
      }
    }
    spots.push(best)
  }
  return spots
}

/** The hulks of a sector as planet-like locations. */
export function makeHulkPlanets(sector: Sector, count: number): Planet[] {
  if (count <= 0) return []
  const spots = clearSpots(sector, count)
  const sectorIndex = Math.max(0, SECTORS.findIndex((x) => x.id === sector.id))
  return spots.slice(0, count).map((p, k) => {
    const id = `space-hulk-${sector.id}-${k + 1}`
    const name = HULK_NAME_LIST[(sectorIndex * MAX_HULKS + k) % HULK_NAME_LIST.length]
    return { id, name, x: p.x, z: p.z, tables: makeTables(id, name, DEFAULT_TABLES) }
  })
}

// Dev-only sanity check: every planet should sit inside its own sector's outline.
if (import.meta.env.DEV) {
  const inside = insidePolygon
  for (const s of SECTORS) {
    for (const p of s.planets) {
      if (!inside([p.x, p.z], s.polygon)) console.warn(`[galaxy] ${p.name} is outside ${s.name}`)
    }
  }
}
