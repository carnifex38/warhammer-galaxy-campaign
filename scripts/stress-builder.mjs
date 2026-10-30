// Adds every available unit of every army to its force (the primary detachment in Horus Heresy, the army roster in 40,000), one
// after another, to catch crashes and slow spots:
//   node scripts/stress-builder.mjs <folder made by build-bsdata.mjs>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSystem } from '../src/builder/engine.ts'
import { Builder } from '../src/builder/roster.ts'

const dir = process.argv[2]
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const sys = buildSystem(read(manifest.system.file).system, manifest.catalogues.map((c) => read(c.file).catalogue))

let units = 0, errors = 0, slowest = { ms: 0, what: '' }
const t0 = performance.now()
for (const army of manifest.catalogues.filter((c) => !c.library)) {
  try {
    const b = new Builder(sys, undefined, army.name)
    let v = b.view()
    // Horus Heresy: a Crusade Force whose primary detachment holds the units; 40,000: the army roster holds them itself
    const orgChoice = v.forceChoices.find((c) => /Crusade Force|Army Roster/.test(c.name))
    const org = b.addForce(null, orgChoice.id, army.id)
    v = b.view()
    const primChoice = v.forces[0].childChoices.find((c) => /Primary Detachment/.test(c.name))
    if (primChoice) b.addForce(org, primChoice.id)
    else if (!/Army Roster/.test(orgChoice.name)) { console.log(army.name, 'no primary detachment'); continue }
    v = b.view()
    const prim = primChoice ? v.forces[0].forces[0] : v.forces[0]
    let n = 0
    for (const role of prim.roles) {
      for (const c of role.choices) {
        const t = performance.now()
        const uid = b.addSelection(prim.uid, c.id)
        const view = b.view()
        if (uid) b.detail(uid)
        const ms = performance.now() - t
        if (ms > slowest.ms) slowest = { ms, what: `${army.name} / ${c.name}` }
        n++; units++
        if ((primChoice ? view.forces[0].forces[0] : view.forces[0]).roles.length === 0) throw new Error('roles vanished')
        b.remove(uid) // keep the roster small so every unit is tried on its own
      }
    }
    console.log(`${army.name}: ${n} units tried`)
  } catch (e) {
    errors++
    console.log(`ERROR in ${army.name}:`, e instanceof Error ? e.stack?.split('\n').slice(0, 4).join(' | ') : e)
  }
}
console.log(`${units} units across ${manifest.catalogues.filter((c) => !c.library).length} armies in ${Math.round(performance.now() - t0)} ms; slowest add+view+detail: ${Math.round(slowest.ms)} ms (${slowest.what}); ${errors} armies with errors`)
process.exit(errors ? 1 : 0)
