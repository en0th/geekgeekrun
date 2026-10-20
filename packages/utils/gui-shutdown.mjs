// Let workers persist checkpoints and close their browsers before the GUI disconnects.
export function installGuiShutdown({ app, stopOwned, disconnect, report = console.error }) {
  let requested = false, finished = false
  const beforeQuit = event => {
    if (finished) return
    event.preventDefault()
    if (requested) return
    requested = true
    void Promise.resolve().then(stopOwned).catch(report).finally(() => {
      finished = true
      disconnect()
      app.quit()
    })
  }
  app.on('before-quit', beforeQuit)
}
