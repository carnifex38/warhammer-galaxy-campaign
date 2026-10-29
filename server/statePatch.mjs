// Several gamemasters edit the same event. Instead of each one sending the whole setup (the last save would wipe out the others), a
// gamemaster's browser sends only what it changed, as a list of small steps, and the server lays them on the current setup.
//   { p: ['info', 'mars', 'summary'], v: 'text' }   set one value (creating what is missing on the way)
//   { p: ['config', 'mars', 'tables'], del: true }   remove one value
//   { p: ['locked'], add: 'solar' } / { rem: 'solar' } add or remove one sector in the list of locked sectors
// Two gamemasters changing different things never clash; changing the very same value, the later one wins.
// The browser and the server share this file.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The steps that turn setup `base` into setup `mine` (both { config, hulks, info, locked, teams }). */
export function diffSetup(base, mine) {
  const out = []
  const walk = (b, m, path) => {
    if (isObj(m) && (isObj(b) || b === undefined)) {
      if (b === undefined && Object.keys(m).length === 0) { out.push({ p: path, v: {} }); return }
      for (const k of new Set([...Object.keys(isObj(b) ? b : {}), ...Object.keys(m)])) walk(isObj(b) ? b[k] : undefined, m[k], [...path, k])
      return
    }
    if (m === undefined) { if (b !== undefined) out.push({ p: path, del: true }); return }
    if (!sameJson(b, m)) out.push({ p: path, v: m })
  }
  for (const key of ['config', 'hulks', 'info', 'teams']) walk(base?.[key] ?? undefined, mine?.[key] ?? undefined, [key])
  const was = new Set(base?.locked ?? [])
  const now = new Set(mine?.locked ?? [])
  for (const id of now) if (!was.has(id)) out.push({ p: ['locked'], add: id })
  for (const id of was) if (!now.has(id)) out.push({ p: ['locked'], rem: id })
  return out
}

const TOP = new Set(['config', 'hulks', 'info', 'locked', 'teams'])
const BAD_KEY = new Set(['__proto__', 'constructor', 'prototype'])
export const MAX_OPS = 3000

/** True when the steps are well formed (what arrives from a browser is checked before it is applied). */
export function validOps(ops) {
  if (!Array.isArray(ops) || ops.length > MAX_OPS) return false
  return ops.every((o) => isObj(o) && Array.isArray(o.p) && o.p.length >= 1 && o.p.length <= 5 && TOP.has(o.p[0])
    && o.p.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 80 && !BAD_KEY.has(s))
    && (o.p[0] === 'locked' ? o.p.length === 1 && (typeof o.add === 'string' || typeof o.rem === 'string') : (o.del === true || 'v' in o)))
}

/** A copy of `setup` with the steps laid on it. `setup` may be null (nothing saved yet). */
export function applyOps(setup, ops) {
  const next = JSON.parse(JSON.stringify(setup ?? { config: {}, hulks: {}, info: {}, locked: [] }))
  next.teams ??= null
  for (const o of ops) {
    if (o.p[0] === 'locked') {
      next.locked = Array.isArray(next.locked) ? next.locked : []
      if (typeof o.add === 'string' && !next.locked.includes(o.add)) next.locked.push(o.add)
      if (typeof o.rem === 'string') next.locked = next.locked.filter((x) => x !== o.rem)
      continue
    }
    if (o.p[0] === 'teams' && !isObj(next.teams)) next.teams = {}
    let at = next
    for (let i = 0; i < o.p.length - 1; i++) {
      if (!isObj(at[o.p[i]])) at[o.p[i]] = {}
      at = at[o.p[i]]
    }
    const last = o.p[o.p.length - 1]
    if (o.del) delete at[last]
    else at[last] = o.v
  }
  return next
}
