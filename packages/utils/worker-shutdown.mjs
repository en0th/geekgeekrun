// Finish owned resources and the final checkpoint before terminating a task process.
import { SHUTDOWN_MESSAGE_TYPE } from './worker-shutdown-protocol.cjs'
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
  const message = value => { if (value?.type === SHUTDOWN_MESSAGE_TYPE) listener() }
  host.on('message', message)
  return { stop, isStopping: () => stopping,
    dispose: () => { for (const event of events) host.off(event, listener); host.off('message', message) } }
}
