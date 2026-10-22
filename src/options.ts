import { useSyncExternalStore } from 'react'

// Player options, kept in this browser only. Graphics options for now; UI and display categories come later.

export type PlanetDisplay = 'dots' | 'close' | 'all'
export type SectorHighlight = 'full' | 'reduced' | 'minimal'

export interface Options {
  /** How planets look on the galaxy map: plain coloured dots, the planet's surface once you zoom in close, or always. */
  planetDisplay: PlanetDisplay
  /** Keep the galaxy map in view when a planet is selected, instead of black space with a starfield around the planet. */
  hideStarfield: boolean
  /** How strongly sectors are coloured and outlined on the galaxy map. */
  sectorHighlight: SectorHighlight
}

const KEY = 'galaxy-options'
const DEFAULTS: Options = { planetDisplay: 'dots', hideStarfield: false, sectorHighlight: 'full' }

function load(): Options {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Options>
    return {
      planetDisplay: raw.planetDisplay === 'close' || raw.planetDisplay === 'all' || raw.planetDisplay === 'dots' ? raw.planetDisplay : DEFAULTS.planetDisplay,
      hideStarfield: raw.hideStarfield === true,
      sectorHighlight: raw.sectorHighlight === 'reduced' || raw.sectorHighlight === 'minimal' ? raw.sectorHighlight : 'full',
    }
  } catch {
    return DEFAULTS
  }
}

let current = load()
const listeners = new Set<() => void>()

export function setOption<K extends keyof Options>(key: K, value: Options[K]) {
  current = { ...current, [key]: value }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* not remembered */ }
  listeners.forEach((l) => l())
}

export function useOptions(): Options {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => current,
  )
}
