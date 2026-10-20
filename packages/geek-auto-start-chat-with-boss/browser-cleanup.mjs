// Only accepts the Browser returned by this task's puppeteer.launch(). Attached browsers
// have no child process and are never killed by PID. Owned Chrome has its own POSIX group.
export async function closeOwnedBrowser(browser, { timeoutMs = 5000, kill = process.kill.bind(process) } = {}) {
  if (!browser) return
  const child = browser.process?.()
  let timer
  const finished = await Promise.race([
    Promise.resolve().then(() => browser.close()).then(() => true, () => false),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) }),
  ])
  clearTimeout(timer)
  if (finished || !child?.pid || child.exitCode != null || child.signalCode != null) return
  try {
    if (process.platform !== 'win32') kill(-child.pid, 'SIGKILL')
    else child.kill('SIGKILL')
  } catch { try { child.kill('SIGKILL') } catch {} }
  if (child.exitCode != null || child.signalCode != null) return
  await new Promise(resolve => {
    const done = () => { clearTimeout(wait); child.off('exit', done); resolve() }
    const wait = setTimeout(done, 1000)
    child.once('exit', done)
  })
}
