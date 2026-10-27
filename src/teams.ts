import { createContext, useContext, type CSSProperties } from 'react'

// The two sides of the event: a name and a colour each, chosen by the host (Host tab). Everything that shows a team (the map key, the
// rings under planets, the void shields, the ships, the seats, the Territory page) reads them from here.

export type TeamId = 'A' | 'B'
export interface TeamLook { name: string; color: string }
export type Teams = Record<TeamId, TeamLook>

export const DEFAULT_TEAMS: Teams = {
  A: { name: 'Team A', color: '#3d8bff' },
  B: { name: 'Team B', color: '#ff4141' },
}

export const MAX_TEAM_NAME = 24
const HEX = /^#[0-9a-f]{6}$/i

/** Teams from saved or received data: anything missing or odd falls back to the default for that side. */
export function parseTeams(raw: unknown): Teams {
  const out: Teams = { A: { ...DEFAULT_TEAMS.A }, B: { ...DEFAULT_TEAMS.B } }
  if (raw === null || typeof raw !== 'object') return out
  for (const id of ['A', 'B'] as const) {
    const t = (raw as Record<string, unknown>)[id]
    if (t === null || typeof t !== 'object') continue
    const { name, color } = t as Record<string, unknown>
    if (typeof name === 'string' && name.trim()) out[id].name = name.trim().slice(0, MAX_TEAM_NAME)
    if (typeof color === 'string' && HEX.test(color)) out[id].color = color.toLowerCase()
  }
  return out
}

export const isDefaultTeams = (t: Teams) => (['A', 'B'] as const).every((id) => t[id].name === DEFAULT_TEAMS[id].name && t[id].color === DEFAULT_TEAMS[id].color)

// the 3D scenes (which cannot see React context from inside the canvas) read the current teams from here when they are built; the
// galaxy is rebuilt every time the player comes back to it, so a change made in the Host tab is there by then
let current: Teams = DEFAULT_TEAMS
export const teamsNow = () => current
export const setTeamsNow = (t: Teams) => { current = t }

const TeamsContext = createContext<Teams>(DEFAULT_TEAMS)
export const TeamsProvider = TeamsContext.Provider
export const useTeams = () => useContext(TeamsContext)

/** The colour mixed toward white (0 = as it is, 1 = white): readable on a dark page even when the chosen colour is dark. */
export function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`
}

/** The colour as red, green, blue from 0 to 1 (for shaders). */
export function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** The page-wide colour variables the style sheet uses. */
export function teamVars(t: Teams): CSSProperties {
  const [a, b] = [rgb01(t.A.color).map((c) => Math.round(c * 255)).join(', '), rgb01(t.B.color).map((c) => Math.round(c * 255)).join(', ')]
  return { ['--team-a' as string]: t.A.color, ['--team-b' as string]: t.B.color, ['--team-a-rgb' as string]: a, ['--team-b-rgb' as string]: b, ['--team-a-text' as string]: lighten(t.A.color, 0.4), ['--team-b-text' as string]: lighten(t.B.color, 0.4) }
}
