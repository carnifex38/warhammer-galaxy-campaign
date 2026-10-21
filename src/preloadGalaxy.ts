import { useSyncExternalStore } from 'react'
import { idle } from './idle'

// While the player is still on the login screen, quietly fetch the 3D galaxy code and prepare its star field, one small
// piece at a time and only when the browser is idle. Nothing here draws anything or starts the graphics card, so the
// login screen stays perfectly smooth, and by the time the player enters the galaxy most of the work is already done.
// The login screen shows how far along this is.

export interface PreloadState { done: number; total: number; label: string }

const TOTAL = 5
let state: PreloadState = { done: 0, total: TOTAL, label: 'Preparing the galaxy' }
const listeners = new Set<() => void>()
const set = (patch: Partial<PreloadState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** How far the background preparation has got (for the loading bar on the login screen). */
export function usePreload(): PreloadState {
  return useSyncExternalStore(subscribe, () => state)
}

let started = false

export function preloadGalaxy() {
  if (started) return
  started = true
  void (async () => {
    try {
      await idle(1500) // let the login screen draw first
      set({ label: 'Fetching the galaxy' })
      await import('./galaxy/GalaxyView') // fetches and readies the 3D code; draws nothing
      set({ done: 1, label: 'Starting the 3D engine' })
      await idle()
      const g = await import('./galaxy/Galaxy3D')
      set({ done: 2, label: 'Scattering the stars' })
      let saved: string | null = null
      try { saved = localStorage.getItem('galaxy-era') } catch { /* no saved era */ }
      const first = saved === '30k' ? '30k' : '40k'
      await g.prepareStars(first)
      set({ done: 3, label: 'Painting the nebulae' })
      await idle()
      await (await import('./galaxy/Nebula')).prepareSky() // the faint background dust
      set({ done: 4, label: 'Almost there' })
      await idle()
      await g.prepareStars(first === '40k' ? '30k' : '40k') // the other era, ready for when the switch is used
      set({ done: TOTAL, label: 'Galaxy ready' })
    } catch {
      /* the galaxy simply loads when it is opened instead */
      set({ done: TOTAL, label: 'Ready' })
    }
  })()
}
