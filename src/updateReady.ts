import { useEffect, useState } from 'react'

/**
 * True once a newer version of the site has taken over in the background while this page was open. The old page can no longer
 * download some of its own screens then, so the player is offered a reload (not forced: they may be in the middle of editing).
 */
export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const hadOne = !!navigator.serviceWorker.controller // the very first install is not an update
    const onChange = () => { if (hadOne) setReady(true) }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange)
  }, [])
  return ready
}
