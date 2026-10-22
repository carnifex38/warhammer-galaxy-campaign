import { getLoad } from './galaxy/loading'
import { DEV_TOOLS } from './auth' // DEV-TOOLS

// A stutter finder, for the developer tools only (DEV-TOOLS): it needs the dev link (`?dev`) as well as `?perf` on the address, so
// nobody else ever sees it. Open the app with `?dev&perf` and it watches every frame: any frame
// that takes over 50 ms is written down with what the start-up was doing at that moment (which planet it was preparing, or that
// it had finished) and whether the player was moving the camera. A small panel in the corner shows the worst ones, so a tester
// can send a screenshot. `__perf.report()` in the console gives the same as text.

interface Stall { at: number; ms: number; phase: string; moving: boolean }

export function startPerf() {
  if (!DEV_TOOLS) return
  // remembered for the tab, because the app sometimes tidies the address (dropping `?perf`) or reloads itself
  try { if (new URLSearchParams(location.search).has('perf')) sessionStorage.setItem('galaxy-perf', '1') } catch { /* not remembered */ }
  let on = new URLSearchParams(location.search).has('perf')
  try { on ||= !!sessionStorage.getItem('galaxy-perf') } catch { /* not remembered */ }
  if (!on) return
  const stalls: Stall[] = []
  let frames = 0
  let last = performance.now()
  let lastMove = -1e9
  const t0 = last
  const move = () => { lastMove = performance.now() }
  for (const ev of ['pointermove', 'wheel', 'pointerdown', 'touchmove']) addEventListener(ev, move, { passive: true })

  const phase = () => { const l = getLoad(); return l.done >= l.total ? 'loaded' : `${l.label} (${l.done}/${l.total})` }
  const tick = (now: number) => {
    const ms = now - last
    last = now
    frames++
    if (ms > 50 && frames > 2) stalls.push({ at: Math.round(now - t0), ms: Math.round(ms), phase: phase(), moving: now - lastMove < 400 })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  const text = () => {
    const during = stalls.filter((s) => s.phase !== 'loaded')
    const after = stalls.filter((s) => s.phase === 'loaded')
    const worst = [...stalls].sort((a, b) => b.ms - a.ms).slice(0, 8)
    const sum = (a: Stall[]) => a.reduce((n, s) => n + s.ms, 0)
    return [
      `perf  ${Math.round((performance.now() - t0) / 1000)}s  now: ${phase()}`,
      `stalls >50ms while loading: ${during.length} (${sum(during)} ms)   after: ${after.length} (${sum(after)} ms)`,
      `while moving: ${stalls.filter((s) => s.moving).length} of ${stalls.length}`,
      'worst:',
      ...worst.map((s) => `  ${String(s.ms).padStart(5)} ms  @${(s.at / 1000).toFixed(1)}s  ${s.moving ? 'moving ' : 'still  '} ${s.phase}`),
    ].join('\n')
  }
  ;(window as unknown as { __perf: unknown }).__perf = { stalls, report: text }

  const box = document.createElement('pre')
  box.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99999;margin:0;padding:6px 8px;background:rgba(0,0,0,.78);color:#9dffb8;font:11px/1.35 ui-monospace,Consolas,monospace;pointer-events:none;border-radius:6px;max-width:92vw;white-space:pre-wrap'
  document.body.appendChild(box)
  setInterval(() => { box.textContent = text() }, 500)
}
