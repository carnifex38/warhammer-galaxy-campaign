import { useState } from 'react'

// Who is using the app: a guest, a player, or the gamemaster (host).
//
// IMPORTANT: this is only a *door sign* for now. Everything runs in the browser, so the password below is visible to
// anyone who looks at the app's code, and the host's settings live on the same device. Real logins (accounts,
// password checking, keeping hidden things away from players) arrive with the live-event server (milestone 4).

export type Role = 'guest' | 'player' | 'gm'

export interface Session { role: Role; name: string }

/** TEMPORARY gamemaster password, as requested, until the server can check real ones. */
const GM_PASSWORD = 'admin'

const KEY = 'galaxy-session'

export const ROLE_LABEL: Record<Role, string> = { guest: 'Guest', player: 'Player', gm: 'Gamemaster' }

function load(): Session | null {
  try {
    // the gamemaster login lasts until the tab is closed; guest and player stay signed in on this device
    const raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Session>
    if (s.role === 'guest' || s.role === 'player' || s.role === 'gm') return { role: s.role, name: String(s.name ?? '').slice(0, 24) }
  } catch { /* fall through */ }
  return null
}

function save(s: Session | null) {
  try {
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(KEY)
    if (!s) return
    ;(s.role === 'gm' ? sessionStorage : localStorage).setItem(KEY, JSON.stringify(s))
  } catch { /* private mode: it just won't be remembered */ }
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(load)
  const start = (s: Session | null) => { save(s); setSession(s) }

  return {
    session,
    loginGuest: () => start({ role: 'guest', name: 'Guest' }),
    loginPlayer: (name: string) => start({ role: 'player', name: name.trim().slice(0, 24) || 'Player' }),
    /** Returns false when the password is wrong. */
    loginGm: (password: string, name = 'Gamemaster') => {
      if (password !== GM_PASSWORD) return false
      start({ role: 'gm', name })
      return true
    },
    logout: () => start(null),
  }
}

export type AuthApi = ReturnType<typeof useAuth>
