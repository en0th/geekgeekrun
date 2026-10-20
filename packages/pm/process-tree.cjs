const { execFile } = require('node:child_process')

// Used only after graceful termination timed out. Discover descendants while the owned
// worker is still alive, so browser groups cannot be orphaned by killing their parent first.
exports.forceStopOwnedWorker = async child => {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return
  if (process.platform === 'win32') {
    await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { timeout: 2000 }, () => resolve()))
  } else {
    const output = await new Promise(resolve => execFile('ps', ['-axo', 'pid=,ppid=,pgid='],
      { timeout: 1000, maxBuffer: 4 * 1024 * 1024 }, (error, text) => resolve(error ? '' : text)))
    if (child.exitCode != null || child.signalCode != null) return
    const rows = String(output).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number))
    const owned = new Set([child.pid])
    for (;;) {
      const more = rows.filter(([pid, parent]) => owned.has(parent) && !owned.has(pid))
      if (!more.length) break
      for (const [pid] of more) owned.add(pid)
    }
    for (const [pid,, group] of rows.filter(([pid]) => pid !== child.pid && owned.has(pid)).reverse()) {
      try { process.kill(pid === group ? -pid : pid, 'SIGKILL') } catch {}
    }
  }
  if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
}
