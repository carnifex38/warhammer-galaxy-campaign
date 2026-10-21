import { useState, useEffect, useMemo, useRef } from 'react'
import { getState, putState, watchState, Unauthorized } from '../api'
import { EMPTY_INFO, type InfoContent } from './infoDefaults'
import { DEFAULT_TABLES, MAX_HULKS, SECTORS, makeHulkPlanets, makeTables, type GameTable, type Planet, type Sector } from './data'

// What the event host has set up: which planets and hulks are shown, in play, how many battlezones they have,
// what players may read about them, and which sectors are locked.
// It lives on the live-event server (server/index.mjs): only the gamemaster can change it, and the server strips the text
// of hidden sections before sending the event to players.

export const MIN_TABLES = 1
export const MAX_TABLES = 12
const KEY = 'galaxy-event-config'
const HULK_KEY = 'galaxy-hulk' // the old single-hulk setting, read once to carry it over
const HULKS_KEY = 'galaxy-hulks'
const INFO_KEY = 'galaxy-info'
const LOCKED_KEY = 'galaxy-locked'
const PREVIEW_KEY = 'galaxy-host-preview'
/** shown: on the sector map at all. enabled: in play (battlezones to claim). tables: how many battlezones. */
export interface PlanetSetting { enabled: boolean; tables: number; visible: boolean }
export type EventConfig = Record<string, PlanetSetting>

/** A planet as the event sees it. */
export interface PlanetView { enabled: boolean; visible: boolean; tables: GameTable[] }

const DEFAULT: PlanetSetting = { enabled: true, tables: DEFAULT_TABLES, visible: true }

/** How many space hulks drift in each sector (by sector id). Tempestus has one to begin with, never Terra's Solar. */
export type HulkCounts = Record<string, number>
const DEFAULT_HULKS: HulkCounts = { tempestus: 1 }

const clampHulks = (n: number) => Math.min(MAX_HULKS, Math.max(0, Math.round(n)))

function parseHulks(parsed: Record<string, number>): HulkCounts {
  const out: HulkCounts = {}
  for (const s of SECTORS) if (typeof parsed[s.id] === 'number') out[s.id] = clampHulks(parsed[s.id])
  return out
}

function loadHulks(): HulkCounts {
  try {
    const raw = localStorage.getItem(HULKS_KEY)
    if (raw) return parseHulks(JSON.parse(raw) as Record<string, number>)
    // carry over the old one-hulk setting
    const old = localStorage.getItem(HULK_KEY)
    if (old) {
      const v = JSON.parse(old) as { enabled?: boolean; sectorId?: string }
      return v.enabled !== false && v.sectorId && SECTORS.some((s) => s.id === v.sectorId) ? { [v.sectorId]: 1 } : {}
    }
  } catch { /* fall through to the default */ }
  return DEFAULT_HULKS
}

/** What the host has rewritten in the information windows, by sector / planet id. Anything not listed uses the built-in text. */
export type InfoOverrides = Record<string, Partial<InfoContent>>

function loadInfo(): InfoOverrides {
  try {
    const raw = localStorage.getItem(INFO_KEY)
    return raw ? (JSON.parse(raw) as InfoOverrides) : {}
  } catch {
    return {}
  }
}

const parseLocked = (ids: string[]): string[] => ids.filter((id) => SECTORS.some((s) => s.id === id))

function loadLocked(): string[] {
  try {
    const raw = localStorage.getItem(LOCKED_KEY)
    return raw ? parseLocked(JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

const clamp = (n: number) => Math.min(MAX_TABLES, Math.max(MIN_TABLES, Math.round(n)))

function parseConfig(parsed: Record<string, Partial<PlanetSetting>>): EventConfig {
  const out: EventConfig = {}
  for (const [id, v] of Object.entries(parsed)) {
    out[id] = { enabled: v.enabled !== false, visible: v.visible !== false, tables: clamp(typeof v.tables === 'number' ? v.tables : DEFAULT_TABLES) }
  }
  return out
}

function load(): EventConfig {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parseConfig(JSON.parse(raw) as Record<string, Partial<PlanetSetting>>) : {}
  } catch {
    return {}
  }
}

/** Quick ways to set how much of a planet players can see, like a dungeon master's screen. */
export type RevealPreset = 'hidden' | 'rumour' | 'scouted' | 'open'

const PRESETS: Record<Exclude<RevealPreset, 'hidden'>, { enabled: boolean; info: Partial<InfoContent> }> = {
  // known to exist, nothing more: only the briefing, no battlezones, no intel, no orders
  rumour: { enabled: false, info: { infoHidden: false, intelHidden: true, missionHidden: true, zonesHidden: true } },
  // scouted: the briefing and intel are known, the orders and battlezones are not
  scouted: { enabled: false, info: { infoHidden: false, intelHidden: false, missionHidden: true, zonesHidden: true } },
  // open: in play, everything revealed
  open: { enabled: true, info: { infoHidden: false, intelHidden: false, missionHidden: false, zonesHidden: false } },
}

/** Where this device's copy of the event stands with the live-event server. 'denied' = the gamemaster login is no longer valid. */
export type SyncStatus = 'loading' | 'live' | 'offline' | 'denied'

/**
 * The event is kept on the live-event server: the gamemaster (`token`) writes it, everyone else reads it and follows
 * changes live. The browser's own copy is only a cache so the app still opens when the server cannot be reached.
 */
export function useEventConfig(canHost = true, token?: string) {
  const [config, setConfig] = useState<EventConfig>(load)
  const [hulks, setHulks] = useState<HulkCounts>(loadHulks)
  const [infoOverrides, setInfoOverrides] = useState<InfoOverrides>(loadInfo)
  const [locked, setLocked] = useState<string[]>(loadLocked)
  const [sync, setSync] = useState<SyncStatus>('loading')
  // the last state this device and the server agree on (as JSON), and whether the gamemaster has caught up with the server
  const synced = useRef('')
  const [caughtUp, setCaughtUp] = useState(false)
  const gmToken = canHost ? token : undefined
  // the host sees everything, whatever is hidden or locked for players
  const [previewOn, setHostPreview] = useState<boolean>(() => {
    try { return localStorage.getItem(PREVIEW_KEY) === 'yes' } catch { return false }
  })
  // only the gamemaster can see through hidden things, whatever was saved
  const hostPreview = canHost && previewOn

  const save = (key: string, value: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode: it just won't be remembered */ }
  }
  useEffect(() => save(KEY, config), [config])
  useEffect(() => save(HULKS_KEY, hulks), [hulks])
  useEffect(() => save(INFO_KEY, infoOverrides), [infoOverrides])
  useEffect(() => save(LOCKED_KEY, locked), [locked])
  useEffect(() => { try { localStorage.setItem(PREVIEW_KEY, previewOn ? 'yes' : 'no') } catch { /* not remembered */ } }, [previewOn])

  // pull the event from the server: once for the gamemaster, and live for everyone else
  useEffect(() => {
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | undefined
    setCaughtUp(false)
    setSync('loading')

    const pull = async () => {
      try {
        const s = await getState(gmToken)
        if (stopped) return
        if (s) {
          const next = {
            config: parseConfig(s.config as Record<string, Partial<PlanetSetting>>),
            hulks: parseHulks(s.hulks as Record<string, number>),
            info: s.info as InfoOverrides,
            locked: parseLocked(s.locked as string[]),
          }
          synced.current = JSON.stringify(next)
          setConfig(next.config); setHulks(next.hulks); setInfoOverrides(next.info); setLocked(next.locked)
        } else if (!gmToken) {
          // nothing published yet: players see the built-in galaxy, not a stale copy
          synced.current = ''
          setConfig({}); setHulks(DEFAULT_HULKS); setInfoOverrides({}); setLocked([])
        } else {
          synced.current = '' // the server is empty: this gamemaster device's saved setup becomes the event
        }
        setCaughtUp(true)
        setSync('live')
      } catch (e) {
        if (stopped) return
        if (e instanceof Unauthorized) { setSync('denied'); return }
        setSync('offline')
        if (gmToken) retry = setTimeout(pull, 5000) // players get retries from the live connection
      }
    }

    if (gmToken) void pull()
    const unwatch = gmToken ? undefined : watchState(() => void pull())
    return () => { stopped = true; clearTimeout(retry); unwatch?.() }
  }, [gmToken])

  // gamemaster: send every change to the server
  useEffect(() => {
    if (!gmToken || !caughtUp) return
    const state = { config, hulks, info: infoOverrides, locked }
    const json = JSON.stringify(state)
    if (json === synced.current) return
    const t = setTimeout(() => {
      putState(gmToken, state).then(
        () => { synced.current = json; setSync('live') },
        (e) => setSync(e instanceof Unauthorized ? 'denied' : 'offline'),
      )
    }, 400)
    return () => clearTimeout(t)
  }, [gmToken, caughtUp, config, hulks, infoOverrides, locked])

  // every sector as this event has it, hulks included (this is what the host edits)
  const sectors = useMemo<Sector[]>(
    () => SECTORS.map((s) => ({ ...s, planets: [...s.planets, ...makeHulkPlanets(s, hulks[s.id] ?? 0)] })),
    [hulks],
  )

  // what players are shown: planets the host has hidden are removed (the host preview shows them anyway)
  const visibleSectors = useMemo<Sector[]>(
    () => (hostPreview ? sectors : sectors.map((s) => ({ ...s, planets: s.planets.filter((p) => config[p.id]?.visible !== false) }))),
    [sectors, config, hostPreview],
  )

  /** Sectors players cannot enter (the host preview ignores the locks). */
  const lockedForPlayers = hostPreview ? [] : locked

  const patch = (id: string, change: Partial<PlanetSetting>) =>
    setConfig((c) => ({ ...c, [id]: { ...(c[id] ?? DEFAULT), ...change } }))
  const patchInfo = (id: string, change: Partial<InfoContent>) =>
    setInfoOverrides((o) => ({ ...o, [id]: { ...o[id], ...change } }))

  return {
    sync,
    config,
    hulks,
    sectors,
    visibleSectors,
    locked,
    lockedForPlayers,
    hostPreview,
    setHostPreview,
    setHulkCount: (sectorId: string, n: number) => setHulks((h) => ({ ...h, [sectorId]: clampHulks(n) })),
    isLocked: (sectorId: string) => locked.includes(sectorId),
    setLocked: (sectorId: string, on: boolean) => setLocked((l) => (on ? (l.includes(sectorId) ? l : [...l, sectorId]) : l.filter((x) => x !== sectorId))),

    /** The text for an information window: the built-in text with the host's changes on top. */
    infoFor: (id: string, base: InfoContent): InfoContent => ({ ...EMPTY_INFO, ...base, ...infoOverrides[id] }),
    /** The same, as players see it: sections the host has hidden stay hidden (the host preview shows them all). */
    infoForPlayer: (id: string, base: InfoContent): InfoContent => {
      const c: InfoContent = { ...EMPTY_INFO, ...base, ...infoOverrides[id] }
      return hostPreview ? { ...c, infoHidden: false, intelHidden: false, missionHidden: false, zonesHidden: false } : c
    },
    /** Whether the host has changed this window from its built-in text. */
    infoEdited: (id: string) => id in infoOverrides,
    setInfo: patchInfo,
    /** Write several windows at once (used to load the sample mission). */
    setInfoMany: (many: Record<string, Partial<InfoContent>>) =>
      setInfoOverrides((o) => {
        const next = { ...o }
        for (const [id, c] of Object.entries(many)) next[id] = { ...next[id], ...c }
        return next
      }),
    /** Put several windows back to their built-in text. */
    resetInfoMany: (ids: string[]) =>
      setInfoOverrides((o) => {
        const next = { ...o }
        for (const id of ids) delete next[id]
        return next
      }),
    resetInfo: (id: string) =>
      setInfoOverrides((o) => {
        const { [id]: _removed, ...rest } = o
        return rest
      }),

    planetView(planet: Planet): PlanetView {
      const s = config[planet.id] ?? DEFAULT
      return { enabled: s.enabled, visible: s.visible, tables: s.tables === planet.tables.length ? planet.tables : makeTables(planet.id, planet.name, s.tables) }
    },
    setEnabled: (id: string, enabled: boolean) => patch(id, { enabled }),
    setVisible: (id: string, visible: boolean) => patch(id, { visible }),
    setTables: (id: string, tables: number) => patch(id, { tables: clamp(tables) }),
    setSectorEnabled: (sector: Sector, enabled: boolean) =>
      setConfig((c) => {
        const next = { ...c }
        for (const p of sector.planets) next[p.id] = { ...(c[p.id] ?? DEFAULT), enabled }
        return next
      }),
    setSectorVisible: (sector: Sector, visible: boolean) =>
      setConfig((c) => {
        const next = { ...c }
        for (const p of sector.planets) next[p.id] = { ...(c[p.id] ?? DEFAULT), visible }
        return next
      }),
    /** One tap to set how much players can see of a planet or hulk. */
    applyPreset: (id: string, preset: RevealPreset) => {
      if (preset === 'hidden') { patch(id, { visible: false }); return }
      const p = PRESETS[preset]
      patch(id, { visible: true, enabled: p.enabled })
      patchInfo(id, p.info)
    },
    reset: () => { setConfig({}); setHulks(DEFAULT_HULKS); setInfoOverrides({}); setLocked([]); setHostPreview(false) },
  }
}

export type EventApi = ReturnType<typeof useEventConfig>
