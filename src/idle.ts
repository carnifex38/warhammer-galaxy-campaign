// Helpers that keep heavy start-up work from ever blocking the screen: do it only when the browser is idle,
// and in slices a few milliseconds long, so typing, tapping and animation stay smooth (for example on the login screen).

/** Run a function when the browser has nothing better to do (or after `timeout` ms at the latest). */
function whenIdle(fn: () => void, timeout = 2000) {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout })
  else window.setTimeout(fn, 200)
}

/** A promise that resolves when the browser is idle. */
export const idle = (timeout = 2000) => new Promise<void>((resolve) => whenIdle(resolve, timeout))

const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null

/** Give the browser a chance to draw a frame and handle input, then carry on. */
function yieldToMain(): Promise<void> {
  if (!channel) return new Promise((r) => setTimeout(r, 0))
  return new Promise((resolve) => {
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(0)
  })
}

/**
 * Do `total` small steps, in order, but never hold the main thread for more than `budgetMs` at a time.
 * Between slices the browser can draw and respond to the user.
 */
export async function sliced(total: number, step: (i: number) => void, budgetMs = 4) {
  let i = 0
  while (i < total) {
    const start = performance.now()
    while (i < total && performance.now() - start < budgetMs) step(i++)
    if (i < total) await yieldToMain()
  }
}
