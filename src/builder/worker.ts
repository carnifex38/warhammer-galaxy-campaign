// The army builder runs in a worker: loading and parsing the rules data (several megabytes) and re-checking a roster after every
// tap all happen here, so the screen never stutters. The screen sends a request and gets plain objects back.
import { buildSystem, type Node } from './engine.ts'
import { Builder, type ImportReport, type RosterView, type SavedRoster, type SelDetail } from './roster.ts'
import type { ImportedRoster } from './importRoster.ts'
import { toRos, toRosz } from './ros.ts'

export interface Manifest {
  system: { id: string; name: string; revision: number; file: string }
  catalogues: { id: string; name: string; revision: number; file: string; library: boolean; links: string[] }[]
  commit?: string
  built?: string
}

export type Request =
  | { op: 'load'; base: string; armyId: string; saved?: SavedRoster }
  | { op: 'armies'; base: string }
  | { op: 'addForce'; parent: string | null; entry: string; army?: string }
  | { op: 'removeForce'; uid: string }
  | { op: 'add'; container: string; slot: string; number?: number }
  | { op: 'setNumber'; uid: string; n: number }
  | { op: 'remove'; uid: string }
  | { op: 'split'; uid: string }
  | { op: 'detail'; uid: string }
  | { op: 'name'; name: string }
  | { op: 'limit'; id: string; value: number }
  | { op: 'ros'; zipped: boolean }
  | { op: 'import'; roster: ImportedRoster }

export type Response =
  | { ok: true; view?: RosterView; detail?: SelDetail | null; saved?: SavedRoster; armies?: Manifest['catalogues']; dropped?: number; file?: { name: string; bytes: Uint8Array }; ms?: number; report?: ImportReport }
  | { ok: false; error: string }

let builder: Builder | null = null
let loaded = new Map<string, Node>()

async function getJson(url: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`)
  return r.json()
}

/** Only the army the player picked, what it links to, and the game system are downloaded and parsed. */
async function load(base: string, armyId: string, saved?: SavedRoster) {
  const t0 = performance.now()
  const manifest = (await getJson(`${base}/manifest.json`)) as Manifest
  const byId = new Map(manifest.catalogues.map((c) => [c.id, c]))
  const need = new Set<string>()
  const visit = (id: string) => { if (need.has(id) || !byId.has(id)) return; need.add(id); for (const l of byId.get(id)!.links) visit(l) }
  visit(armyId)
  const files = [...need].map((id) => byId.get(id)!)
  const [sysFile, ...cats] = await Promise.all([
    loaded.has('system') ? Promise.resolve(null) : getJson(`${base}/${manifest.system.file}`),
    ...files.filter((c) => !loaded.has(c.id)).map((c) => getJson(`${base}/${c.file}`).then((j) => ({ id: c.id, node: j.catalogue as Node }))),
  ])
  if (sysFile) loaded.set('system', sysFile.system)
  for (const c of cats as { id: string; node: Node }[]) loaded.set(c.id, c.node)
  const sys = buildSystem(loaded.get('system')!, [...need].map((id) => loaded.get(id)!).filter(Boolean))
  let dropped = 0
  if (saved) { const r = Builder.load(sys, saved); builder = r.builder; dropped = r.dropped } else builder = new Builder(sys)
  return { dropped, ms: Math.round(performance.now() - t0) }
}

self.onmessage = async (e: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = e.data
  let res: Response
  try {
    if (req.op === 'armies') {
      const m = (await getJson(`${req.base}/manifest.json`)) as Manifest
      res = { ok: true, armies: m.catalogues.filter((c) => !c.library) }
    } else if (req.op === 'load') {
      const { dropped, ms } = await load(req.base, req.armyId, req.saved)
      res = { ok: true, view: builder!.view(), dropped, ms, saved: builder!.save() }
    } else {
      const b = builder
      if (!b) throw new Error('Nothing loaded yet.')
      switch (req.op) {
        case 'addForce': b.addForce(req.parent, req.entry, req.army); break
        case 'removeForce': b.removeForce(req.uid); break
        case 'add': b.addSelection(req.container, req.slot, req.number ?? 1); break
        case 'setNumber': b.setNumber(req.uid, req.n); break
        case 'remove': b.remove(req.uid); break
        case 'split': b.split(req.uid); break
        case 'name': b.roster.name = req.name; break
        case 'limit': b.roster.limits[req.id] = req.value; break
        case 'import': {
          const report = b.importRoster(req.roster)
          res = { ok: true, view: b.view(), saved: b.save(), report }
          self.postMessage({ id, res })
          return
        }
        case 'detail': res = { ok: true, detail: b.detail(req.uid) }; self.postMessage({ id, res }); return
        case 'ros': {
          const xml = toRos(b)
          const base = (b.roster.name || 'roster').replace(/[^\w\- ]+/g, '').trim() || 'roster'
          res = { ok: true, file: req.zipped ? { name: `${base}.rosz`, bytes: toRosz(xml, `${base}.ros`) } : { name: `${base}.ros`, bytes: new TextEncoder().encode(xml) } }
          self.postMessage({ id, res })
          return
        }
      }
      res = { ok: true, view: b.view(), saved: b.save() }
    }
  } catch (err) {
    res = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage({ id, res })
}
