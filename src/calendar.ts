import { useCallback, useEffect, useState } from 'react'
import { listProfiles, watchState, type ProfileSummary } from './api'
import type { AuthApi } from './auth'
import { local } from './localProfiles' // DEV-TOOLS

// The calendar: events the gamemaster schedules (a date, a name, and the planets that will be fought over), and the players who have
// signed up for each planet. It lives on the live-event server (see "calendar" in server/index.mjs). The developer roles (DEV-TOOLS)
// keep a practice calendar in this browser instead, so the screens work with no server.

export interface CalendarPlayer { profileId: string; name: string }
/** One planet in an event: how many players are wanted, and who has signed up. */
export interface CalendarPlanet { planetId: string; target: number; players: CalendarPlayer[] }
export interface CalendarEvent { id: string; name: string; /** YYYY-MM-DD */ date: string; notes: string; planets: CalendarPlanet[] }
/** What the gamemaster fills in to make or change an event. */
export interface EventDraft { name: string; date: string; notes: string; planets: { planetId: string; target: number }[] }

export const MAX_EVENT_PLANETS = 24

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function call(path: string, init: RequestInit = {}, token?: string): Promise<CalendarEvent[]> {
  let r: Response
  try {
    r = await fetch(path, { cache: 'no-store', ...init, headers: { ...(init.body ? JSON_HEADERS : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  } catch { throw new Error('Cannot reach the server.') }
  if (!r.ok) {
    const msg = ((await r.json().catch(() => null)) as { error?: string } | null)?.error
    throw new Error(msg ?? `The server refused that (${r.status}).`)
  }
  return ((await r.json()) as { events: CalendarEvent[] }).events
}

// ---- practice calendar for the developer roles ----

const DEV_KEY = 'galaxy-dev-calendar' // DEV-TOOLS
const byDate = (a: CalendarEvent, b: CalendarEvent) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)

function readDev(): CalendarEvent[] {
  try { return (JSON.parse(localStorage.getItem(DEV_KEY) ?? '[]') as CalendarEvent[]).sort(byDate) } catch { return [] }
}
function writeDev(list: CalendarEvent[]) {
  try { localStorage.setItem(DEV_KEY, JSON.stringify(list)) } catch { /* not remembered */ }
}
const draftPlanets = (draft: EventDraft, previous: CalendarPlanet[] = []): CalendarPlanet[] =>
  draft.planets.map((p) => ({ planetId: p.planetId, target: p.target, players: previous.find((o) => o.planetId === p.planetId)?.players ?? [] }))

/** The day as YYYY-MM-DD in this device's own calendar (not UTC, which can be a day off in the evening). */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ---- the hook ----

export function useCalendar(auth: AuthApi) {
  const s = auth.session
  const dev = !!s?.dev
  const profileToken = s?.profileToken
  const gmToken = s?.role === 'gm' ? s.token : undefined
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [devId, setDevId] = useState<string | null>(null)
  // who "you" are in the sign-up lists: the profile id is the part of the token before the dot
  const myId = dev ? devId : profileToken ? profileToken.split('.')[0] : null

  useEffect(() => {
    if (!dev) return
    let live = true
    void local.mine().then((p) => { if (live) setDevId(p.id) }).catch(() => undefined)
    return () => { live = false }
  }, [dev])

  const refresh = useCallback(async () => {
    try { setEvents(dev ? readDev() : await call('/api/calendar')) } catch { /* keep what we have */ }
  }, [dev])

  useEffect(() => {
    void refresh()
    if (dev) return
    return watchState(() => void refresh()) // the server announces every change
  }, [refresh, dev])

  const after = (fresh?: CalendarEvent[]) => { if (fresh) setEvents(fresh); else void refresh() }

  return {
    events,
    myId,
    /** Gamemaster: schedule an event. */
    create: async (draft: EventDraft) => {
      if (dev) { writeDev([...readDev(), { id: Math.random().toString(16).slice(2, 14), name: draft.name.trim(), date: draft.date, notes: draft.notes.trim(), planets: draftPlanets(draft) }]); after(); return }
      after(await call('/api/calendar', { method: 'POST', body: JSON.stringify(draft) }, gmToken))
    },
    /** Gamemaster: change an event (sign-ups on planets that stay are kept). */
    update: async (id: string, draft: EventDraft) => {
      if (dev) { writeDev(readDev().map((e) => (e.id === id ? { ...e, name: draft.name.trim(), date: draft.date, notes: draft.notes.trim(), planets: draftPlanets(draft, e.planets) } : e))); after(); return }
      after(await call(`/api/calendar/${id}`, { method: 'PUT', body: JSON.stringify(draft) }, gmToken))
    },
    /** Gamemaster: remove an event. */
    remove: async (id: string) => {
      if (dev) { writeDev(readDev().filter((e) => e.id !== id)); after(); return }
      after(await call(`/api/calendar/${id}`, { method: 'DELETE' }, gmToken))
    },
    /** Gamemaster: take someone off an event's sign-ups. */
    removePlayer: async (id: string, profileId: string) => {
      if (dev) { writeDev(readDev().map((e) => (e.id === id ? { ...e, planets: e.planets.map((p) => ({ ...p, players: p.players.filter((x) => x.profileId !== profileId) })) } : e))); after(); return }
      after(await call(`/api/calendar/${id}/signup/${profileId}`, { method: 'DELETE' }, gmToken))
    },
    /** Sign up for a planet in an event (one planet per event: this moves you if you were on another). */
    signUp: async (id: string, planetId: string) => {
      if (dev) {
        const me = await local.mine()
        writeDev(readDev().map((e) => (e.id === id ? { ...e, planets: e.planets.map((p) => ({ ...p, players: [...p.players.filter((x) => x.profileId !== me.id), ...(p.planetId === planetId ? [{ profileId: me.id, name: me.name }] : [])] })) } : e)))
        after(); return
      }
      if (!profileToken) throw new Error('Sign in with a profile to sign up.')
      after(await call(`/api/calendar/${id}/signup`, { method: 'POST', body: JSON.stringify({ planetId }) }, profileToken))
    },
    /** Gamemaster: sign any player up for a planet (moving them if they were on another in the same event). */
    assignPlayer: async (id: string, planetId: string, profileId: string) => {
      if (dev) {
        const p = await local.get(profileId)
        writeDev(readDev().map((e) => (e.id === id ? { ...e, planets: e.planets.map((pl) => ({ ...pl, players: [...pl.players.filter((x) => x.profileId !== profileId), ...(pl.planetId === planetId ? [{ profileId, name: p.name }] : [])] })) } : e)))
        after(); return
      }
      after(await call(`/api/calendar/${id}/signup`, { method: 'POST', body: JSON.stringify({ planetId, profileId }) }, gmToken))
    },
    /** Gamemaster: the players who can be signed up. */
    gmPlayers: async (): Promise<ProfileSummary[]> => (dev ? local.list() : listProfiles(gmToken ?? '')),
    /** Take yourself off an event. */
    leave: async (id: string) => {
      if (dev) {
        const me = await local.mine()
        writeDev(readDev().map((e) => (e.id === id ? { ...e, planets: e.planets.map((p) => ({ ...p, players: p.players.filter((x) => x.profileId !== me.id) })) } : e)))
        after(); return
      }
      if (!profileToken) return
      after(await call(`/api/calendar/${id}/signup`, { method: 'DELETE' }, profileToken))
    },
  }
}

export type CalendarApi = ReturnType<typeof useCalendar>
