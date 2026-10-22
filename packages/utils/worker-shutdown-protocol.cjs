exports.SHUTDOWN_MESSAGE_TYPE = 'geekgeekrun:shutdown'

// Windows kill('SIGTERM') is abrupt. Let the owned Node/Electron child save and
// close first; the caller retains its deadline and process-tree force fallback.
exports.requestGracefulStop = (child, { platform = process.platform } = {}) => {
  if (!child || child.exitCode != null || child.signalCode != null) return false
  const signal = () => {
    if (platform !== 'win32' && child.exitCode == null && child.signalCode == null) child.kill('SIGTERM')
  }
  if (child.connected && typeof child.send === 'function') {
    try {
      child.send({ type: exports.SHUTDOWN_MESSAGE_TYPE }, error => { if (error) signal() })
      return true
    } catch { /* Keep the caller's force timeout when the channel has closed. */ }
  }
  signal()
  return false
}
