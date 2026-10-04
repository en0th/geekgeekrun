// Every process (UI, daemon, tasks) writes its console output to one daily log file,
// filtered by the level chosen in the log settings (config/log.json).
import path from 'node:path'
import fs from 'node:fs'
import { inspect } from 'node:util'
import dayjs from 'dayjs'
import { runtimeFolderPath } from '@geekgeekrun/geek-auto-start-chat-with-boss/data-location.mjs'
import {
  LOG_SETTINGS_FILE,
  expiredLogFiles,
  logFileName,
  readLogSettings,
  shouldWriteLog
} from '../../common/log-settings.mjs'

export const logDirPath = path.join(runtimeFolderPath, 'log')
const settingsPath = path.join(runtimeFolderPath, 'config', LOG_SETTINGS_FILE)
// how often a running process looks for changed settings
const SETTINGS_RECHECK_MS = 3000

type Level = 'trace' | 'debug' | 'info' | 'warning' | 'error'

function loadSettings() {
  try {
    return readLogSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf8')))
  } catch {
    return readLogSettings(null)
  }
}

const stringify = (arg: unknown) =>
  typeof arg === 'string' ? arg : inspect(arg, { depth: 4, breakLength: Infinity })

export default function overrideConsole() {
  const origin = {
    trace: console.trace.bind(console),
    debug: console.debug.bind(console),
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }

  let settings = loadSettings()
  let settingsMtime = 0
  let settingsCheckedAt = Date.now()
  const currentSettings = () => {
    if (Date.now() - settingsCheckedAt > SETTINGS_RECHECK_MS) {
      settingsCheckedAt = Date.now()
      try {
        const mtime = fs.statSync(settingsPath).mtimeMs
        if (mtime !== settingsMtime) {
          settingsMtime = mtime
          settings = loadSettings()
        }
      } catch {
        settings = readLogSettings(null)
      }
    }
    return settings
  }

  let stream: fs.WriteStream | null = null
  let streamFile = ''
  const fileStream = () => {
    const name = logFileName(new Date())
    if (name !== streamFile) {
      stream?.end()
      fs.mkdirSync(logDirPath, { recursive: true })
      stream = fs.createWriteStream(path.join(logDirPath, name), { flags: 'a' })
      // a stream that fails (disk full, folder removed) must not take the process down
      stream.on('error', () => void 0)
      streamFile = name
    }
    return stream!
  }

  const write = (level: Level, args: unknown[], extra = '') => {
    const lineHead = `${dayjs().format('YYYY-MM-DD HH:mm:ss.SSS')} [${level}][PID=${process.pid}]`
    if (!shouldWriteLog(currentSettings(), level)) return lineHead
    try {
      fileStream().write([lineHead, ...args.map(stringify)].join(' ') + extra + '\n')
    } catch {
      // logging never breaks the caller
    }
    return lineHead
  }

  console.trace = (...args: unknown[]) => {
    const stack = (new Error().stack ?? '').split('\n').slice(2).join('\n')
    origin.debug(write('trace', args, '\n' + stack), ...args)
  }
  console.debug = (...args: unknown[]) => origin.debug(write('debug', args), ...args)
  console.log = (...args: unknown[]) => origin.log(write('info', args), ...args)
  console.info = (...args: unknown[]) => origin.info(write('info', args), ...args)
  console.warn = (...args: unknown[]) => origin.warn(write('warning', args), ...args)
  console.error = (...args: unknown[]) => origin.error(write('error', args), ...args)

  // one process is enough to tidy up; the UI process starts first and runs longest
  if (!process.argv.some((it) => it.startsWith('--mode='))) {
    cleanupLogs()
    setInterval(() => cleanupLogs(), 6 * 60 * 60 * 1000).unref?.()
  }
}

/** removes daily log files older than the retention setting */
export function cleanupLogs(retentionDays = loadSettings().retentionDays) {
  try {
    for (const name of expiredLogFiles(fs.readdirSync(logDirPath), new Date(), retentionDays))
      fs.rmSync(path.join(logDirPath, name), { force: true })
  } catch {
    // no log folder yet
  }
}
