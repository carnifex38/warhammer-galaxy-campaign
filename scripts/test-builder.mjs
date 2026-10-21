// Tries the army builder engine on real BSData files, straight in Node:
//   node scripts/test-builder.mjs <folder made by build-bsdata.mjs> [army name]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSystem } from '../src/builder/engine.ts'
import { Builder } from '../src/builder/roster.ts'

const dir = process.argv[2]
const armyName = process.argv[3] ?? 'Ultramarines'
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
const t0 = performance.now()
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const sys = buildSystem(read(manifest.system.file).system, manifest.catalogues.map((c) => read(c.file).catalogue))
console.log(`loaded ${manifest.catalogues.length} catalogues, ${sys.byId.size} nodes in ${Math.round(performance.now() - t0)} ms`)

let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++ }
const uniq = (v) => [...new Set(v.issues.map((i) => i.text))]
const find = (slots, name) => { for (const s of slots) { if (s.name === name && !s.isGroup) return s; const r = s.children && find(s.children, name); if (r) return r; const n = s.selected && find(s.selected.slots, name); if (n) return n } }

const army = manifest.catalogues.find((c) => c.name.includes(armyName))
const b = new Builder(sys, undefined, 'Test')
let v = b.view()
const orgUid = b.addForce(null, v.forceChoices.find((c) => /Crusade Force/.test(c.name)).id, army.id)
v = b.view()
const org = v.forces[0]
console.log('Org chart roles:', org.roles.map((r) => `${r.name}(${r.choices.map((c) => c.name).slice(0, 4).join(', ')})`).join('; '))
check('fresh force asks for an allegiance', uniq(v).some((t) => /Allegiance/.test(t)))

const alle = org.roles.find((r) => r.name === 'Allegiance')
b.addSelection(orgUid, alle.choices[0].id)
const rite = org.roles.find((r) => /Rite of War/.test(r.name))
console.log('Allegiance chosen:', alle.choices[0].name, '| rite choices:', rite?.choices.map((c) => c.name).slice(0, 6))
v = b.view()
console.log('issues now:', uniq(v))

b.addForce(orgUid, v.forces[0].childChoices.find((c) => c.name === 'Crusade Primary Detachment').id)
v = b.view()
const pf = v.forces[0].forces[0]
const troops = pf.roles.find((r) => r.name === 'Troops')
const tuid = b.addSelection(pf.uid, troops.choices.find((c) => c.name === 'Tactical Squad').id)
let d = b.detail(tuid)
check('tactical squad costs 100 (9 legionaries at 10, unit 10)', d.pts === 100, `got ${d.pts}`)
check('squad starts with 9 legionaries and a sergeant', find(d.slots, 'Legionary').number === 9 && find(d.slots, 'Sergeant').number === 1)

// the sergeant swaps his bolter for a power sword: the default bolter must go (automatic constraint) and points rise
const sgt = find(d.slots, 'Sergeant').selected
const sword = find(sgt.slots, 'Power sword')
b.addSelection(sgt.uid, sword.id)
d = b.detail(tuid)
const sgt2 = find(d.slots, 'Sergeant').selected
const swordAfter = find(sgt2.slots, 'Power sword')
console.log('after power sword: squad pts', d.pts, 'sword number', swordAfter.number)
check('power sword is selected', swordAfter.number === 1)

b.setNumber(find(d.slots, 'Legionary').selected.uid, 14)
v = b.view()
check('14 legionaries add 50 points', v.costs[0].total === d.pts + 50, `total ${v.costs[0].total}`)
b.setNumber(find(b.detail(tuid).slots, 'Legionary').selected.uid, 25)
v = b.view()
console.log('25 legionaries issues:', uniq(v))
check('too many legionaries is flagged', uniq(v).some((t) => /Legionary/.test(t)))
b.setNumber(find(b.detail(tuid).slots, 'Legionary').selected.uid, 9)

const saved = b.save()
const text = JSON.stringify(saved)
const { builder: b2, dropped } = Builder.load(sys, JSON.parse(text))
check('saving and loading keeps everything', dropped === 0 && b2.view().costs[0].total === b.view().costs[0].total, `${text.length} bytes saved, dropped ${dropped}`)

const t3 = performance.now()
for (let i = 0; i < 20; i++) b.view()
console.log(`view() takes ${((performance.now() - t3) / 20).toFixed(1)} ms`)
console.log('total', Math.round(performance.now() - t0), 'ms', failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
