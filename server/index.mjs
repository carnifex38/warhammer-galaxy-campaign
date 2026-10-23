// Live-event server: serves the built app (dist/) and keeps the event state that the gamemaster edits and players read.
// No dependencies, Node 20+. Configure with environment variables:
//   GM_PASSWORD  required. The gamemaster password (checked here, never sent to browsers).
//   PORT         default 3000
//   HOST         default 0.0.0.0
//   DATA_DIR     default ./data   (state.json, profiles.json, claims.json and calendar.json live here)
//   DIST_DIR     default ./dist
import { createServer } from 'node:http'
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { extname, join, normalize, resolve, sep } from 'node:path'

const GM_PASSWORD = process.env.GM_PASSWORD
if (!GM_PASSWORD) {
  console.error('Set GM_PASSWORD before starting, e.g.  GM_PASSWORD="something" node server/index.mjs')
  process.exit(1)
}
const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'
const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data')
const DIST_DIR = resolve(process.env.DIST_DIR ?? 'dist')
const STATE_FILE = join(DATA_DIR, 'state.json')
const PROFILES_FILE = join(DATA_DIR, 'profiles.json')
const MAX_BODY = 1_000_000

mkdirSync(DATA_DIR, { recursive: true })

// ---- state -----------------------------------------------------------------------------------------------------
// { config, hulks, info, locked } exactly as the client's useEventConfig keeps it, or null before the gamemaster saves.
let state = null
let version = 0
try { if (existsSync(STATE_FILE)) state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch (e) { console.error('Could not read state.json, starting empty:', e.message) }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const validState = (s) => isObj(s) && isObj(s.config) && isObj(s.hulks) && isObj(s.info) && Array.isArray(s.locked)

function persist() {
  const tmp = STATE_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(state))
  renameSync(tmp, STATE_FILE)
}

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
let profiles = {}
try { if (existsSync(PROFILES_FILE)) profiles = JSON.parse(readFileSync(PROFILES_FILE, 'utf8')) } catch (e) { console.error('Could not read profiles.json, starting empty:', e.message) }

function persistProfiles() {
  const tmp = PROFILES_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(profiles))
  renameSync(tmp, PROFILES_FILE)
}

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
const validArmies = (a) => Array.isArray(a) && a.length <= 60 && a.every((x) => isObj(x) && typeof x.id === 'string' && typeof x.name === 'string') && JSON.stringify(a).length <= MAX_ARMIES_BYTES

// slow down guessing: at most 10 failed attempts a minute from one address
const profileFails = new Map()
setInterval(() => profileFails.clear(), 60_000).unref()
const who = (req) => req.socket.remoteAddress ?? '?'
const tooMany = (req) => (profileFails.get(who(req)) ?? 0) >= 10
const failed = (req) => profileFails.set(who(req), (profileFails.get(who(req)) ?? 0) + 1)

/** Handles the profile routes. Returns null when the method does not fit the route. */
async function profilesApi(req, res, path) {
  const m = req.method

  if (path === '/api/profiles' && m === 'POST') {
    if (tooMany(req)) return json(res, 429, { error: 'Too many attempts, wait a minute.' })
    const body = await readBody(req).catch(() => null)
    const name = cleanName(body?.name)
    if (!validName(name)) return json(res, 400, { error: 'The name must be 2 to 24 characters.' })
    if (!validPassword(body?.password)) return json(res, 400, { error: 'The password must be 4 to 64 characters.' })
    if (Object.values(profiles).some((p) => p.key === name.toLowerCase())) return json(res, 409, { error: 'That name is taken. Choose another.' })
    if (Object.keys(profiles).length >= MAX_PROFILES) return json(res, 507, { error: 'There are too many profiles.' })
    const salt = randomBytes(16).toString('hex')
    const id = randomBytes(8).toString('hex')
    const now = Date.now()
    const p = { id, name, key: name.toLowerCase(), salt, hash: await hashPassword(body.password, salt), created: now, updated: now, armies: [] }
    profiles[id] = p
    persistProfiles()
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
      persistProfiles()
      return json(res, 200, { profile: full(p) })
    }
    if (m === 'DELETE') {
      delete profiles[p.id]
      dropSeatsOf(p.id)
      persistProfiles()
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
    persistProfiles()
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
      persistProfiles()
      return json(res, 200, { profile: full(p) })
    }
    if (m === 'DELETE') {
      delete profiles[p.id]
      dropSeatsOf(p.id)
      persistProfiles()
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
const CLAIMS_FILE = join(DATA_DIR, 'claims.json')
/** tableId -> { status: 'open' | 'in_play', seats: [{ profileId, team, armyId, claimedAt, snapshot? }] } */
let claims = {}
try { if (existsSync(CLAIMS_FILE)) claims = JSON.parse(readFileSync(CLAIMS_FILE, 'utf8')) } catch (e) { console.error('Could not read claims.json, starting empty:', e.message) }

function persistClaims() {
  const tmp = CLAIMS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(claims))
  renameSync(tmp, CLAIMS_FILE)
}
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
    armyName: army?.name || 'Untitled army', era: army?.era ?? '40k', pts: army?.roster?.pts, locked: !!seat.snapshot, missing: !army,
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
      const t = claims[tableId] ?? (claims[tableId] = { status: 'open', seats: [] })
      if (t.status !== 'open') return json(res, 409, { error: 'This battlezone is already in play.' })
      if (Object.keys(claims).length > 2000) return json(res, 507, { error: 'Too many battlezones.' })
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
const CALENDAR_FILE = join(DATA_DIR, 'calendar.json')
/** [{ id, name, date: 'YYYY-MM-DD', notes, planets: [{ planetId, target, signups: [profileId] }] }] */
let calendar = []
try { if (existsSync(CALENDAR_FILE)) calendar = JSON.parse(readFileSync(CALENDAR_FILE, 'utf8')) } catch (e) { console.error('Could not read calendar.json, starting empty:', e.message) }

const MAX_EVENTS = 500
const MAX_PLANETS_PER_EVENT = 24
const calendarChanged = () => {
  const tmp = CALENDAR_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(calendar))
  renameSync(tmp, CALENDAR_FILE)
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
    if (!who.profile) return json(res, 401, { error: 'Sign in with a profile to sign up.' })
    if (m === 'POST') { // sign up for a planet (one per event: signing up elsewhere moves you)
      const body = await readBody(req).catch(() => null)
      const target = ev.planets.find((pl) => pl.planetId === body?.planetId)
      if (!target) return json(res, 400, { error: 'That planet is not part of this event.' })
      for (const pl of ev.planets) pl.signups = pl.signups.filter((id) => id !== who.profile.id)
      target.signups.push(who.profile.id)
      calendarChanged()
      return json(res, 200, { events: calendarView() })
    }
    if (m === 'DELETE') { // leave, any time
      for (const pl of ev.planets) pl.signups = pl.signups.filter((id) => id !== who.profile.id)
      calendarChanged()
      return json(res, 200, { events: calendarView() })
    }
    return null
  }
  return null
}

// ---- live updates (server-sent events) ---------------------------------------------------------------------------
const streams = new Set()
const broadcast = () => { for (const res of streams) res.write(`data: ${version}\n\n`) }
setInterval(() => { for (const res of streams) res.write(': ping\n\n') }, 25_000).unref()

// ---- http ------------------------------------------------------------------------------------------------------
const json = (res, status, body) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(text)
}

const readBody = (req) => new Promise((ok, fail) => {
  let size = 0
  const chunks = []
  req.on('data', (c) => {
    size += c.length
    if (size > MAX_BODY) { fail(new Error('too large')); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')) } catch (e) { fail(e) } })
  req.on('error', fail)
})

let failedLogins = 0
setInterval(() => { failedLogins = 0 }, 60_000).unref()

async function api(req, res, path) {
  if (path === '/api/gm-login' && req.method === 'POST') {
    if (failedLogins >= 10) return json(res, 429, { error: 'Too many attempts, wait a minute.' })
    const body = await readBody(req).catch(() => null)
    if (isObj(body) && typeof body.password === 'string' && safeEq(body.password, GM_PASSWORD)) return json(res, 200, { token: GM_TOKEN })
    failedLogins++
    return json(res, 401, { error: 'Wrong password.' })
  }

  if (path === '/api/state' && req.method === 'GET') {
    const t = bearer(req)
    if (t !== null && !safeEq(t, GM_TOKEN)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    return json(res, 200, { version, state: t === null ? forPlayers(state) : state })
  }

  if (path === '/api/state' && req.method === 'PUT') {
    const t = bearer(req)
    if (t === null || !safeEq(t, GM_TOKEN)) return json(res, 401, { error: 'Not signed in as gamemaster.' })
    const body = await readBody(req).catch(() => null)
    if (!isObj(body) || !validState(body.state)) return json(res, 400, { error: 'Bad state.' })
    state = body.state
    version++
    persist()
    broadcast()
    return json(res, 200, { version })
  }

  if (path === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(`retry: 3000\ndata: ${version}\n\n`)
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
  let file = normalize(join(DIST_DIR, decodeURIComponent(path)))
  if (file !== DIST_DIR && !file.startsWith(DIST_DIR + sep)) { res.writeHead(403); return res.end() }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST_DIR, 'index.html') // single-page app
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
    if (!existsSync(join(DIST_DIR, 'index.html'))) { res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('Run "npm run build" first.') }
    await serveStatic(req, res, path)
  } catch (e) {
    console.error(e)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  }
})

server.listen(PORT, HOST, () => console.log(`Galaxy Campaign on http://${HOST}:${PORT}  (data: ${DATA_DIR})`))
