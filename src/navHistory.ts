import { useEffect, useRef } from 'react'

// The browser's Back and Forward buttons (and a phone's back gesture) step through what the player did, instead of leaving the app:
//  - switching screens (Galaxy, Army Lists, Calendar...) is one step each (see usePlaceHistory),
//  - a window that opens over a screen (an army builder pop-up, the media library) is one step, and Back closes it (useBackClose).
// Nothing is written into the address: the steps live in the browser's history only. Choosing a sector, planet or battlezone on the
// galaxy map is not a step (yet).

interface Step { gcPlace?: unknown; gcLayer?: number }
const stateNow = () => (history.state ?? {}) as Step

/**
 * Call while a window is open: it takes a step in the history, and when the player presses Back the window is closed (onClose).
 * A window closed some other way (its own button) takes its step off again.
 */
let layers = 0
export function useBackClose(onClose: () => void) {
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  useEffect(() => {
    const id = ++layers
    let pushed = false
    let byBack = false
    // (a moment later: React may run this twice in a row while developing, and then only one step is wanted)
    const push = setTimeout(() => { pushed = true; history.pushState({ ...stateNow(), gcLayer: id }, '') }, 0)
    const onPop = () => { if (pushed && stateNow().gcLayer !== id) { byBack = true; close.current() } }
    window.addEventListener('popstate', onPop)
    return () => {
      clearTimeout(push)
      window.removeEventListener('popstate', onPop)
      if (pushed && !byBack) setTimeout(() => { if (stateNow().gcLayer === id) history.back() }, 0)
    }
  }, [])
}

/**
 * Keeps the browser's history in step with the screen: each change of place is a step, and Back / Forward set the place again.
 * `place` is whatever identifies the place (kept small: it is stored in the history entry); `go` sets it.
 */
export function usePlaceHistory<P>(place: P, go: (p: P) => void) {
  const key = JSON.stringify(place)
  const last = useRef(key)
  const goRef = useRef(go)
  useEffect(() => { goRef.current = go })
  useEffect(() => { history.replaceState({ ...stateNow(), gcPlace: place }, '') }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (key === last.current) return
    last.current = key
    history.pushState({ gcPlace: place }, '')
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const p = (e.state as Step | null)?.gcPlace as P | undefined
      if (p === undefined) return
      last.current = JSON.stringify(p) // (so that setting it does not take another step)
      goRef.current(p)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
}
