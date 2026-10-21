import { useState, useEffect, useMemo } from 'react'
import { EMPTY_INFO, type InfoContent } from './infoDefaults'
import { DEFAULT_TABLES, MAX_HULKS, SECTORS, makeHulkPlanets, makeTables, type GameTable, type Planet, type Sector } from './data'

// What the event host has set up: which planets and hulks are shown, in play, how many battlezones they have,
// what players may read about them, and which sectors are locked.
// For now this is saved in the browser on this device only; sharing it with every player's phone
// needs the live-event server (a later milestone), and that is also where "who may edit it" gets enforced.
// Until then nothing here is truly secret: the Host tab and the player view live in the same app.

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

function loadHulks(): HulkCounts {
  try {
    const raw = localStorage.getItem(HULKS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, number>
      const out: HulkCounts = {}
      for (const s of SECTORS) if (typeof parsed[s.id] === 'number') out[s.id] = clampHulks(parsed[s.id])
      return out
    }
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

function loadLocked(): string[] {
  try {
    const raw = localStorage.getItem(LOCKED_KEY)
    const ids = raw ? (JSON.parse(raw) as string[]) : []
    return ids.filter((id) => SECTORS.some((s) => s.id === id))
  } catch {
    return []
  }
}

const clamp = (n: number) => Math.min(MAX_TABLES, Math.max(MIN_TABLES, Math.round(n)))

function load(): EventConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Partial<PlanetSetting>>
    const out: EventConfig = {}
    for (const [id, v] of Object.entries(parsed)) {
      out[id] = { enabled: v.enabled !== false, visible: v.visible !== false, tables: clamp(typeof v.tables === 'number' ? v.tables : DEFAULT_TABLES) }
    }
    return out
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

export function useEventConfig(canHost = true) {
  const [config, setConfig] = useState<EventConfig>(load)
  const [hulks, setHulks] = useState<HulkCounts>(loadHulks)
  const [infoOverrides, setInfoOverrides] = useState<InfoOverrides>(loadInfo)
  const [locked, setLocked] = useState<string[]>(loadLocked)
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
