import { useSyncExternalStore } from 'react'

// DEV-TOOLS: a test of the "void shield" look. Which team has captured which battlezone is kept here, in this browser only (the live
// event has no capture result yet). The test panel on the battlezone list sets it, and the planet view draws the shields from it.

export type ShieldTeam = 'A' | 'B'
export interface Win { team: ShieldTeam; at: number } // `at`: when it was captured (0 = long ago, so it shows already up)

/** The planets the test is switched on for. */
export const SHIELD_TEST_PLANETS = new Set(['Terra'])

const KEY = 'galaxy-dev-shield-winners'

function load(): Record<string, Win> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, ShieldTeam>
    return Object.fromEntries(Object.entries(raw).map(([id, team]) => [id, { team, at: 0 }]))
  } catch {
    return {}
  }
}

let wins: Record<string, Win> = load()
const listeners = new Set<() => void>()

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(wins).map(([id, w]) => [id, w.team])))) } catch { /* not remembered */ }
}

/** Mark a battlezone as captured by a team (or clear it with null). */
export function setWinner(zoneId: string, team: ShieldTeam | null) {
  const next = { ...wins }
  if (team) next[zoneId] = { team, at: Date.now() }
  else delete next[zoneId]
  wins = next
  save()
  listeners.forEach((l) => l())
}

export function useWinners(): Record<string, Win> {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => wins,
  )
}
