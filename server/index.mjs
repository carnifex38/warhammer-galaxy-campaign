// Live-event server: serves the built app (dist/) and keeps the event state that the gamemaster edits and players read.
// No dependencies, Node 22.13+ (it uses the built-in node:sqlite). Configure with environment variables:
//   GM_PASSWORD  required. The gamemaster password (checked here, never sent to browsers).
//   PORT         default 3000
//   HOST         default 0.0.0.0
//   DATA_DIR     default ./data   (holds campaign.db, the SQLite database with everything the server keeps, and media/, uploaded pictures)
//   DIST_DIR     default ./dist
import { createServer } from 'node:http'
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { openStore } from './db.mjs'
import { applyOps, validOps } from './statePatch.mjs'

const GM_PASSWORD = process.env.GM_PASSWORD
if (!GM_PASSWORD) {
  console.error('Set GM_PASSWORD before starting, e.g.  GM_PASSWORD="something" node server/index.mjs')
  process.exit(1)
}
const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'
const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data')
const DIST_DIR = resolve(process.env.DIST_DIR ?? 'dist')
const MAX_BODY = 1_000_000

mkdirSync(DATA_DIR, { recursive: true })
const store = openStore(DATA_DIR)

/**
 * Reads a saved file. A file that is missing gives `empty`. One that cannot be read, or has the wrong shape, is kept aside as
 * `<name>.bak` (so the next save does not overwrite it) and gives `empty` too.
 */
function loadJson(file, valid, empty) {
  if (!existsSync(file)) return empty
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (valid(data)) return data
    console.error(`${file} has the wrong shape: set aside as ${file}.bak, starting empty.`)
  } catch (e) {
    console.error(`Could not read ${file} (${e.message}): set aside as ${file}.bak, starting empty.`)
  }
  try { renameSync(file, file + '.bak') } catch { /* nothing more to do */ }
  return empty
}

// ---- state -----------------------------------------------------------------------------------------------------
// { config, hulks, info, locked, teams } exactly as the client's useEventConfig keeps it, or null before the gamemaster saves.
let version = 0
// names this run of the server: a browser compares the version numbers it gets only within one run (they start again after a restart)
const EPOCH = randomBytes(4).toString('hex')

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const validTeam = (t) => isObj(t) && typeof t.name === 'string' && t.name.length <= 24 && /^#[0-9a-f]{6}$/i.test(t.color)
const DEFAULT_TEAMS = { A: { name: 'Team A', color: '#3d8bff' }, B: { name: 'Team B', color: '#ff4141' } }
const cleanTeams = (t) => Object.fromEntries(['A', 'B'].map((id) => [id, {
  name: typeof t[id]?.name === 'string' && t[id].name.trim() ? t[id].name.trim().slice(0, 24) : DEFAULT_TEAMS[id].name,
  color: typeof t[id]?.color === 'string' && /^#[0-9a-f]{6}$/i.test(t[id].color) ? t[id].color : DEFAULT_TEAMS[id].color,
}]))
const validState = (s) => isObj(s) && isObj(s.config) && isObj(s.hulks) && isObj(s.info) && Array.isArray(s.locked) && (s.teams === undefined || s.teams === null || (isObj(s.teams) && validTeam(s.teams.A) && validTeam(s.teams.B)))
/** A map keyed by text that comes from a request: no prototype, so a key like "constructor" is just a key. */
const keyed = (o = {}) => Object.assign(Object.create(null), o)

// Before SQLite the server kept its data in JSON files. The first start with an empty database moves them in (in one transaction)
// and renames them *.migrated, so they stay as a backup but are not read again.
const LEGACY = { state: 'state.json', profiles: 'profiles.json', claims: 'claims.json', calendar: 'calendar.json' }
for (const k of Object.keys(LEGACY)) LEGACY[k] = join(DATA_DIR, LEGACY[k])
const str = (v) => typeof v === 'string'
if (Object.values(LEGACY).some(existsSync)) {
  if (!store.isEmpty()) console.error(`Found old JSON files in ${DATA_DIR} but campaign.db already has data: left them alone.`)
  else {
    store.transaction(() => {
      const s = loadJson(LEGACY.state, validState, null)
      if (s) store.saveState(s)
      for (const p of Object.values(loadJson(LEGACY.profiles, isObj, {}))) {
        if (isObj(p) && str(p.id) && str(p.name) && str(p.key) && str(p.salt) && str(p.hash)) store.saveProfile({ ...p, created: p.created ?? 0, updated: p.updated ?? 0 })
      }
      store.saveClaims(Object.fromEntries(Object.entries(loadJson(LEGACY.claims, isObj, {})).filter(([, t]) => isObj(t) && Array.isArray(t.seats))))
      store.saveCalendar(loadJson(LEGACY.calendar, Array.isArray, []).filter((e) => isObj(e) && str(e.id) && str(e.name) && str(e.date) && Array.isArray(e.planets)))
    })
    for (const f of Object.values(LEGACY)) if (existsSync(f)) renameSync(f, f + '.migrated')
    console.log(`Moved the old JSON files in ${DATA_DIR} into campaign.db (kept as *.migrated).`)
  }
}

let state = store.loadState()
const persist = () => store.saveState(state)

/** What a player may see: the text of sections the gamemaster has hidden is removed, and so is anything about hidden planets. */
function forPlayers(s) {
  if (!s) return null
  const info = {}
  for (const [id, o] of Object.entries(s.info)) {
    if (!isObj(o) || s.config[id]?.visible === false) continue
    const c = { ...o }
    if (c.infoHidden) delete c.summary
    if (c.intelHidden) delete c.intel
    if (c.missionHidden) { delete c.objectives; delete c.rewards }
    info[id] = c
  }
  return { ...s, info }
}

// ---- auth ------------------------------------------------------------------------------------------------------
// The token is derived from the password, so it survives restarts and stops working if the password changes.
const GM_TOKEN = createHmac('sha256', GM_PASSWORD).update('gm-session-v1').digest('hex')
const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
const bearer = (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null


// ---- player profiles -------------------------------------------------------------------------------------------
// A profile is a name and a password chosen by the player (no email). It holds that player's army lists. Passwords are never
// stored: only a salted scrypt hash. A signed-in profile gets a token; the gamemaster token can also read, edit and delete any
// profile. Changing a profile's password would invalidate its token (the token is derived from the hash).
const scryptAsync = promisify(scrypt)
const MAX_PROFILES = 300
const MAX_ARMIES_BYTES = 200_000
/** id -> { id, name, key (lower-case name), salt, hash, created, updated, armies } */
let profiles = keyed(Object.fromEntries(store.loadProfiles().map((p) => [p.id, p])))

/** Removes a profile and everything that points at it (seats, sign-ups), all in one transaction. */
const removeProfile = (p) => store.transaction(() => {
  delete profiles[p.id]
  store.deleteProfile(p.id)
  dropSeatsOf(p.id)
})

const hashPassword = async (password, salt) => (await scryptAsync(password, salt, 32)).toString('hex')
const profileToken = (p) => `${p.id}.${createHmac('sha256', GM_PASSWORD).update(`profile-v1:${p.id}:${p.hash}`).digest('hex')}`
function profileFromToken(t) {
  if (!t || !t.includes('.')) return null
  const p = profiles[t.split('.')[0]]
  return p && safeEq(t, profileToken(p)) ? p : null
}
const isGm = (req) => { const t = bearer(req); return t !== null && safeEq(t, GM_TOKEN) }
const summary = (p) => ({ id: p.id, name: p.name, created: p.created, updated: p.updated, armyCount: p.armies.length })
const full = (p) => ({ ...summary(p), armies: p.armies })
const cleanName = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const validName = (n) => n.length >= 2 && n.length <= 24 && ![...n].some((ch) => ch.charCodeAt(0) < 32)
const validPassword = (v) => typeof v === 'string' && v.length >= 4 && v.length <= 64
const validArmy = (x) =>
  isObj(x) && typeof x.id === 'string' && x.id.length <= 40 && typeof x.name === 'string' && x.name.length <= 80
  && (x.era === undefined || x.era === '40k' || x.era === '30k') && (x.notes === undefined || (typeof x.notes === 'string' && x.notes.length <= 4000))
  && (x.roster === undefined || x.roster === null || (isObj(x.roster) && (x.roster.pts === undefined || Number.isFinite(x.roster.pts))))
const validArmies = (a) => Array.isArray(a) && a.length <= 60 && a.every(validArmy) && JSON.stringify(a).length <= MAX_ARMIES_BYTES

// slow down guessing: at most 10 failed attempts a minute from one address
const profileFails = new Map()
setInterval(() => profileFails.clear(), 60_000).unref()
const who = (req) => (process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || (req.socket.remoteAddress ?? '?')
const tooMany = (req) => (profileFails.get(who(req)) ?? 0) >= 10
const failed = (req) => profileFails.set(who(req), (profileFails.get(who(req)) ?? 0) + 1)

/** Handles the profile routes. Returns null when the method does not fit the route. */
async function profilesApi(req, res, path) {
  const m = req.method

  if (path === '/api/profiles' && m === 'POST') {
    if (tooMany(req)) return json(res, 429, { error: 'Too many attempts, wait a minute.' })
    failed(req) // making accounts counts as an attempt too, so a script cannot fill every profile slot
    const body = await readBody(req).catch(() => null)
    const name = cleanName(body?.name)
    if (!validName(name)) return json(res, 400, { error: 'The name must be 2 to 24 characters.' })
    if (!validPassword(body?.password)) return json(res, 400, { error: 'The password must be 4 to 64 characters.' })
    const nameTaken = () => Object.values(profiles).some((p) => p.key === name.toLowerCase())
    if (nameTaken()) return json(res, 409, { error: 'That name is taken. Choose another.' })
    if (Object.keys(profiles).length >= MAX_PROFILES) return json(res, 507, { error: 'There are too many profiles.' })
    const salt = randomBytes(16).toString('hex')
    const id = randomBytes(8).toString('hex')
    const now = Date.now()
    const hash = await hashPassword(body.password, salt)
    // the hashing took a moment: another request may have taken the name or the last slot meanwhile
    if (nameTaken()) return json(res, 409, { error: 'That name is taken. Choose another.' })
    if (Object.keys(profiles).length >= MAX_PROFILES) return json(res, 507, { error: 'There are too many profiles.' })
    const p = { id, name, key: name.toLowerCase(), salt, hash, created: now, updated: now, armies: [] }
    profiles[id] = p
    store.saveProfile(p)
    return json(res, 201, { token: profileToken(p), profile: full(p) })
  }

  if (path === '/api/profile-login' && m === 'POST') {
    if (tooMany(req)) return json(res, 429, { error: 'Too many attempts, wait a minute.' })
    const body = await readBody(req).catch(() => null)
    const key = cleanName(body?.name).toLowerCase()
    const p = Object.values(profiles).find((x) => x.key === key)
    // hash even when the name is unknown, so the time taken does not reveal which names exist
    const attempt = await hashPassword(typeof body?.password === 'string' ? body.password.slice(0, 64) : '', p?.salt ?? '0'.repeat(32))
    if (p && safeEq(attempt, p.hash)) return json(res, 200, { token: profileToken(p), profile: full(p) })
    failed(req)
    return json(res, 401, { error: 'Wrong name or password.' })
  }

  // the signed-in player's own profile
  if (path === '/api/profile') {
    const p = profileFromToken(bearer(req))
    if (!p) return json(res, 401, { error: 'Not signed in.' })
    if (m === 'GET') return json(res, 200, { profile: full(p) })
    if (m === 'PUT') {
      const body = await readBody(req).catch(() => null)
      if (!validArmies(body?.armies)) return json(res, 400, { error: 'Bad army lists.' })
      p.armies = body.armies
      p.updated = Date.now()
      store.saveProfile(p)
      return json(res, 200, { profile: full(p) })
    }
    if (m === 'DELETE') {
      removeProfile(p)
      return json(res, 200, { ok: true })
    }
    return null
  }

  // gamemaster: add a practice player with a couple of sample army lists (password "dummy"), to try the screens or delete
  if (path === '/api/profiles/dummy' && m === 'POST') {
    if (!isGm(req)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    if (Object.keys(profiles).length >= MAX_PROFILES) return json(res, 507, { error: 'There are too many profiles.' })
    let name = 'Dummy Player'
    for (let n = 2; Object.values(profiles).some((p) => p.key === name.toLowerCase()); n++) name = `Dummy Player ${n}`
    const salt = randomBytes(16).toString('hex')
    const id = randomBytes(8).toString('hex')
    const now = Date.now()
    const armies = [
      { id: 'd1', name: 'Dummy Ultramarines', era: '40k', notes: ['Practice list.', 'Captain with relic blade', '10 Intercessors', '5 Hellblasters'].join('\n') },
      { id: 'd2', name: 'Dummy Legion Detachment', era: '30k', notes: ['Practice list.', 'Praetor', '20 Tactical Marines', 'Contemptor Dreadnought'].join('\n') },
    ]
    const p = { id, name, key: name.toLowerCase(), salt, hash: await hashPassword('dummy', salt), created: now, updated: now, armies }
    profiles[id] = p
    store.saveProfile(p)
    return json(res, 201, { profile: full(p) })
  }

  // gamemaster: every profile
  if (path === '/api/profiles' && m === 'GET') {
    if (!isGm(req)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    return json(res, 200, { profiles: Object.values(profiles).map(summary).sort((a, b) => a.name.localeCompare(b.name)) })
  }
  const one = /^\/api\/profiles\/([0-9a-f]{16})$/.exec(path)
  if (one) {
    if (!isGm(req)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    const p = profiles[one[1]]
    if (!p) return json(res, 404, { error: 'No such profile.' })
    if (m === 'GET') return json(res, 200, { profile: full(p) })
    if (m === 'PUT') {
      const body = await readBody(req).catch(() => null)
      if (!validArmies(body?.armies)) return json(res, 400, { error: 'Bad army lists.' })
      p.armies = body.armies
      p.updated = Date.now()
      store.saveProfile(p)
      return json(res, 200, { profile: full(p) })
    }
    if (m === 'DELETE') {
      removeProfile(p)
      return json(res, 200, { ok: true })
    }
  }
  return null
}


// ---- battlezone claims ---------------------------------------------------------------------------------------------
// A battlezone is "open" or "in play". Players drop in freely: each picks a side (A or B) and one of their army lists. Others see
// who is there, their side, and the list's name, era and points; the list itself is readable by signed-in players and the
// gamemaster, and only through a seat. The list is live while the battlezone is open; when the gamemaster marks it in play a
// copy is frozen, and reopening it unfreezes it. Seats of a deleted profile disappear.
/** tableId -> { status: 'open' | 'in_play', seats: [{ profileId, team, armyId, claimedAt, snapshot? }] } */
let claims = keyed(store.loadClaims())

const persistClaims = () => store.saveClaims(claims)
const changed = () => { persistClaims(); version++; broadcast() }

function dropSeatsOf(profileId) {
  dropSignupsOf(profileId)
  let any = false
  for (const t of Object.values(claims)) {
    const n = t.seats.length
    t.seats = t.seats.filter((s) => s.profileId !== profileId)
    if (t.seats.length !== n) any = true
  }
  for (const [id, t] of Object.entries(claims)) if (t.seats.length === 0 && t.status === 'open' && !t.winner) delete claims[id]
  if (any) changed()
}

const armyOf = (profile, armyId) => profile?.armies.find((a) => a.id === armyId)

/** A seat as everyone may see it: who, which side, and the list's name, era and points (not its contents). */
function seatView(seat) {
  const p = profiles[seat.profileId]
  const army = seat.snapshot ?? armyOf(p, seat.armyId)
  return {
    profileId: seat.profileId, name: p?.name ?? 'Unknown', team: seat.team, armyId: seat.armyId,
    armyName: String(army?.name ?? '').slice(0, 80) || 'Untitled army', era: army?.era === '30k' ? '30k' : '40k', pts: Number.isFinite(army?.roster?.pts) ? army.roster.pts : undefined, locked: !!seat.snapshot, missing: !army,
  }
}

function claimsView() {
  const out = {}
  for (const [id, t] of Object.entries(claims)) out[id] = { status: t.status, seats: t.seats.map(seatView), winner: t.winner ?? null, wonAt: t.wonAt ?? 0 }
  return out
}

/** Who is asking: a profile (a player, or a gamemaster with a profile) or the gamemaster. */
const askedBy = (req) => ({ profile: profileFromToken(bearer(req)), gm: isGm(req) })

async function claimsApi(req, res, path) {
  const m = req.method

  if (path === '/api/claims' && m === 'GET') return json(res, 200, { tables: claimsView() })

  const one = /^\/api\/claims\/([a-z0-9-]{1,80})$/.exec(path)
  if (one) {
    const tableId = one[1]
    const who = askedBy(req)
    if (m === 'POST') { // take (or change) a seat
      if (!who.profile) return json(res, 401, { error: 'Sign in with a profile to claim a battlezone.' })
      const body = await readBody(req).catch(() => null)
      if (body?.team !== 'A' && body?.team !== 'B') return json(res, 400, { error: 'Pick team A or B.' })
      if (!armyOf(who.profile, body?.armyId)) return json(res, 400, { error: 'Pick one of your army lists.' })
      if (!claims[tableId] && Object.keys(claims).length >= 2000) return json(res, 507, { error: 'Too many battlezones.' })
      const t = claims[tableId] ?? (claims[tableId] = { status: 'open', seats: [] })
      if (t.status !== 'open') return json(res, 409, { error: 'This battlezone is already in play.' })
      const seat = t.seats.find((s) => s.profileId === who.profile.id)
      if (seat) { seat.team = body.team; seat.armyId = body.armyId } else t.seats.push({ profileId: who.profile.id, team: body.team, armyId: body.armyId, claimedAt: Date.now() })
      changed()
      return json(res, 200, { tables: claimsView() })
    }
    if (m === 'DELETE') { // leave, any time
      if (!who.profile) return json(res, 401, { error: 'Sign in with a profile.' })
      const t = claims[tableId]
      if (t) {
        t.seats = t.seats.filter((s) => s.profileId !== who.profile.id)
        if (t.seats.length === 0 && t.status === 'open' && !t.winner) delete claims[tableId]
        changed()
      }
      return json(res, 200, { tables: claimsView() })
    }
    return null
  }

  const status = /^\/api\/claims\/([a-z0-9-]{1,80})\/status$/.exec(path)
  if (status && m === 'PUT') { // gamemaster: open / in play
    if (!isGm(req)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    const body = await readBody(req).catch(() => null)
    if (body?.status !== 'open' && body?.status !== 'in_play') return json(res, 400, { error: 'Bad status.' })
    const t = claims[status[1]] ?? (claims[status[1]] = { status: 'open', seats: [] })
    t.status = body.status
    for (const seat of t.seats) {
      if (body.status === 'in_play') {
        const army = armyOf(profiles[seat.profileId], seat.armyId)
        seat.snapshot = army ? JSON.parse(JSON.stringify(army)) : undefined // the lists freeze as they are now
      } else delete seat.snapshot
    }
    if (t.seats.length === 0 && t.status === 'open' && !t.winner) delete claims[status[1]]
    changed()
    return json(res, 200, { tables: claimsView() })
  }

  if (path === '/api/claims/results/clear' && m === 'POST') { // gamemaster: clear battlezone results (the listed battlezones, or all of them)
    if (!isGm(req)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    const body = await readBody(req).catch(() => null)
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string') : null
    for (const [id, t] of Object.entries(claims)) {
      if (ids && !ids.includes(id)) continue
      delete t.winner
      delete t.wonAt
      if (t.seats.length === 0 && t.status === 'open') delete claims[id]
    }
    changed()
    return json(res, 200, { tables: claimsView() })
  }

  const winner = /^\/api\/claims\/([a-z0-9-]{1,80})\/winner$/.exec(path)
  if (winner && m === 'PUT') { // gamemaster: which team won this battlezone (null clears it); a void shield goes up for the winner
    if (!isGm(req)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    const body = await readBody(req).catch(() => null)
    if (body?.winner !== 'A' && body?.winner !== 'B' && body?.winner !== null) return json(res, 400, { error: 'Bad winner.' })
    const t = claims[winner[1]] ?? (claims[winner[1]] = { status: 'open', seats: [] })
    if (body.winner) { t.winner = body.winner; t.wonAt = Date.now() } else { delete t.winner; delete t.wonAt }
    if (t.seats.length === 0 && t.status === 'open' && !t.winner) delete claims[winner[1]]
    changed()
    return json(res, 200, { tables: claimsView() })
  }

  const seatRoute = /^\/api\/claims\/([a-z0-9-]{1,80})\/([0-9a-f]{16})(\/list)?$/.exec(path)
  if (seatRoute) {
    const [, tableId, profileId, list] = seatRoute
    const who = askedBy(req)
    if (m === 'DELETE' && !list) { // gamemaster removes someone
      if (!who.gm) return json(res, 401, { error: 'Not signed in as gamemaster.' })
      const t = claims[tableId]
      if (t) {
        t.seats = t.seats.filter((s) => s.profileId !== profileId)
        if (t.seats.length === 0 && t.status === 'open' && !t.winner) delete claims[tableId]
        changed()
      }
      return json(res, 200, { tables: claimsView() })
    }
    if (m === 'PUT' && !list) { // gamemaster: put a player at this battlezone, or change their team or list (even once it is in play)
      if (!who.gm) return json(res, 401, { error: 'Not signed in as gamemaster.' })
      const body = await readBody(req).catch(() => null)
      if (body?.team !== 'A' && body?.team !== 'B') return json(res, 400, { error: 'Pick team A or B.' })
      const profile = profiles[profileId]
      if (!profile) return json(res, 404, { error: 'No such player.' })
      const army = armyOf(profile, body?.armyId)
      if (!army) return json(res, 400, { error: "Pick one of that player's army lists." })
      if (Object.keys(claims).length > 2000) return json(res, 507, { error: 'Too many battlezones.' })
      const t = claims[tableId] ?? (claims[tableId] = { status: 'open', seats: [] })
      let seat = t.seats.find((s) => s.profileId === profileId)
      if (seat) { seat.team = body.team; seat.armyId = body.armyId } else { seat = { profileId, team: body.team, armyId: body.armyId, claimedAt: Date.now() }; t.seats.push(seat) }
      if (t.status === 'in_play') seat.snapshot = JSON.parse(JSON.stringify(army)) // the list is frozen as chosen
      changed()
      return json(res, 200, { tables: claimsView() })
    }
    if (m === 'GET' && list) { // read a list: only through a seat, and only for signed-in players and the gamemaster
      if (!who.profile && !who.gm) return json(res, 401, { error: 'Sign in to read lists.' })
      const seat = claims[tableId]?.seats.find((s) => s.profileId === profileId)
      if (!seat) return json(res, 404, { error: 'That player has no seat here.' })
      const army = seat.snapshot ?? armyOf(profiles[profileId], seat.armyId)
      if (!army) return json(res, 404, { error: 'That list no longer exists.' })
      return json(res, 200, { list: { name: army.name, era: army.era, notes: army.notes ?? '', roster: army.roster ?? null, locked: !!seat.snapshot, player: profiles[profileId]?.name ?? 'Unknown', team: seat.team, status: claims[tableId].status } })
    }
  }
  return null
}

// ---- calendar -----------------------------------------------------------------------------------------------------
// The gamemaster schedules events: a date, a name, and the planets that will be fought over (each with how many players are wanted).
// Players with a profile sign up for one planet per event; everyone can read the calendar. Signed-up players are shown by name.
/** [{ id, name, date: 'YYYY-MM-DD', notes, planets: [{ planetId, target, signups: [profileId] }] }] */
let calendar = store.loadCalendar()

const MAX_EVENTS = 500
const MAX_PLANETS_PER_EVENT = 24
const calendarChanged = () => {
  store.saveCalendar(calendar)
  version++
  broadcast()
}

const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d)
const cleanLine = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const cleanNotes = (v) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, 600) : '')

/** The planets of an event from what the gamemaster sent: valid ids, no repeats, a sensible player target; sign-ups carry over. */
function parsePlanets(list, previous = []) {
  if (!Array.isArray(list) || list.length > MAX_PLANETS_PER_EVENT) return null
  const out = []
  for (const x of list) {
    if (!isObj(x) || typeof x.planetId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(x.planetId)) return null
    if (out.some((o) => o.planetId === x.planetId)) continue
    const target = Number.isInteger(x.target) ? Math.min(99, Math.max(0, x.target)) : 0
    out.push({ planetId: x.planetId, target, signups: previous.find((o) => o.planetId === x.planetId)?.signups ?? [] })
  }
  return out
}

/** The calendar as everyone may see it: signed-up players by name. */
function calendarView() {
  return calendar
    .map((e) => ({
      id: e.id, name: e.name, date: e.date, notes: e.notes,
      planets: e.planets.map((pl) => ({ planetId: pl.planetId, target: pl.target, players: pl.signups.map((id) => ({ profileId: id, name: profiles[id]?.name ?? 'Unknown' })) })),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

/** A deleted profile drops out of every event it had signed up for. */
function dropSignupsOf(profileId) {
  let any = false
  for (const e of calendar) for (const pl of e.planets) {
    const n = pl.signups.length
    pl.signups = pl.signups.filter((id) => id !== profileId)
    if (pl.signups.length !== n) any = true
  }
  if (any) calendarChanged()
}

async function calendarApi(req, res, path) {
  const m = req.method
  if (path === '/api/calendar' && m === 'GET') return json(res, 200, { events: calendarView() })

  if (path === '/api/calendar' && m === 'POST') { // gamemaster: schedule an event
    if (!isGm(req)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    const body = await readBody(req).catch(() => null)
    const name = cleanLine(body?.name, 60)
    const planets = parsePlanets(body?.planets)
    if (!name) return json(res, 400, { error: 'Give the event a name.' })
    if (!validDate(body?.date)) return json(res, 400, { error: 'Pick a date.' })
    if (!planets) return json(res, 400, { error: 'Those planets are not valid.' })
    if (calendar.length >= MAX_EVENTS) return json(res, 507, { error: 'Too many events.' })
    calendar.push({ id: randomBytes(6).toString('hex'), name, date: body.date, notes: cleanNotes(body?.notes), planets })
    calendarChanged()
    return json(res, 200, { events: calendarView() })
  }

  const one = /^\/api\/calendar\/([a-f0-9]{12})$/.exec(path)
  if (one) {
    const ev = calendar.find((e) => e.id === one[1])
    if (!ev) return json(res, 404, { error: 'No such event.' })
    if (!isGm(req)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    if (m === 'PUT') { // edit
      const body = await readBody(req).catch(() => null)
      const name = cleanLine(body?.name, 60)
      const planets = parsePlanets(body?.planets, ev.planets)
      if (!name) return json(res, 400, { error: 'Give the event a name.' })
      if (!validDate(body?.date)) return json(res, 400, { error: 'Pick a date.' })
      if (!planets) return json(res, 400, { error: 'Those planets are not valid.' })
      Object.assign(ev, { name, date: body.date, notes: cleanNotes(body?.notes), planets })
      calendarChanged()
      return json(res, 200, { events: calendarView() })
    }
    if (m === 'DELETE') {
      calendar = calendar.filter((e) => e !== ev)
      calendarChanged()
      return json(res, 200, { events: calendarView() })
    }
    return null
  }

  const signup = /^\/api\/calendar\/([a-f0-9]{12})\/signup(?:\/([a-f0-9]{16}))?$/.exec(path)
  if (signup) {
    const ev = calendar.find((e) => e.id === signup[1])
    if (!ev) return json(res, 404, { error: 'No such event.' })
    const who = askedBy(req)
    if (signup[2]) { // gamemaster: remove someone from the sign-ups
      if (m !== 'DELETE') return null
      if (!who.gm) return json(res, 401, { error: 'Not signed in as gamemaster.' })
      for (const pl of ev.planets) pl.signups = pl.signups.filter((id) => id !== signup[2])
      calendarChanged()
      return json(res, 200, { events: calendarView() })
    }
    if (m === 'POST') { // sign up for a planet (one per event: signing up elsewhere moves you). The gamemaster can sign up any player.
      const body = await readBody(req).catch(() => null)
      const forOther = who.gm && typeof body?.profileId === 'string'
      const profileId = forOther ? body.profileId : who.profile?.id
      if (!profileId) return json(res, 401, { error: 'Sign in with a profile to sign up.' })
      if (forOther && !profiles[profileId]) return json(res, 400, { error: 'No such player.' })
      const target = ev.planets.find((pl) => pl.planetId === body?.planetId)
      if (!target) return json(res, 400, { error: 'That planet is not part of this event.' })
      for (const pl of ev.planets) pl.signups = pl.signups.filter((id) => id !== profileId)
      target.signups.push(profileId)
      calendarChanged()
      return json(res, 200, { events: calendarView() })
    }
    if (m === 'DELETE') { // leave, any time
      if (!who.profile) return json(res, 401, { error: 'Sign in with a profile to sign up.' })
      for (const pl of ev.planets) pl.signups = pl.signups.filter((id) => id !== who.profile.id)
      calendarChanged()
      return json(res, 200, { events: calendarView() })
    }
    return null
  }
  return null
}

// ---- save and load a whole event ----------------------------------------------------------------------------------
// The gamemaster can download everything about the event as one file and load it back (on this server or another): the setup (planets
// shown or hidden, battlezone counts, locks, hulks, every information text and mission), the battlezones (who sits where, what is in
// play, who won) and the calendar with its sign-ups. Players' accounts and army lists are NOT in the file: they belong to the players.
// Seats and sign-ups carry the player's name, so on loading they are joined back to the same player (by id, else by name); those with
// no matching player on this server are left out and counted in the report. Seats of battlezones in play keep the frozen list they
// were playing with.
const SAVE_FORMAT = 'galaxy-campaign-event'
const SAVE_VERSION = 1
const MAX_SAVE_BODY = 8_000_000

function exportEvent() {
  const battlezones = {}
  for (const [id, t] of Object.entries(claims)) {
    battlezones[id] = {
      status: t.status, winner: t.winner ?? null, wonAt: t.wonAt ?? 0,
      seats: t.seats.map((x) => ({ profileId: x.profileId, name: profiles[x.profileId]?.name ?? '', team: x.team, armyId: x.armyId, claimedAt: x.claimedAt, ...(x.snapshot ? { snapshot: x.snapshot } : {}) })),
    }
  }
  const events = calendar.map((e) => ({
    id: e.id, name: e.name, date: e.date, notes: e.notes,
    planets: e.planets.map((pl) => ({ planetId: pl.planetId, target: pl.target, players: pl.signups.map((id) => ({ profileId: id, name: profiles[id]?.name ?? '' })) })),
  }))
  return { format: SAVE_FORMAT, version: SAVE_VERSION, exportedAt: new Date().toISOString(), setup: state, battlezones, calendar: events }
}

/** The player a saved seat or sign-up belongs to on this server: the same id, else the same name, else nobody. */
function relink(saved) {
  if (!isObj(saved)) return null
  if (typeof saved.profileId === 'string' && profiles[saved.profileId]) return saved.profileId
  const key = cleanName(saved.name).toLowerCase()
  return key ? Object.values(profiles).find((p) => p.key === key)?.id ?? null : null
}

/** Loads (some parts of) a save. Throws an Error with a message for the gamemaster when the file is not usable; changes nothing then. */
function importEvent(save, parts) {
  if (!isObj(save) || save.format !== SAVE_FORMAT) throw new Error('That is not a Galaxy Campaign event save.')
  if (!Number.isInteger(save.version) || save.version < 1 || save.version > SAVE_VERSION) throw new Error('That save was made by a newer version of the app. Update the app first.')
  const want = { setup: !!parts?.setup, battlezones: !!parts?.battlezones, calendar: !!parts?.calendar }
  if (!want.setup && !want.battlezones && !want.calendar) throw new Error('Choose what to load.')
  const report = { setup: false, battlezones: 0, seatsKept: 0, seatsDropped: 0, events: 0, signupsKept: 0, signupsDropped: 0 }

  // everything is built and checked first, and only then put in place, so a bad file changes nothing
  let nextState = state
  if (want.setup) {
    if (save.setup !== null && !validState(save.setup)) throw new Error('The setup in that save is damaged.')
    nextState = save.setup
    report.setup = true
  }

  let nextClaims = claims
  if (want.battlezones) {
    if (!isObj(save.battlezones)) throw new Error('The battlezones in that save are damaged.')
    nextClaims = keyed()
    for (const [id, t] of Object.entries(save.battlezones)) {
      if (!/^[a-z0-9-]{1,80}$/.test(id) || !isObj(t) || !Array.isArray(t.seats)) continue
      if (Object.keys(nextClaims).length >= 2000) break
      const seen = new Set()
      const seats = []
      for (const x of t.seats) {
        const profileId = relink(x)
        if (!profileId || seen.has(profileId) || (x.team !== 'A' && x.team !== 'B') || typeof x.armyId !== 'string' || x.armyId.length > 40) { report.seatsDropped++; continue }
        seen.add(profileId)
        seats.push({ profileId, team: x.team, armyId: x.armyId, claimedAt: Number.isFinite(x.claimedAt) ? x.claimedAt : Date.now(), ...(validArmy(x.snapshot) ? { snapshot: x.snapshot } : {}) })
        report.seatsKept++
      }
      const winner = t.winner === 'A' || t.winner === 'B' ? t.winner : null
      const status = t.status === 'in_play' ? 'in_play' : 'open'
      if (!seats.length && !winner && status === 'open') continue // an empty open battlezone is the same as none
      nextClaims[id] = { status, seats, ...(winner ? { winner, wonAt: Number.isFinite(t.wonAt) ? t.wonAt : 0 } : {}) }
      report.battlezones++
    }
  }

  let nextCalendar = calendar
  if (want.calendar) {
    if (!Array.isArray(save.calendar)) throw new Error('The calendar in that save is damaged.')
    nextCalendar = []
    const ids = new Set()
    for (const e of save.calendar) {
      if (!isObj(e) || nextCalendar.length >= MAX_EVENTS) continue
      const name = cleanLine(e.name, 60)
      const planets = parsePlanets((Array.isArray(e.planets) ? e.planets : []).map((pl) => ({ planetId: pl?.planetId, target: pl?.target })))
      if (!name || !validDate(e.date) || !planets) continue
      const id = typeof e.id === 'string' && /^[a-f0-9]{12}$/.test(e.id) && !ids.has(e.id) ? e.id : randomBytes(6).toString('hex')
      ids.add(id)
      for (const pl of planets) {
        const saved = (Array.isArray(e.planets) ? e.planets : []).find((x) => x?.planetId === pl.planetId)
        for (const who of Array.isArray(saved?.players) ? saved.players : []) {
          const profileId = relink(who)
          // one planet per player in an event
          if (!profileId || planets.some((o) => o.signups.includes(profileId))) { report.signupsDropped++; continue }
          pl.signups.push(profileId)
          report.signupsKept++
        }
      }
      nextCalendar.push({ id, name, date: e.date, notes: cleanNotes(e.notes), planets })
      report.events++
    }
  }

  // put it all in place, in one transaction
  store.transaction(() => {
    if (want.setup) { state = nextState; persist() }
    if (want.battlezones) { claims = nextClaims; persistClaims() }
    if (want.calendar) calendar = nextCalendar
    calendarChanged() // saves the calendar, and tells every screen that something changed
  })
  return report
}

// ---- media: pictures the gamemaster uploads (battlezone layouts) ----------------------------------------------------
// Kept as files in DATA_DIR/media, so in the same Docker volume as the database. Each is named by a hash of its content: the same
// picture uploaded twice is stored once, a name cannot be guessed, and a name never changes what it shows (so browsers may cache it
// for good). Only PNG, JPEG, WebP and GIF are taken, recognised by their first bytes rather than by what the browser claims; no SVG,
// which can carry script. They are public at /media/<name> to anyone who has the address, like the rest of the event.
const MEDIA_DIR = join(DATA_DIR, 'media')
mkdirSync(MEDIA_DIR, { recursive: true })
const MAX_UPLOAD = 15_000_000
const MAX_MEDIA = 2000
const MEDIA_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
const MEDIA_NAME = /^\/media\/([0-9a-f]{32}\.(?:png|jpg|webp|gif))$/

/** The kind of picture in buf, from its first bytes, or null when it is not one we take. */
function pictureType(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'gif'
  return null
}

async function mediaApi(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' })
  if (!isGm(req)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
  const buf = await readRaw(req, MAX_UPLOAD).catch(() => null)
  if (!buf) return json(res, 413, { error: 'That picture is too large (15 MB at most).' })
  const ext = pictureType(buf)
  if (!ext) return json(res, 415, { error: 'Upload a PNG, JPEG, WebP or GIF picture.' })
  const name = `${createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${ext}`
  const file = join(MEDIA_DIR, name)
  if (!existsSync(file)) {
    if (readdirSync(MEDIA_DIR).length >= MAX_MEDIA) return json(res, 507, { error: 'There are too many pictures stored.' })
    writeFileSync(file + '.tmp', buf)
    renameSync(file + '.tmp', file)
  }
  return json(res, 201, { url: `/media/${name}` })
}

async function serveMedia(req, res, path) {
  const m = MEDIA_NAME.exec(path)
  const file = m && join(MEDIA_DIR, m[1])
  if (!file || !existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('Not found.') }
  res.writeHead(200, {
    'Content-Type': MEDIA_TYPES[extname(file).slice(1)],
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  })
  res.end(req.method === 'HEAD' ? undefined : await readFile(file))
}

// ---- live updates (server-sent events) ---------------------------------------------------------------------------
// Every connection opens with `hello` naming the build of the app being served (dist/version.txt), so a page from an older build
// can update itself after a deploy. When the server is told to stop, open pages get `shutdown` first (see the end of this file).
const streams = new Set()
const BUILD = (() => { try { return readFileSync(join(DIST_DIR, 'version.txt'), 'utf8').trim() } catch { return '' } })()
const broadcast = () => { for (const res of streams) res.write(`data: ${version}\n\n`) }
setInterval(() => { for (const res of streams) res.write(': ping\n\n') }, 25_000).unref()

// ---- http ------------------------------------------------------------------------------------------------------
const json = (res, status, body) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(text)
}

const readRaw = (req, limit) => new Promise((ok, fail) => {
  let size = 0
  const chunks = []
  req.on('data', (c) => {
    size += c.length
    if (size > limit) { fail(new Error('too large')); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', () => ok(Buffer.concat(chunks)))
  req.on('error', fail)
})
const readBody = async (req, limit = MAX_BODY) => JSON.parse((await readRaw(req, limit)).toString('utf8') || 'null')

const gmFails = new Map()
setInterval(() => gmFails.clear(), 60_000).unref()

async function api(req, res, path) {
  if (path === '/api/gm-login' && req.method === 'POST') {
    if ((gmFails.get(who(req)) ?? 0) >= 10) return json(res, 429, { error: 'Too many attempts, wait a minute.' })
    const body = await readBody(req).catch(() => null)
    if (isObj(body) && typeof body.password === 'string' && safeEq(body.password, GM_PASSWORD)) return json(res, 200, { token: GM_TOKEN })
    gmFails.set(who(req), (gmFails.get(who(req)) ?? 0) + 1)
    return json(res, 401, { error: 'Wrong password.' })
  }

  if (path === '/api/state' && req.method === 'GET') {
    const t = bearer(req)
    if (t !== null && !safeEq(t, GM_TOKEN)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    return json(res, 200, { version, epoch: EPOCH, state: t === null ? forPlayers(state) : state })
  }

  if (path === '/api/state' && req.method === 'PUT') {
    const t = bearer(req)
    if (t === null || !safeEq(t, GM_TOKEN)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    const body = await readBody(req).catch(() => null)
    if (isObj(body) && body.patch !== undefined) {
      // a gamemaster's changes (see statePatch.mjs), laid on whatever the setup is now, so several gamemasters do not wipe out each other
      if (!validOps(body.patch)) return json(res, 400, { error: 'Bad changes.' })
      const next = applyOps(state, body.patch)
      if (isObj(next.teams)) next.teams = cleanTeams(next.teams) // a change to one part of a team (its name) must leave a complete team
      if (!validState(next)) return json(res, 400, { error: 'Bad state.' })
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        state = next
        version++
        persist()
        broadcast()
      }
      return json(res, 200, { version, epoch: EPOCH, state })
    }
    if (!isObj(body) || !validState(body.state)) return json(res, 400, { error: 'Bad state.' })
    state = body.state
    version++
    persist()
    broadcast()
    return json(res, 200, { version, epoch: EPOCH, state })
  }

  if (path === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(`retry: 3000\nevent: hello\ndata: ${BUILD}\n\ndata: ${version}\n\n`)
    streams.add(res)
    req.on('close', () => streams.delete(res))
    return
  }

  if (path === '/api/claims' || path.startsWith('/api/claims/')) {
    const r = await claimsApi(req, res, path)
    if (r !== null) return r
    return json(res, 405, { error: 'Method not allowed.' })
  }

  if (path === '/api/calendar' || path.startsWith('/api/calendar/')) {
    const r = await calendarApi(req, res, path)
    if (r !== null) return r
    return json(res, 405, { error: 'Method not allowed.' })
  }

  if (path === '/api/event-save') { // gamemaster: download or load the whole event
    if (!isGm(req)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    if (req.method === 'GET') return json(res, 200, exportEvent())
    if (req.method === 'POST') {
      const body = await readBody(req, MAX_SAVE_BODY).catch(() => null)
      if (!isObj(body)) return json(res, 400, { error: 'That file could not be read (is it too large?).' })
      try { return json(res, 200, { report: importEvent(body.save, body.parts) }) } catch (e) { return json(res, 400, { error: e instanceof Error ? e.message : 'That save could not be loaded.' }) }
    }
    return json(res, 405, { error: 'Method not allowed.' })
  }

  if (path === '/api/media') return mediaApi(req, res)

  if (path === '/api/profiles' || path === '/api/profile' || path === '/api/profile-login' || path.startsWith('/api/profiles/')) {
    const r = await profilesApi(req, res, path)
    if (r !== null) return r
    return json(res, 405, { error: 'Method not allowed.' })
  }

  json(res, 404, { error: 'Not found.' })
}

// ---- static files ----------------------------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.map'])
const gzCache = new Map()

async function serveStatic(req, res, path) {
  let decoded
  try { decoded = decodeURIComponent(path) } catch { res.writeHead(400); return res.end() }
  let file = normalize(join(DIST_DIR, decoded))
  if (file !== DIST_DIR && !file.startsWith(DIST_DIR + sep)) { res.writeHead(403); return res.end() }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // a missing file (a rules .json, an old asset) is a 404: answering with index.html makes the page fail to read it as JSON or code
    if (extname(decoded)) { res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('Not found.') }
    file = join(DIST_DIR, 'index.html') // single-page app
  }
  const ext = extname(file)
  const rel = file.slice(DIST_DIR.length + 1).replaceAll('\\', '/')
  const headers = { 'Content-Type': MIME[ext] ?? 'application/octet-stream' }
  // hashed build assets never change; everything else (index.html, the service worker) must be re-checked every time
  headers['Cache-Control'] = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
  let body = await readFile(file)
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    const key = `${file}:${statSync(file).mtimeMs}`
    if (!gzCache.has(key)) gzCache.set(key, gzipSync(body))
    body = gzCache.get(key)
    headers['Content-Encoding'] = 'gzip'
    headers.Vary = 'Accept-Encoding'
  }
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : body)
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (path.startsWith('/api/')) return await api(req, res, path)
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end() }
    if (path.startsWith('/media/')) return await serveMedia(req, res, path)
    if (!existsSync(join(DIST_DIR, 'index.html'))) { res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('Run "npm run build" first.') }
    await serveStatic(req, res, path)
  } catch (e) {
    console.error(e)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  }
})

server.listen(PORT, HOST, () => console.log(`Galaxy Campaign on http://${HOST}:${PORT}  (data: ${join(DATA_DIR, 'campaign.db')})`))

// Ctrl+C, `docker compose down` or a deploy: tell open pages the server is restarting (they retry every second until it is back),
// stop taking requests, and close the database cleanly
let stopping = false
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  if (stopping) return
  stopping = true
  for (const res of streams) res.end('event: shutdown\nretry: 1000\ndata: Server restarting\n\n')
  server.close()
  setTimeout(() => { store.close(); process.exit(0) }, 300) // a moment for the goodbyes and requests in flight
})
