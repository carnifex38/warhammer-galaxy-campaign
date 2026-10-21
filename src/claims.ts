import { useCallback, useEffect, useState } from 'react'
import { getMyProfile, watchState, type Army } from './api'
import type { AuthApi } from './auth'
import { local } from './localProfiles' // DEV-TOOLS

// Battlezone claims: who is sitting at which battlezone, on which side, with which army list. They live on the live-event server
// (see "battlezone claims" in server/index.mjs). The developer roles (DEV-TOOLS) keep practice claims in this browser instead,
// so the screens work with no server.

export type Team = 'A' | 'B'
export type ZoneStatus = 'open' | 'in_play'

/** A seat as everyone may see it: who, which side, and the list's name, era and points (not its contents). */
export interface Seat { profileId: string; name: string; team: Team; armyId: string; armyName: string; era: '40k' | '30k'; pts?: number; locked: boolean; missing?: boolean }
export interface TableClaims { status: ZoneStatus; seats: Seat[] }
export type ClaimMap = Record<string, TableClaims>

/** A list opened through a seat. */
export interface SeatList { name: string; era: '40k' | '30k'; notes: string; roster: unknown; locked: boolean; player: string; team: Team; status: ZoneStatus }

/** Which list to show in the Army Lists tab (chosen by tapping a player in a battlezone). */
export interface Viewing { tableId: string; profileId: string; player: string; team: Team; where: string }

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let r: Response
  try {
    r = await fetch(path, { cache: 'no-store', ...init, headers: { ...(init.body ? JSON_HEADERS : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  } catch { throw new Error('Cannot reach the server.') }
  if (!r.ok) {
    const msg = ((await r.json().catch(() => null)) as { error?: string } | null)?.error
    throw new Error(msg ?? `The server refused that (${r.status}).`)
  }
  return (await r.json()) as T
}

// ---- practice claims for the developer roles ----

const DEV_KEY = 'galaxy-dev-claims' // DEV-TOOLS
interface DevSeat extends Seat { snapshot?: Army }
type DevMap = Record<string, { status: ZoneStatus; seats: DevSeat[] }>

function readDev(): DevMap {
  try { return JSON.parse(localStorage.getItem(DEV_KEY) ?? '{}') as DevMap } catch { return {} }
}
function writeDev(m: DevMap) {
  try { localStorage.setItem(DEV_KEY, JSON.stringify(m)) } catch { /* not remembered */ }
}
const publicMap = (m: DevMap): ClaimMap =>
  Object.fromEntries(Object.entries(m).map(([id, t]) => [id, { status: t.status, seats: t.seats.map(({ snapshot, ...seat }) => ({ ...seat, locked: !!snapshot })) }]))

async function devClaim(tableId: string, team: Team, armyId: string): Promise<void> {
  const me = await local.mine()
  const army = me.armies.find((a) => a.id === armyId)
  if (!army) throw new Error('Pick one of your army lists.')
  const m = readDev()
  const t = m[tableId] ?? (m[tableId] = { status: 'open', seats: [] })
  if (t.status !== 'open') throw new Error('This battlezone is already in play.')
  const seat: DevSeat = { profileId: me.id, name: me.name, team, armyId, armyName: army.name || 'Untitled army', era: army.era, pts: (army.roster as { pts?: number } | undefined)?.pts, locked: false }
  t.seats = [...t.seats.filter((s) => s.profileId !== me.id), seat]
  writeDev(m)
}

// ---- the hook ----

export function useClaims(auth: AuthApi) {
  const s = auth.session
  const dev = !!s?.dev
  const profileToken = s?.profileToken
  const gmToken = s?.role === 'gm' ? s.token : undefined
  const [map, setMap] = useState<ClaimMap>({})

  const refresh = useCallback(async () => {
    try { setMap(dev ? publicMap(readDev()) : (await call<{ tables: ClaimMap }>('/api/claims')).tables) } catch { /* keep what we have */ }
  }, [dev])

  useEffect(() => {
    void refresh()
    if (dev) return
    return watchState(() => void refresh()) // the server announces every change
  }, [refresh, dev])

  const after = (fresh?: ClaimMap) => { if (fresh) setMap(fresh); else void refresh() }

  return {
    claims: map,
    statusOf: (tableId: string): ZoneStatus => map[tableId]?.status ?? 'open',
    seatsOf: (tableId: string): Seat[] => map[tableId]?.seats ?? [],

    claim: async (tableId: string, team: Team, armyId: string) => {
      if (dev) { await devClaim(tableId, team, armyId); after(); return }
      if (!profileToken) throw new Error('Sign in with a profile to claim a battlezone.')
      after((await call<{ tables: ClaimMap }>(`/api/claims/${tableId}`, { method: 'POST', body: JSON.stringify({ team, armyId }) }, profileToken)).tables)
    },
    leave: async (tableId: string) => {
      if (dev) {
        const me = await local.mine()
        const m = readDev()
        if (m[tableId]) { m[tableId].seats = m[tableId].seats.filter((x) => x.profileId !== me.id); if (!m[tableId].seats.length && m[tableId].status === 'open') delete m[tableId] }
        writeDev(m); after(); return
      }
      if (!profileToken) return
      after((await call<{ tables: ClaimMap }>(`/api/claims/${tableId}`, { method: 'DELETE' }, profileToken)).tables)
    },
    /** Gamemaster: remove someone from a battlezone. */
    remove: async (tableId: string, profileId: string) => {
      if (dev) {
        const m = readDev()
        if (m[tableId]) { m[tableId].seats = m[tableId].seats.filter((x) => x.profileId !== profileId); if (!m[tableId].seats.length && m[tableId].status === 'open') delete m[tableId] }
        writeDev(m); after(); return
      }
      after((await call<{ tables: ClaimMap }>(`/api/claims/${tableId}/${profileId}`, { method: 'DELETE' }, gmToken)).tables)
    },
    /** Gamemaster: mark a battlezone open or in play (in play freezes the lists). */
    setStatus: async (tableId: string, status: ZoneStatus) => {
      if (dev) {
        const m = readDev()
        const t = m[tableId] ?? (m[tableId] = { status: 'open', seats: [] })
        t.status = status
        for (const seat of t.seats) {
          if (status === 'in_play') { const p = await local.get(seat.profileId).catch(() => null); const a = p?.armies.find((x) => x.id === seat.armyId); seat.snapshot = a ? JSON.parse(JSON.stringify(a)) : undefined } else delete seat.snapshot
        }
        if (!t.seats.length && status === 'open') delete m[tableId]
        writeDev(m); after(); return
      }
      after((await call<{ tables: ClaimMap }>(`/api/claims/${tableId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }, gmToken)).tables)
    },
    /** Open a list through its seat. */
    loadList: async (tableId: string, profileId: string): Promise<SeatList> => {
      if (dev) {
        const t = readDev()[tableId]
        const seat = t?.seats.find((x) => x.profileId === profileId)
        if (!t || !seat) throw new Error('That player has no seat here.')
        const army = seat.snapshot ?? (await local.get(profileId).then((p) => p.armies.find((a) => a.id === seat.armyId)).catch(() => undefined))
        if (!army) throw new Error('That list no longer exists.')
        return { name: army.name, era: army.era, notes: army.notes ?? '', roster: army.roster ?? null, locked: !!seat.snapshot, player: seat.name, team: seat.team, status: t.status }
      }
      const token = gmToken ?? profileToken
      if (!token) throw new Error('Sign in as a player to read lists.')
      return (await call<{ list: SeatList }>(`/api/claims/${tableId}/${profileId}/list`, {}, token)).list
    },
  }
}

export type ClaimsApi = ReturnType<typeof useClaims>

/** The signed-in player's own profile (for choosing which list to bring), or null when there is none. */
export function useMyProfile(auth: AuthApi) {
  const s = auth.session
  const dev = !!s?.dev
  const token = s?.profileToken
  const role = s?.role
  const [me, setMe] = useState<{ id: string; name: string; armies: Army[] } | null>(null)
  useEffect(() => {
    let live = true
    setMe(null)
    const load = dev ? (role === 'player' ? local.mine() : null) : token ? getMyProfile(token) : null // DEV-TOOLS: practice profile for the dev player
    void load?.then((p) => { if (live) setMe({ id: p.id, name: p.name, armies: p.armies }) }).catch(() => undefined)
    return () => { live = false }
  }, [dev, token, role])
  return me
}
