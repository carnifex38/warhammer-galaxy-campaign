import { useEffect, useState } from 'react'
import { watchServerLink } from './api'

// Keeping an open page on the version the server runs. Every live connection opens with `hello` naming the server's build
// (server/index.mjs); a page from another build updates itself after a deploy. The site is an installed app with its files kept
// for offline use, so a plain reload would bring the old version back: the page first asks its service worker to fetch the new
// files, and reloads once the new version has taken over. A page where the player has typed something (still on screen) is not
// reloaded under them: they get the Reload bar instead.

const SEEN_KEY = 'galaxy-reloaded-for'

/** Fields typed in on this page. Ones no longer on screen (the login form, a closed editor) are gone and do not count. */
const typedIn = new Set<EventTarget>()
document.addEventListener('input', (e) => { if (e.target) typedIn.add(e.target) }, true)
const hasTyping = () => [...typedIn].some((el) => el instanceof Node && el.isConnected)

/** Reloads now unless that could lose typing, or the page already reloaded for this build (then it asks instead of looping). */
function reloadOr(offer: () => void, build: string) {
  let tried = true
  try {
    tried = sessionStorage.getItem(SEEN_KEY) === build
    sessionStorage.setItem(SEEN_KEY, build)
  } catch { /* storage blocked: ask instead */ }
  if (hasTyping() || tried) offer()
  else location.reload()
}

/**
 * True when a newer version should be loaded but the page did not reload itself (the player has typed something), so the player
 * is offered a Reload button. Also covers the service worker updating the site in the background on its own.
 */
export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const offer = () => setReady(true)
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null
    const hadOne = !!sw?.controller // the very first install is not an update
    let wanted: string | null = null // the build the server runs, once it differs from this page's
    let fallback: number | undefined

    // a newer version has taken over: the old page can no longer download some of its own screens
    const onChange = () => {
      if (!hadOne && !wanted) return
      window.clearTimeout(fallback)
      reloadOr(offer, wanted ?? 'service-worker')
    }
    sw?.addEventListener('controllerchange', onChange)

    const stop = watchServerLink(({ build }) => {
      // the dev server always differs from the last build, and a build without git has no version to compare
      if (import.meta.env.DEV || !build || build === 'unknown' || __APP_VERSION__ === 'unknown' || build === __APP_VERSION__ || wanted === build) return
      wanted = build
      if (!sw?.controller) return reloadOr(offer, build) // no offline copy: a reload fetches the new version
      void sw.getRegistration().then((reg) => reg?.update()).catch(() => {})
      // the new version normally takes over within seconds (onChange). If it does not, reload anyway (once) or ask.
      fallback = window.setTimeout(() => reloadOr(offer, build), 20000)
    })
    return () => {
      stop()
      window.clearTimeout(fallback)
      sw?.removeEventListener('controllerchange', onChange)
    }
  }, [])
  return ready
}

/** True between the server saying it is restarting (a deploy) and it answering again. */
export function useServerRestarting(): boolean {
  const [restarting, setRestarting] = useState(false)
  useEffect(() => watchServerLink((l) => setRestarting(l.restarting)), [])
  return restarting
}
