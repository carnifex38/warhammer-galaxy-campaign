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

/**
 * Calls onChange when the server connects and whenever the gamemaster saves. Returns a function that stops listening.
 * If the server cannot be reached it backs off (2s, 4s, 8s ... up to a minute) instead of retrying every few seconds
 * for ever, so a copy of the site with no server behind it stays quiet.
 */
export function watchState(onChange: () => void): () => void {
  let es: EventSource | null = null
  let timer: number | undefined
  let failures = 0
  let stopped = false
  const connect = () => {
    if (stopped) return
    es = new EventSource('/api/stream')
    es.onmessage = () => { failures = 0; onChange() } // the first message arrives on every (re)connect, so this also covers catching up after a drop
    es.onerror = () => {
      es?.close()
      es = null
      failures++
      timer = window.setTimeout(connect, Math.min(60000, 1000 * 2 ** failures))
    }
  }
  connect()
  return () => {
    stopped = true
    es?.close()
    window.clearTimeout(timer)
  }
}
