import { setTimeout } from 'node:timers/promises'

let controller
export function beginBrowserAttempt() { controller = new AbortController() }
export function abortBrowserAttempt() { controller?.abort() }
// Closing an old attempt cancels its waits, including a long timed rest.
export async function sleep(ms) {
  try { await setTimeout(ms, undefined, { signal: controller?.signal }) }
  catch (error) { if (error.name === 'AbortError') throw new Error('AUTO_CHAT_ATTEMPT_CLOSED'); throw error }
}
export function sleepWithRandomDelay(base) { return sleep(base + Math.random() * 1000) }
