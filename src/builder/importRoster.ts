// Reading rosters made by other apps. New Recruit exports its lists as JSON, as a BattleScribe roster (.ros) or zipped
// (.rosz); all three hold the same thing: forces holding selections, each pointing at the BSData entry it came from. They are
// turned here into one small neutral shape, which the builder then matches against its own copy of the rules.
import { POINTS_NAME } from './engine.ts'

/** A points limit as the other app wrote it: a number, or nothing (or blank) for no limit. */
const limitOf = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? -1 : Number(v))

export interface ImportedSel { name: string; entryId: string; number: number; type: string; cost: number; selections: ImportedSel[]; /** the other app's id for this selection, and the units it leads or supports (by their ids there) */ id?: string; assoc?: { to: string; id: string }[] }
export interface ImportedForce { name: string; entryId: string; catalogueId: string; selections: ImportedSel[]; forces: ImportedForce[] }
export interface ImportedRoster {
  name: string
  gameSystemId: string
  gameSystemName: string
  points: number // the total the other app calculated (to compare with ours)
  limit: number // the points limit, -1 for none
  forces: ImportedForce[]
}

type J = Record<string, any>

const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : [])

function fromJson(root: J): ImportedRoster {
  const r: J = root.roster ?? root
  const sel = (s: J, pointsId: string): ImportedSel => ({
    name: String(s.name ?? ''), entryId: String(s.entryId ?? ''), number: Number(s.number ?? 1), type: String(s.type ?? 'upgrade'),
    cost: Number(arr(s.costs).find((c) => c.typeId === pointsId)?.value ?? 0),
    selections: arr(s.selections).map((x) => sel(x, pointsId)),
    id: s.id === undefined ? undefined : String(s.id),
    assoc: arr(s.associations).filter((a) => a.to !== undefined).map((a) => ({ to: String(a.to), id: String(a.associationId ?? a.id ?? '') })),
  })
  const pointsId = String(arr(r.costs).find((c) => POINTS_NAME.test(String(c.name)))?.typeId ?? '')
  const force = (f: J): ImportedForce => ({
    name: String(f.name ?? ''), entryId: String(f.entryId ?? ''), catalogueId: String(f.catalogueId ?? ''),
    selections: arr(f.selections).map((x) => sel(x, pointsId)), forces: arr(f.forces).map(force),
  })
  return {
    name: String(r.name ?? 'Imported roster'), gameSystemId: String(r.gameSystemId ?? ''), gameSystemName: String(r.gameSystemName ?? ''),
    points: Number(arr(r.costs).find((c) => c.typeId === pointsId)?.value ?? 0),
    limit: limitOf(arr(r.costLimits).find((c) => c.typeId === pointsId)?.value),
    forces: arr(r.forces).map(force),
  }
}

/** Parse a roster's XML (needs the browser's DOMParser). */
function fromXml(text: string): ImportedRoster {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const root = doc.documentElement
  if (!root || root.nodeName === 'parsererror' || doc.querySelector('parsererror')) throw new Error('That file is not a roster.')
  const kids = (el: Element, name: string) => [...el.children].filter((c) => c.localName === name)
  const first = (el: Element, name: string) => kids(el, name)[0]
  const costsOf = (el: Element) => kids(first(el, 'costs') ?? el, 'cost')
  const pointsId = costsOf(root).find((c) => POINTS_NAME.test(c.getAttribute('name') ?? ''))?.getAttribute('typeId') ?? ''
  const sel = (e: Element): ImportedSel => ({
    name: e.getAttribute('name') ?? '', entryId: e.getAttribute('entryId') ?? '', number: Number(e.getAttribute('number') ?? 1), type: e.getAttribute('type') ?? 'upgrade',
    cost: Number(costsOf(e).find((c) => c.getAttribute('typeId') === pointsId)?.getAttribute('value') ?? 0),
    selections: kids(first(e, 'selections') ?? e, 'selection').map(sel).filter(Boolean),
    id: e.getAttribute('id') ?? undefined,
    assoc: kids(first(e, 'associations') ?? e, 'association').filter((a) => a.getAttribute('to')).map((a) => ({ to: a.getAttribute('to') ?? '', id: a.getAttribute('associationId') ?? '' })),
  })
  const force = (e: Element): ImportedForce => ({
    name: e.getAttribute('name') ?? '', entryId: e.getAttribute('entryId') ?? '', catalogueId: e.getAttribute('catalogueId') ?? '',
    selections: first(e, 'selections') ? kids(first(e, 'selections')!, 'selection').map(sel) : [],
    forces: first(e, 'forces') ? kids(first(e, 'forces')!, 'force').map(force) : [],
  })
  const limit = first(root, 'costLimits') ? kids(first(root, 'costLimits')!, 'costLimit').find((c) => c.getAttribute('typeId') === pointsId) : undefined
  return {
    name: root.getAttribute('name') ?? 'Imported roster', gameSystemId: root.getAttribute('gameSystemId') ?? '', gameSystemName: root.getAttribute('gameSystemName') ?? '',
    points: Number(costsOf(root).find((c) => c.getAttribute('typeId') === pointsId)?.getAttribute('value') ?? 0),
    limit: limitOf(limit?.getAttribute('value')),
    forces: first(root, 'forces') ? kids(first(root, 'forces')!, 'force').map(force) : [],
  }
}

/** Unzip the first file of a .rosz (zip) using the browser's own decompressor. */
async function unzipFirst(bytes: Uint8Array): Promise<string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (v.getUint32(0, true) !== 0x04034b50) throw new Error('That file is not a .rosz.')
  const method = v.getUint16(8, true)
  const csize = v.getUint32(18, true)
  const nameLen = v.getUint16(26, true)
  const extraLen = v.getUint16(28, true)
  const start = 30 + nameLen + extraLen
  let data = bytes.subarray(start, csize ? start + csize : undefined)
  if (method === 0) return new TextDecoder().decode(data)
  if (method !== 8) throw new Error('That zip uses a compression this reader does not know.')
  const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  data = new Uint8Array(await new Response(stream).arrayBuffer())
  return new TextDecoder().decode(data)
}

/** Read a roster file from New Recruit or BattleScribe: .json, .ros or .rosz. */
export async function readRosterFile(file: { name: string; bytes: Uint8Array }): Promise<ImportedRoster> {
  const isZip = file.bytes[0] === 0x50 && file.bytes[1] === 0x4b
  const text = isZip ? await unzipFirst(file.bytes) : new TextDecoder().decode(file.bytes)
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{')) return fromJson(JSON.parse(trimmed))
  if (trimmed.startsWith('<')) return fromXml(trimmed)
  throw new Error(`${file.name} is not a roster file.`)
}

export { fromJson as rosterFromJson }
