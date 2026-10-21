// Turns a BSData repository (the community rules data behind BattleScribe and New Recruit) into small files the army builder
// loads in the browser. Run it once per data update:
//
//   node scripts/build-bsdata.mjs <folder with the BSData .json files> <output folder> [source commit]
//
// What it does to make the data fast to load:
//  * drops everything the builder never reads (author details, comments, schema noise, default-valued flags)
//  * writes one file per catalogue, so a player only downloads the game system, the shared libraries and their own army
//  * writes a manifest the builder reads first (which army needs which files)
// The rules themselves (entries, costs, constraints, modifiers, conditions) are kept exactly as BSData has them, because the
// builder reproduces BattleScribe's behaviour from them.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [src, out, commit = ''] = process.argv.slice(2)
if (!src || !out) {
  console.error('usage: node scripts/build-bsdata.mjs <bsdata folder> <output folder> [commit]')
  process.exit(1)
}

const DROP = new Set([
  'authorContact', 'authorName', 'authorUrl', 'battleScribeVersion', 'xmlns', 'comment', 'import', 'page', 'publicationId',
  'childName', 'noindex', 'collapsible', 'collective', 'flatten', 'sortIndex',
])
// flags that mean "no" when missing: leaving them out keeps the files small
const FALSE_WHEN_MISSING = new Set(['hidden', 'automatic', 'includeChildSelections', 'includeChildForces', 'shared', 'primary', 'negative', 'percentValue', 'roundUp', 'library'])

function strip(node) {
  if (Array.isArray(node)) return node.map((n) => strip(n))
  if (node === null || typeof node !== 'object') return node
  const o = {}
  for (const [k, v] of Object.entries(node)) {
    if (DROP.has(k)) continue
    if (FALSE_WHEN_MISSING.has(k) && v === false) continue
    if ((k === 'modifiers' || k === 'constraints' || k === 'conditions') && Array.isArray(v) && v.length === 0) continue
    o[k] = strip(v)
  }
  return o
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const files = readdirSync(src).filter((f) => f.endsWith('.json') && f !== 'package.json')
const catalogues = []
let system = null
let bytes = 0

for (const f of files) {
  let raw
  try { raw = JSON.parse(readFileSync(join(src, f), 'utf8')) } catch { continue }
  const root = raw.gameSystem ?? raw.catalogue
  if (!root?.id) continue
  const kind = raw.gameSystem ? 'system' : 'catalogue'
  const name = `${slug(root.name)}.json`
  const text = JSON.stringify({ [kind]: strip(root) })
  writeFileSync(join(out, name), text)
  bytes += text.length
  if (kind === 'system') system = { id: root.id, name: root.name, revision: root.revision, file: name, costTypes: (root.costTypes ?? []).map((c) => ({ id: c.id, name: c.name, defaultCostLimit: c.defaultCostLimit ?? -1, hidden: !!c.hidden })) }
  else catalogues.push({ id: root.id, name: root.name, revision: root.revision, file: name, library: !!root.library, links: (root.catalogueLinks ?? []).map((l) => l.targetId), roots: (root.entryLinks?.length ?? 0) + (root.selectionEntries?.length ?? 0) })
}

if (!system) { console.error('no game system found in', src); process.exit(1) }
catalogues.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ system, catalogues, commit, built: new Date().toISOString().slice(0, 10) }))
console.log(`${system.name}: ${catalogues.length} catalogues, ${(bytes / 1e6).toFixed(1)} MB written to ${out}`)
