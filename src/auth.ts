import { useState } from 'react'

// Who is using the app: a guest, a player, or the gamemaster (host).
//
// Guests are only a name. A player has a profile: a name and password they choose, checked by the live-event server
// (server/index.mjs), which holds their army lists. The gamemaster password is checked there too, and hands back a token that
// lets this browser change the event. The gamemaster can also have a profile of their own.

import { createProfile, gmLogin, loginProfile } from './api'

export type Role = 'guest' | 'player' | 'gm'

export interface Session { role: Role; name: string; /** gamemaster only: proves the server accepted the password */ token?: string; /** a signed-in profile: lets this browser read and edit that profile's army lists */ profileToken?: string; dev?: boolean /* DEV-TOOLS */ }

/**
 * DEV-TOOLS: the developer shortcuts are on in the dev server, in a build made with VITE_DEV_TOOLS=true, and in any browser
 * that has opened the site once with `?dev` on the end of the address (remembered on that browser; `?dev=off` forgets it).
 * On the published site nobody sees the DEV button without that link.
 */
function devLink(): boolean {
  try {
    const p = new URLSearchParams(location.search).get('dev')
    if (p === 'off') localStorage.removeItem('galaxy-dev-link')
    else if (p !== null) localStorage.setItem('galaxy-dev-link', '1')
    return p !== 'off' && localStorage.getItem('galaxy-dev-link') === '1'
  } catch {
    return false
  }
}
export const DEV_TOOLS = import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === 'true' || devLink()

const KEY = 'galaxy-session'

export const ROLE_LABEL: Record<Role, string> = { guest: 'Guest', player: 'Player', gm: 'Gamemaster' }

function load(): Session | null {
  try {
    // the gamemaster login lasts until the tab is closed; guest and player stay signed in on this device
    const raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<Session>
    if (s.dev === true && DEV_TOOLS && (s.role === 'guest' || s.role === 'player' || s.role === 'gm')) return { role: s.role, name: String(s.name ?? '').slice(0, 24), dev: true } // DEV-TOOLS
    const profileToken = typeof s.profileToken === 'string' ? s.profileToken : undefined
    if (s.role === 'guest' || s.role === 'player') return { role: s.role, name: String(s.name ?? '').slice(0, 24), profileToken }
    if (s.role === 'gm' && typeof s.token === 'string') return { role: 'gm', name: String(s.name ?? '').slice(0, 24), token: s.token, profileToken }
  } catch { /* fall through */ }
  return null
}

function save(s: Session | null) {
  try {
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(KEY)
    if (!s) return
    ;(s.role === 'gm' || s.dev ? sessionStorage : localStorage).setItem(KEY, JSON.stringify(s)) // DEV-TOOLS: dev sessions end with the tab
  } catch { /* private mode: it just won't be remembered */ }
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(load)
  const start = (s: Session | null) => { save(s); setSession(s) }

  return {
    session,
    loginGuest: () => start({ role: 'guest', name: 'Guest' }),
    /** Sign in with a profile name and password. Throws with a message to show when it fails. */
    loginPlayer: async (name: string, password: string) => {
      const { token, profile } = await loginProfile(name, password)
      start({ role: 'player', name: profile.name, profileToken: token })
    },
    /** Make a new profile and sign in as it. Throws with a message to show when it fails (name taken...). */
    signUpPlayer: async (name: string, password: string) => {
      const { token, profile } = await createProfile(name, password)
      start({ role: 'player', name: profile.name, profileToken: token })
    },
    /** The gamemaster takes part too: sign in to, or create, a profile of their own (the gamemaster login stays). */
    linkGmProfile: async (name: string, password: string, create: boolean) => {
      const { token } = await (create ? createProfile(name, password) : loginProfile(name, password))
      if (session?.role === 'gm') start({ ...session, profileToken: token })
    },
    /** Forget the profile sign-in (after the profile was deleted or its password stopped working). */
    dropProfile: () => { if (session?.role === 'gm') start({ ...session, profileToken: undefined }); else start(null) },
    /** Returns false when the password is wrong; throws when the server cannot be reached. */
    loginGm: async (password: string, name = 'Gamemaster') => {
      const token = await gmLogin(password)
      if (!token) return false
      start({ role: 'gm', name, token })
      return true
    },
    loginDev: (role: Role, name: string) => start({ role, name, dev: true }), // DEV-TOOLS
    logout: () => start(null),
  }
}

export type AuthApi = ReturnType<typeof useAuth>
