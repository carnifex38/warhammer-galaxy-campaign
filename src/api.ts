// Talks to the live-event server (server/index.mjs). Everything is same-origin under /api.

/** What the gamemaster edits and players read: the same four pieces useEventConfig keeps. */
export interface ServerState {
  config: unknown
  hulks: unknown
  info: unknown
  locked: unknown
}

/** The request was refused because the gamemaster login is missing or no longer valid. */
export class Unauthorized extends Error {}

/** Returns the gamemaster token, or null when the password is wrong. Throws when the server cannot be reached. */
export async function gmLogin(password: string): Promise<string | null> {
  const r = await fetch('/api/gm-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
  if (r.status === 401) return null
  if (!r.ok) throw new Error(`login failed (${r.status})`)
  return ((await r.json()) as { token: string }).token
}

// ---- player profiles (a name and a password chosen by the player; they hold the army lists) ----

/** One army list. The full army builder will fill this out later; for now it is a name, an era and notes. */
export interface Army { id: string; name: string; era: '40k' | '30k'; notes: string; /** the list built in the army builder, when there is one (see src/builder) */ roster?: unknown }
export interface ProfileSummary { id: string; name: string; created: number; updated: number; armyCount: number }
export interface Profile extends ProfileSummary { armies: Army[] }

/** The server said no, with a reason that can be shown to the player (wrong password, name taken...). */
export class ProfileError extends Error {}

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` })
const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function profileCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try { r = await fetch(path, { cache: 'no-store', ...init }) } catch { throw new Error('Cannot reach the server.') }
  if (r.status === 401 && path !== '/api/profile-login') throw new Unauthorized()
  if (!r.ok) {
    const msg = ((await r.json().catch(() => null)) as { error?: string } | null)?.error
    throw new ProfileError(msg ?? `The server refused that (${r.status}).`)
  }
  return (await r.json()) as T
}

export interface ProfileLogin { token: string; profile: Profile }

export const createProfile = (name: string, password: string) =>
  profileCall<ProfileLogin>('/api/profiles', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name, password }) })
export const loginProfile = (name: string, password: string) =>
  profileCall<ProfileLogin>('/api/profile-login', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name, password }) })

/** A player's own profile. */
export const getMyProfile = (token: string) => profileCall<{ profile: Profile }>('/api/profile', { headers: authHeader(token) }).then((r) => r.profile)
export const saveMyProfile = (token: string, armies: Army[]) =>
  profileCall<{ profile: Profile }>('/api/profile', { method: 'PUT', headers: { ...JSON_HEADERS, ...authHeader(token) }, body: JSON.stringify({ armies }) }).then((r) => r.profile)
export const deleteMyProfile = (token: string) => profileCall<unknown>('/api/profile', { method: 'DELETE', headers: authHeader(token) })

/** The gamemaster: every profile. */
export const listProfiles = (gmToken: string) => profileCall<{ profiles: ProfileSummary[] }>('/api/profiles', { headers: authHeader(gmToken) }).then((r) => r.profiles)
export const getProfile = (gmToken: string, id: string) => profileCall<{ profile: Profile }>(`/api/profiles/${id}`, { headers: authHeader(gmToken) }).then((r) => r.profile)
export const saveProfile = (gmToken: string, id: string, armies: Army[]) =>
  profileCall<{ profile: Profile }>(`/api/profiles/${id}`, { method: 'PUT', headers: { ...JSON_HEADERS, ...authHeader(gmToken) }, body: JSON.stringify({ armies }) }).then((r) => r.profile)
/** The gamemaster adds a practice player (password "dummy") with sample army lists. */
export const createDummyProfile = (gmToken: string) => profileCall<{ profile: Profile }>('/api/profiles/dummy', { method: 'POST', headers: authHeader(gmToken) }).then((r) => r.profile)
export const deleteProfile = (gmToken: string, id: string) => profileCall<unknown>(`/api/profiles/${id}`, { method: 'DELETE', headers: authHeader(gmToken) })

/** The event state: everything for the gamemaster (with a token), only what players may see otherwise. null = nothing saved yet. */
export async function getState(token?: string): Promise<ServerState | null> {
  const r = await fetch('/api/state', { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' })
  if (r.status === 401) throw new Unauthorized()
  if (!r.ok) throw new Error(`state failed (${r.status})`)
  return ((await r.json()) as { state: ServerState | null }).state
}

export async function putState(token: string, state: ServerState): Promise<void> {
  const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ state }) })
  if (r.status === 401) throw new Unauthorized()
  if (!r.ok) throw new Error(`save failed (${r.status})`)
}

// One live connection to the server is shared by everything on the page that listens (the event setup, the battlezone claims and
// the calendar all do): a browser only allows a few connections to one address at a time, and each tab used to take three.
const watchers = new Set<() => void>()
let stream: EventSource | null = null
let streamOpen = false
let streamTimer: number | undefined
let streamFailures = 0

function connectStream() {
  if (stream || watchers.size === 0) return
  stream = new EventSource('/api/stream')
  stream.onmessage = () => { streamOpen = true; streamFailures = 0; for (const w of [...watchers]) w() } // the first message arrives on every (re)connect, so this also covers catching up after a drop
  stream.onerror = () => {
    stream?.close()
    stream = null
    streamOpen = false
    streamFailures++
    streamTimer = window.setTimeout(connectStream, Math.min(60000, 1000 * 2 ** streamFailures))
  }
}

/**
 * Calls onChange when the server connects and whenever anything changes on it (the gamemaster saves, a seat is taken, an event is
 * scheduled...). Returns a function that stops listening. If the server cannot be reached it backs off (2s, 4s, 8s ... up to a
 * minute) instead of retrying every few seconds for ever, so a copy of the site with no server behind it stays quiet.
 */
export function watchState(onChange: () => void): () => void {
  watchers.add(onChange)
  if (streamOpen) queueMicrotask(() => { if (watchers.has(onChange)) onChange() }) // joined a connection that is already up: it will not announce itself again
  connectStream()
  return () => {
    watchers.delete(onChange)
    if (watchers.size === 0) {
      stream?.close()
      stream = null
      streamOpen = false
      streamFailures = 0
      window.clearTimeout(streamTimer)
    }
  }
}
