// Finish owned resources and the final checkpoint before terminating a task process.
export function installWorkerShutdown({ close, save = () => {}, host = process, report = console.error }) {
  let stopping = false, pending
  const stop = () => {
    if (pending) return pending
    stopping = true
    const capture = () => { try { save() } catch (error) { report(error) } }
    pending = Promise.resolve().then(async () => {
      capture()
      try { await close() } catch (error) { report(error) }
      capture()
      host.exit(0)
    })
    return pending
  }
  const listener = () => { void stop() }
  const events = ['SIGTERM', 'SIGINT', 'SIGHUP', 'disconnect']
  for (const event of events) host.on(event, listener)
  return { stop, isStopping: () => stopping,
    dispose: () => { for (const event of events) host.off(event, listener) } }
}
