// Reads a New Recruit roster file and compares what this builder works out with what New Recruit says:
//   node scripts/test-import.mjs <folder made by build-bsdata.mjs> <roster .json>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSystem } from '../src/builder/engine.ts'
import { Builder } from '../src/builder/roster.ts'
import { rosterFromJson } from '../src/builder/importRoster.ts'

const [dir, file] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const sys = buildSystem(read(manifest.system.file).system, manifest.catalogues.map((c) => read(c.file).catalogue))
const imported = rosterFromJson(JSON.parse(readFileSync(file, 'utf8')))
console.log(`${imported.name}: ${imported.forces.length} top force(s), NR says ${imported.points} pts (limit ${imported.limit})`)

const b = new Builder(sys)
const t0 = performance.now()
const report = b.importRoster(imported)
console.log(`imported in ${Math.round(performance.now() - t0)} ms: ${report.matched} matched, ${report.skipped.length} skipped`)
for (const s of report.skipped.slice(0, 15)) console.log('  skipped:', s)
const v = b.view()
console.log(`our points ${report.ourPoints} vs NR ${report.theirPoints}  ${report.ourPoints === report.theirPoints ? 'MATCH' : 'DIFFERENT'}`)

// unit by unit
const nrUnits = []
const walkNr = (f, path) => { for (const s of f.selections) nrUnits.push({ path: `${path} › ${s.name}`, name: s.name, uid: null, nr: total(s) }); for (const c of f.forces) walkNr(c, `${path} › ${c.name}`) }
const total = (s) => s.cost + s.selections.reduce((n, c) => n + total(c), 0)
imported.forces.forEach((f) => walkNr(f, f.name))
const ours = []
const walkOurs = (f, path) => { for (const s of f.selections) ours.push({ path: `${path} › ${s.name}`, pts: b.eng.cost(s, b.pts) }); for (const c of f.forces) walkOurs(c, `${path} › ${label(c)}`) }
const label = (f) => f.link?.name ?? f.entry.name
b.roster.forces.forEach((f) => walkOurs(f, label(f)))
let diffs = 0
// both lists are in the same order, so compare them side by side
nrUnits.forEach((n, i) => {
  const o = ours[i]
  if (!o || Math.round(o.pts) !== Math.round(n.nr)) { diffs++; console.log(`  DIFF ${n.path}: NR ${n.nr}, ours ${o ? Math.round(o.pts) : 'missing'}`) }
})
console.log(`${nrUnits.length} top-level selections compared, ${diffs} differ`)
console.log('our problems:', [...new Set(v.issues.map((i) => `${i.level}: ${i.text}`))].slice(0, 10))

// does our own .ros export say the same as the file we read? (entry ids, group ids, numbers, own points)
const { toRos } = await import('../src/builder/ros.ts')
const nr = JSON.parse(readFileSync(file, 'utf8')).roster
const xml = toRos(b)
const own = (x) => +(/Point\(s\)" typeId="[^"]*" value="([\d.]+)"/.exec(x ?? '')?.[1] ?? 0)
const rows = [...xml.matchAll(/<selection [^>]*?entryId="([^"]*)"(?: entryGroupId="([^"]*)")? number="(\d+)"[^>]*><costs>(.*?)<\/costs>/g)].map((m) => ({ e: m[1], g: m[2] ?? '', n: +m[3], p: own(m[4]) }))
const theirs = []
const walkAll = (s) => { theirs.push({ e: s.entryId, g: s.entryGroupId ?? '', n: s.number, p: Number((s.costs ?? []).find((c) => /^Point/.test(c.name))?.value ?? 0) }); (s.selections ?? []).forEach(walkAll) }
const walkForce = (f) => { (f.selections ?? []).forEach(walkAll); (f.forces ?? []).forEach(walkForce) }
nr.forces.forEach(walkForce)
const bad = theirs.filter((t, i) => { const o = rows[i]; return !o || o.e !== t.e || o.n !== t.n || o.p !== t.p || o.g !== t.g }).length
console.log(`export check: ${theirs.length} selections in their file, ${rows.length} in our export, ${bad} differ`)
process.exit(report.ourPoints === report.theirPoints && bad === 0 && diffs === 0 ? 0 : 1)
