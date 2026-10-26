// Continuous work and deliberate rest use a monotonic clock; no operation-count
// conversion and no dependence on the user's wall clock.
export function createTimedRest({ enabled = true, workMinutes = 30, restMinutes = 10,
  now = () => performance.now(), sleep, onEnter = async () => {}, onExit = async () => {} }) {
  let since = null, resting = false
  return async function checkpoint() {
    if (since === null) since = now()
    if (!enabled || resting || now() - since < workMinutes * 60000) return
    resting = true
    try {
      await onEnter({ until: Date.now() + restMinutes * 60000, minutes: restMinutes })
      await sleep(restMinutes * 60000)
      since = now()
      await onExit()
    } finally { resting = false }
  }
}
