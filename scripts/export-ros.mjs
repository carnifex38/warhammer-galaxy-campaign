// Builds a sample Horus Heresy list in Node and writes it as BattleScribe roster files, to try them in New Recruit:
//   node scripts/export-ros.mjs <folder made by build-bsdata.mjs> <output folder>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSystem } from '../src/builder/engine.ts'
import { Builder } from '../src/builder/roster.ts'
import { toRos, toRosz } from '../src/builder/ros.ts'

const [dir, out] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const sys = buildSystem(read(manifest.system.file).system, manifest.catalogues.map((c) => read(c.file).catalogue))
const army = manifest.catalogues.find((c) => c.name.includes('Ultramarines'))

const b = new Builder(sys, undefined, 'Galaxy Campaign test')
b.roster.limits[b.pts] = 3000
let v = b.view()
const org = b.addForce(null, v.forceChoices.find((c) => /Crusade Force/.test(c.name)).id, army.id)
v = b.view()
const find = (slots, name) => { for (const s of slots) { if (s.name === name && !s.isGroup) return s; const r = s.children && find(s.children, name); if (r) return r; const n = s.selected && find(s.selected.slots, name); if (n) return n } }
const pick = (roles, role, name) => roles.find((r) => r.name === role).choices.find((c) => c.name === name).id
const allegUid = b.addSelection(org, pick(v.forces[0].roles, 'Allegiance', 'Allegiance'))
b.addSelection(allegUid, find(b.detail(allegUid).slots, 'Loyalist').id)
const riteUid = b.addSelection(org, pick(v.forces[0].roles, 'Army Configuration', 'Rite of War'))
b.addSelection(riteUid, find(b.detail(riteUid).slots, 'Legiones Astartes Ultramarines').id)
v = b.view()
b.addForce(org, v.forces[0].childChoices.find((c) => c.name === 'Crusade Primary Detachment').id)
v = b.view()
const prim = v.forces[0].forces[0]
const squad = b.addSelection(prim.uid, pick(prim.roles, 'Troops', 'Tactical Squad'))
const sgt = find(b.detail(squad).slots, 'Sergeant').selected
b.addSelection(sgt.uid, find(sgt.slots, 'Power sword').id)
b.addSelection(prim.uid, pick(prim.roles, 'High Command', 'Praetor'))
v = b.view()
console.log('points', v.costs[0].total, 'problems', v.issues.filter((i) => i.level === 'error').map((i) => i.text))
mkdirSync(out, { recursive: true })
const xml = toRos(b)
writeFileSync(join(out, 'galaxy-test.ros'), xml)
writeFileSync(join(out, 'galaxy-test.rosz'), toRosz(xml, 'galaxy-test.ros'))
console.log('wrote', out, xml.length, 'bytes of XML')
