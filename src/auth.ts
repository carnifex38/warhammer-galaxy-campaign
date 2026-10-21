import { useState } from 'react'

// Who is using the app: a guest, a player, or the gamemaster (host).
//
// Guests and players are only a name (no password, no accounts). The gamemaster password is checked by the live-event
// server (server/index.mjs), which hands back a token that lets this browser change the event.

import { gmLogin } from './api'

export type Role = 'guest' | 'player' | 'gm'

export interface Session { role: Role; name: string; /** gamemaster only: proves the server accepted the password */ token?: string }

const KEY = 'galaxy-session'

export const ROLE_LABEL: Record<Role, string> = { guest: 'Guest', player: 'Player', gm: 'Gamemaster' }

function load(): Session | null {
  try {
    // the gamemaster login lasts until the tab is closed; guest and player stay signed in on this device
    const raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Session>
    if (s.role === 'guest' || s.role === 'player') return { role: s.role, name: String(s.name ?? '').slice(0, 24) }
    if (s.role === 'gm' && typeof s.token === 'string') return { role: 'gm', name: String(s.name ?? '').slice(0, 24), token: s.token }
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
    /** Returns false when the password is wrong; throws when the server cannot be reached. */
    loginGm: async (password: string, name = 'Gamemaster') => {
      const token = await gmLogin(password)
      if (!token) return false
      start({ role: 'gm', name, token })
      return true
    },
    logout: () => start(null),
  }
}

export type AuthApi = ReturnType<typeof useAuth>
