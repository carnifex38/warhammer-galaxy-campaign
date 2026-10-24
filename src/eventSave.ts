// Saving and loading a whole event as one file: the setup (planets shown or hidden, battlezone counts, locks, hulks, every information
// text and mission), the battlezones (who sits where, what is in play, who won) and the calendar with its sign-ups. Players' accounts
// and army lists are not in it. The server does the work (see "save and load a whole event" in server/index.mjs). The developer
// gamemaster, who has no server, saves and loads the practice data kept in this browser instead.

export const SAVE_FORMAT = 'galaxy-campaign-event'

export interface EventSave {
  format: typeof SAVE_FORMAT
  version: number
  exportedAt: string
  /** the event's setup, or null when nothing had been set up */
  setup: { config: Record<string, unknown>; hulks: Record<string, unknown>; info: Record<string, unknown>; locked: unknown[] } | null
  battlezones: Record<string, { status: string; winner: string | null; seats: unknown[] }>
  calendar: { name: string; date: string; planets: { players?: unknown[] }[] }[]
}

/** Which parts of a save to load. */
export interface SaveParts { setup: boolean; battlezones: boolean; calendar: boolean }

/** What loading did: what came in, and how many players could not be matched on this server and were left out. */
export interface SaveReport { setup: boolean; battlezones: number; seatsKept: number; seatsDropped: number; events: number; signupsKept: number; signupsDropped: number }

/** What a save holds, in numbers, for the gamemaster to check before loading it. */
export interface SaveSummary {
  savedAt: string
  hasSetup: boolean
  planetsSet: number
  texts: number
  locks: number
  hulks: number
  zones: number
  results: number
  seats: number
  events: number
  signups: number
}

export function summarize(save: EventSave): SaveSummary {
  const setup = save.setup
  const zones = Object.values(save.battlezones)
  return {
    savedAt: save.exportedAt,
    hasSetup: !!setup,
    planetsSet: setup ? Object.keys(setup.config).length : 0,
    texts: setup ? Object.keys(setup.info).length : 0,
    locks: setup ? setup.locked.length : 0,
    hulks: setup ? Object.values(setup.hulks).reduce<number>((n, v) => n + (typeof v === 'number' ? v : 0), 0) : 0,
    zones: zones.length,
    results: zones.filter((z) => z.winner).length,
    seats: zones.reduce((n, z) => n + z.seats.length, 0),
    events: save.calendar.length,
    signups: save.calendar.reduce((n, e) => n + e.planets.reduce((m, p) => m + (p.players?.length ?? 0), 0), 0),
  }
}

/** Reads a file the gamemaster chose. Throws an Error with a message to show when it is not a save. */
export async function readSaveFile(file: File): Promise<EventSave> {
  if (file.size > 8_000_000) throw new Error('That file is too big to be an event save.')
  let data: unknown
  try { data = JSON.parse(await file.text()) } catch { throw new Error('That file is not an event save (it could not be read).') }
  const s = data as Partial<EventSave> | null
  if (!s || s.format !== SAVE_FORMAT) throw new Error('That file is not a Galaxy Campaign event save.')
  if (!Number.isInteger(s.version) || (s.version as number) < 1) throw new Error('That save has no version number.')
  if (s.setup !== null && (typeof s.setup !== 'object' || !s.setup)) throw new Error('The setup in that save is damaged.')
  if (!s.battlezones || typeof s.battlezones !== 'object' || !Array.isArray(s.calendar)) throw new Error('That save is damaged.')
  return s as EventSave
}

/** The file name for a download: the date it was made. */
export const saveFileName = () => `galaxy-event-${new Date().toISOString().slice(0, 10)}.json`

/** Gives the browser a file to save. */
export function downloadSave(save: EventSave) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(save, null, 1)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = saveFileName()
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try { r = await fetch(path, { cache: 'no-store', ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` } }) } catch { throw new Error('Cannot reach the server.') }
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `The server refused that (${r.status}).`)
  return (await r.json()) as T
}

// ---- the practice data of the developer gamemaster (DEV-TOOLS) ----

const LOCAL = { config: 'galaxy-event-config', hulks: 'galaxy-hulks', info: 'galaxy-info', locked: 'galaxy-locked', claims: 'galaxy-dev-claims', calendar: 'galaxy-dev-calendar' }
const readLocal = <T,>(key: string, empty: T): T => { try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? empty } catch { return empty } }
const writeLocal = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { throw new Error('This browser has no room to keep that.') } }

function exportLocal(): EventSave {
  return {
    format: SAVE_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    setup: { config: readLocal(LOCAL.config, {}), hulks: readLocal(LOCAL.hulks, {}), info: readLocal(LOCAL.info, {}), locked: readLocal(LOCAL.locked, []) },
    battlezones: readLocal(LOCAL.claims, {}),
    calendar: readLocal(LOCAL.calendar, []),
  }
}

function importLocal(save: EventSave, parts: SaveParts): SaveReport {
  if (parts.setup) {
    writeLocal(LOCAL.config, save.setup?.config ?? {})
    writeLocal(LOCAL.hulks, save.setup?.hulks ?? {})
    writeLocal(LOCAL.info, save.setup?.info ?? {})
    writeLocal(LOCAL.locked, save.setup?.locked ?? [])
  }
  if (parts.battlezones) writeLocal(LOCAL.claims, save.battlezones)
  if (parts.calendar) writeLocal(LOCAL.calendar, save.calendar)
  const s = summarize(save)
  return { setup: parts.setup, battlezones: parts.battlezones ? s.zones : 0, seatsKept: parts.battlezones ? s.seats : 0, seatsDropped: 0, events: parts.calendar ? s.events : 0, signupsKept: parts.calendar ? s.signups : 0, signupsDropped: 0 }
}

// ---- what the screen uses ----

/** The whole event as a save. `token`: the gamemaster's server token; none (the developer gamemaster) uses the practice data in this browser. */
export async function fetchSave(token: string | undefined): Promise<EventSave> {
  return token ? call<EventSave>('/api/event-save', token) : exportLocal()
}

/** Loads the chosen parts of a save into the event. */
export async function loadSave(token: string | undefined, save: EventSave, parts: SaveParts): Promise<SaveReport> {
  if (!token) return importLocal(save, parts)
  return (await call<{ report: SaveReport }>('/api/event-save', token, { method: 'POST', body: JSON.stringify({ save, parts }) })).report
}
