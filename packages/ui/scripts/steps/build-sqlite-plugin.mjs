import childProcess from 'node:child_process'
import path from 'node:path'
import url from 'node:url'

export default function buildSqlitePlugin({ spawnSync = childProcess.spawnSync } = {}) {
  const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

  const sqlitePluginDirPath = path.join(__dirname, '../../../sqlite-plugin')
  const manager = process.env.npm_execpath
  const pinned = manager && /^pnpm(?:\.[cm]?js)?$/.test(path.basename(manager))
  const result = spawnSync(pinned ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    pinned ? [manager, 'run', 'build'] : ['run', 'build'], {
      cwd: sqlitePluginDirPath,
      stdio: 'inherit',
      shell: !pinned && process.platform === 'win32'
    })
  if (result.error) throw result.error
  if (result.signal || result.status !== 0) {
    const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 'unknown'}`
    throw new Error(`SQLite plugin build failed (${reason})`)
  }
}
