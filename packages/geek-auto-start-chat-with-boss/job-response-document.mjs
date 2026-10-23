// Full-document commits replace the network body cache. SPA changes and child
// frames do not. Tracking is optional: a failure retains the strict response guard.
export function watchJobDocument(page, { onNavigation = () => {}, timeoutMs = 5000 } = {}) {
  let generation = 0, session, loaderId, active = true, initialized = false, timer
  const navigated = ({ frame }) => {
    if (!active || frame?.parentId || !frame?.loaderId) return
    if (!initialized) { loaderId = frame.loaderId; return }
    if (frame.loaderId === loaderId) return
    loaderId = frame.loaderId
    onNavigation(++generation)
  }
  const detach = () => {
    session?.off('Page.frameNavigated', navigated)
    void session?.detach().catch(() => {})
  }
  const setup = (async () => {
    if (typeof page.createCDPSession !== 'function') return
    const created = await page.createCDPSession()
    if (!active) { await created.detach().catch(() => {}); return }
    session = created
    session.on('Page.frameNavigated', navigated)
    await session.send('Page.enable', {}, { timeout: timeoutMs })
    const tree = await session.send('Page.getFrameTree', {}, { timeout: timeoutMs })
    if (!active) return
    loaderId ||= tree.frameTree?.frame?.loaderId
    initialized = Boolean(loaderId)
  })().catch(() => { active = false; detach() })
  const ready = Promise.race([setup, new Promise(resolve => {
    timer = setTimeout(() => { active = false; detach(); resolve() }, timeoutMs)
  })]).finally(() => clearTimeout(timer))
  return {
    get generation() { return generation },
    ready,
    dispose() { active = false; detach() },
  }
}
