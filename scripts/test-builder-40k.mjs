// Tries the army builder on the 40,000 11th edition rules, straight in Node (no browser):
//   node scripts/test-builder-40k.mjs [folder made by build-bsdata.mjs, default public/data/wh40k11e]
// The data is pinned (see update-data.mjs), so the points below only change when the pin does.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSystem } from '../src/builder/engine.ts'
import { Builder } from '../src/builder/roster.ts'
import { toRos } from '../src/builder/ros.ts'

const dir = process.argv[2] ?? 'public/data/wh40k11e'
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const t0 = performance.now()
const sys = buildSystem(read(manifest.system.file).system, manifest.catalogues.map((c) => read(c.file).catalogue))
console.log(`loaded ${manifest.catalogues.length} catalogues, ${sys.byId.size} nodes in ${Math.round(performance.now() - t0)} ms`)

let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++ }
const texts = (v) => [...new Set(v.issues.map((i) => i.text))]
const army = manifest.catalogues.find((c) => c.name === 'Imperium - Adeptus Astartes - Space Marines')
const armies = manifest.catalogues.filter((c) => !c.library)
check('every army is offered', armies.length >= 30, `${armies.length} armies`)

const b = new Builder(sys, undefined, 'Test')
let v = b.view()
const force = b.addForce(null, v.forceChoices.find((c) => c.name === 'Army Roster').id, army.id)
v = b.view()
const role = (name) => v.forces[0].roles.find((r) => r.name === name)
const selected = (name) => v.forces[0].roles.flatMap((r) => r.selections).find((s) => s.name.startsWith(name))

check('points are shown (the data hides that cost type)', v.costs.length === 1 && v.costs[0].name === 'pts', JSON.stringify(v.costs.map((c) => c.name)))
check('a fresh list does not ask for entries that are only for Crusade', !texts(v).some((t) => /Invader ATVs|Judiciar|Aquila Kill Team/.test(t)), texts(v).join(' / '))
const settings = role('Configuration').choices.map((c) => c.name)
check('each setting is offered once', settings.filter((n) => n === 'Detachment').length === 1 && settings.filter((n) => n === 'Show/Hide Options').length === 1, settings.join(', '))

// the points limit follows the battle size
b.addSelection(force, role('Configuration').choices.find((c) => c.name === 'Battle Size').id)
v = b.view()
const sizeUid = selected('Battle Size').uid
const pickSize = (re) => { const g = b.detail(sizeUid).slots.find((s) => s.name === 'Battle Size'); b.addSelection(sizeUid, g.children.find((c) => re.test(c.name)).id); v = b.view() }
check('no battle size, no limit', v.costs[0].limit === -1)
pickSize(/Strike Force/)
check('Strike Force sets a 2000 point limit', v.costs[0].limit === 2000, `limit ${v.costs[0].limit}`)
b.remove(b.detail(sizeUid).slots.find((s) => s.name === 'Battle Size').children.find((c) => /Strike Force/.test(c.name)).selected.uid) // (one size at a time)
pickSize(/Incursion/)
check('Incursion sets 1000', v.costs[0].limit === 1000, `limit ${v.costs[0].limit}`)

// units, points and the loadout editor
b.addSelection(force, role('Configuration').choices.find((c) => c.name === 'Detachment').id)
v = b.view()
const detUid = selected('Detachment').uid
b.addSelection(detUid, b.detail(detUid).slots.find((s) => s.name === 'Detachment').children.find((c) => c.name === 'Gladius Task Force').id)
v = b.view()
const unit = role('Battleline').choices.find((c) => c.name === 'Intercessor Squad')
const uid = b.addSelection(force, unit.id)
v = b.view()
const d = b.detail(uid)
check('the squad has a price', unit.pts > 0 && d.pts === unit.pts, `${d.pts} pts`)
check('the list total is the squad', Math.round(v.costs[0].total) === d.pts, `total ${v.costs[0].total}`)
check('the Detachment is satisfied once chosen', !texts(v).some((t) => /needs at least 1 Detachment \(has 0\)/.test(t)))
check('the datasheet has unit and weapon tables', ['Unit', 'Ranged Weapons', 'Melee Weapons'].every((t) => d.stats.some((s) => s.type === t)), d.stats.map((s) => s.type).join(', '))
const find = (slots, name) => { for (const s of slots) { if (s.name === name && !s.isGroup) return s; const r = s.children && find(s.children, name); if (r) return r; const n = s.selected && find(s.selected.slots, name); if (n) return n } }
const intercessors = find(d.slots, 'Intercessor')
b.setNumber(intercessors.selected.uid, 9)
check('a bigger squad costs more', b.detail(uid).pts > d.pts, `${b.detail(uid).pts} pts for ten`)

// a saved list opens again exactly
const total = Math.round(b.view().costs[0].total)
const again = Builder.load(sys, JSON.parse(JSON.stringify(b.save())))
check('saving and loading keeps everything', again.dropped === 0 && Math.round(again.builder.view().costs[0].total) === total && again.builder.view().costs[0].limit === 1000, `${total} pts, dropped ${again.dropped}`)

// "Override points limit?" hands the limit back to the player
const over = b.detail(sizeUid).slots.find((s) => s.name === 'Override points limit?')
b.addSelection(sizeUid, over.id)
b.roster.limits[b.pts] = 1500
b.reconcile()
check('overriding the points limit keeps the player\'s own', b.view().costs[0].limit === 1500, `limit ${b.view().costs[0].limit}`)

// a leader goes with a unit: shown on both, kept when saved, written for New Recruit, dropped when the unit goes
{
  const b2 = new Builder(sys, undefined, 'Leaders')
  b2.addForce(null, b2.view().forceChoices.find((c) => c.name === 'Army Roster').id, manifest.catalogues.find((c) => c.name.endsWith('Ultramarines')).id)
  const fv = b2.view().forces[0]
  const addUnit = (r, n) => b2.addSelection(fv.uid, fv.roles.find((x) => x.name === r).choices.find((c) => c.name === n).id)
  const captain = addUnit('Character', 'Captain')
  const squad = addUnit('Battleline', 'Intercessor Squad')
  const terminators = addUnit('Infantry', 'Terminator Squad')
  const attach = b2.detail(captain).attach[0]
  check('a Captain can lead Intercessors but not Terminators', attach && attach.options.some((o) => o.uid === squad) && !attach.options.some((o) => o.uid === terminators), attach?.options.map((o) => o.name).join(', '))
  b2.setAssociation(captain, attach.id, squad)
  const lines = () => b2.view().forces[0].roles.flatMap((r) => r.selections).flatMap((s) => s.links)
  check('both units say so', lines().join('|') === 'Leading Intercessor Squad|Led by Captain', lines().join(' | '))
  check('a saved list keeps it', Builder.load(sys, JSON.parse(JSON.stringify(b2.save()))).builder.view().forces[0].roles.flatMap((r) => r.selections).flatMap((s) => s.links).length === 2)
  const xml = toRos(b2)
  check('the roster file for New Recruit has it, both ways', /<association type="outgoing" to="[^"]+" associationId="[^"]+" name="Leading"/.test(xml) && /<incomingAssociation type="incoming" from="[^"]+"/.test(xml))
  b2.remove(squad)
  check('it ends when the unit is removed', lines().length === 0)
}

console.log(`view() takes ${(() => { const t = performance.now(); b.view(); return (performance.now() - t).toFixed(1) })()} ms`)
console.log(`total ${Math.round(performance.now() - t0)} ms ${failed ? failed + ' FAILED' : 'all passed'}`)
process.exit(failed ? 1 : 0)
