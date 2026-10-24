import { useCallback, useEffect, useRef, useState } from 'react'
import { getMyProfile, getProfile, listProfiles, watchState, type Army, type ProfileSummary } from './api'
import type { AuthApi } from './auth'
import { local } from './localProfiles' // DEV-TOOLS

// Battlezone claims: who is sitting at which battlezone, on which side, with which army list. They live on the live-event server
// (see "battlezone claims" in server/index.mjs). The developer roles (DEV-TOOLS) keep practice claims in this browser instead,
// so the screens work with no server.

export type Team = 'A' | 'B'
export type ZoneStatus = 'open' | 'in_play'

/** A seat as everyone may see it: who, which side, and the list's name, era and points (not its contents). */
export interface Seat { profileId: string; name: string; team: Team; armyId: string; armyName: string; era: '40k' | '30k'; pts?: number; locked: boolean; missing?: boolean }
export interface TableClaims { status: ZoneStatus; seats: Seat[]; /** the team the gamemaster declared the winner (a void shield goes up for them) */ winner?: Team | null; wonAt?: number }
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
type DevMap = Record<string, { status: ZoneStatus; seats: DevSeat[]; winner?: Team | null; wonAt?: number }>

function readDev(): DevMap {
  try { return JSON.parse(localStorage.getItem(DEV_KEY) ?? '{}') as DevMap } catch { return {} }
}
function writeDev(m: DevMap) {
  try { localStorage.setItem(DEV_KEY, JSON.stringify(m)) } catch { /* not remembered */ }
}
const publicMap = (m: DevMap): ClaimMap =>
  Object.fromEntries(Object.entries(m).map(([id, t]) => [id, { status: t.status, seats: t.seats.map(({ snapshot, ...seat }) => ({ ...seat, locked: !!snapshot })), winner: t.winner ?? null, wonAt: t.wonAt ?? 0 }]))

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

  // answers can arrive out of order when changes come quickly: only the newest request may update the screen
  const latest = useRef(0)
  const refresh = useCallback(async () => {
    const mine = ++latest.current
    try {
      const fresh = dev ? publicMap(readDev()) : (await call<{ tables: ClaimMap }>('/api/claims')).tables
      if (mine === latest.current) setMap(fresh)
    } catch { /* keep what we have */ }
  }, [dev])

  useEffect(() => {
    void refresh()
    if (dev) return
    return watchState(() => void refresh()) // the server announces every change
  }, [refresh, dev])

  const after = (fresh?: ClaimMap) => { if (fresh) { latest.current++; setMap(fresh) } else void refresh() }

  return {
    claims: map,
    statusOf: (tableId: string): ZoneStatus => map[tableId]?.status ?? 'open',
    seatsOf: (tableId: string): Seat[] => map[tableId]?.seats ?? [],
    /** Which of these battlezones (or, with none listed, of all) have a declared result. */
    resultCount: (tableIds?: string[]): number => Object.entries(map).filter(([id, t]) => !!t.winner && (!tableIds || tableIds.includes(id))).length,
    winnerOf: (tableId: string): { team: Team; at: number } | null => (map[tableId]?.winner ? { team: map[tableId].winner as Team, at: map[tableId].wonAt ?? 0 } : null),

    claim: async (tableId: string, team: Team, armyId: string) => {
      if (dev) { await devClaim(tableId, team, armyId); after(); return }
      if (!profileToken) throw new Error('Sign in with a profile to claim a battlezone.')
      after((await call<{ tables: ClaimMap }>(`/api/claims/${tableId}`, { method: 'POST', body: JSON.stringify({ team, armyId }) }, profileToken)).tables)
    },
    leave: async (tableId: string) => {
      if (dev) {
        const me = await local.mine()
        const m = readDev()
        if (m[tableId]) { m[tableId].seats = m[tableId].seats.filter((x) => x.profileId !== me.id); if (!m[tableId].seats.length && m[tableId].status === 'open' && !m[tableId].winner) delete m[tableId] }
        writeDev(m); after(); return
      }
      if (!profileToken) return
      after((await call<{ tables: ClaimMap }>(`/api/claims/${tableId}`, { method: 'DELETE' }, profileToken)).tables)
    },
    /** Gamemaster: the players that can be put at a battlezone. */
    gmPlayers: async (): Promise<ProfileSummary[]> => (dev ? local.list() : listProfiles(gmToken ?? '')),
    /** Gamemaster: one player's army lists. */
    gmArmies: async (profileId: string): Promise<Army[]> => (dev ? (await local.get(profileId)).armies : (await getProfile(gmToken ?? '', profileId)).armies),
    /** Gamemaster: put a player at a battlezone, or change their team or list. Works for a battlezone in play too. */
    assign: async (tableId: string, profileId: string, team: Team, armyId: string) => {
      if (dev) {
        const p = await local.get(profileId)
        const army = p.armies.find((a) => a.id === armyId)
        if (!army) throw new Error("Pick one of that player's army lists.")
        const m = readDev()
        const t = m[tableId] ?? (m[tableId] = { status: 'open', seats: [] })
        let seat = t.seats.find((x) => x.profileId === profileId)
        if (seat) { seat.team = team; seat.armyId = armyId; seat.armyName = army.name || 'Untitled army'; seat.era = army.era; seat.pts = (army.roster as { pts?: number } | undefined)?.pts } else {
          seat = { profileId, name: p.name, team, armyId, armyName: army.name || 'Untitled army', era: army.era, pts: (army.roster as { pts?: number } | undefined)?.pts, locked: false }
          t.seats.push(seat)
        }
        if (t.status === 'in_play') seat.snapshot = JSON.parse(JSON.stringify(army))
        writeDev(m); after(); return
      }
      after((await call<{ tables: ClaimMap }>(`/api/claims/${tableId}/${profileId}`, { method: 'PUT', body: JSON.stringify({ team, armyId }) }, gmToken)).tables)
    },
    /** Gamemaster: remove someone from a battlezone. */
    remove: async (tableId: string, profileId: string) => {
      if (dev) {
        const m = readDev()
        if (m[tableId]) { m[tableId].seats = m[tableId].seats.filter((x) => x.profileId !== profileId); if (!m[tableId].seats.length && m[tableId].status === 'open' && !m[tableId].winner) delete m[tableId] }
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
        if (!t.seats.length && status === 'open' && !t.winner) delete m[tableId]
        writeDev(m); after(); return
      }
      after((await call<{ tables: ClaimMap }>(`/api/claims/${tableId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }, gmToken)).tables)
    },
    /** Gamemaster: declare which team won a battlezone (null clears it). A void shield goes up for the winner. */
    setWinner: async (tableId: string, winner: Team | null) => {
      if (dev) {
        const m = readDev()
        const t = m[tableId] ?? (m[tableId] = { status: 'open', seats: [] })
        if (winner) { t.winner = winner; t.wonAt = Date.now() } else { delete t.winner; delete t.wonAt }
        if (!t.seats.length && t.status === 'open' && !t.winner) delete m[tableId]
        writeDev(m); after(); return
      }
      after((await call<{ tables: ClaimMap }>(`/api/claims/${tableId}/winner`, { method: 'PUT', body: JSON.stringify({ winner }) }, gmToken)).tables)
    },
    /** Gamemaster: clear the results of the listed battlezones, or of all of them when none are listed. */
    clearResults: async (tableIds?: string[]) => {
      if (dev) {
        const m = readDev()
        for (const [id, t] of Object.entries(m)) {
          if (tableIds && !tableIds.includes(id)) continue
          delete t.winner
          delete t.wonAt
          if (!t.seats.length && t.status === 'open') delete m[id]
        }
        writeDev(m); after(); return
      }
      after((await call<{ tables: ClaimMap }>('/api/claims/results/clear', { method: 'POST', body: JSON.stringify({ ids: tableIds ?? null }) }, gmToken)).tables)
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
