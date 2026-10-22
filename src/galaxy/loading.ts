import { useSyncExternalStore } from 'react'

// A tiny shared store for "how far along is the start-up work", so a loading bar can show it.
// The work is a list of steps (build the galaxy, then compile each planet's shader in the background);
// the percentage is simply steps finished / steps in total.

export interface LoadState {
  done: number
  total: number
  label: string
}

let state: LoadState = { done: 0, total: 1, label: 'Starting' }
const listeners = new Set<() => void>()

export function setLoad(patch: Partial<LoadState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const getLoad = () => state

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useLoad(): LoadState {
  return useSyncExternalStore(subscribe, () => state)
}
