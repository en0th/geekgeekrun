import { app, Notification } from 'electron'
import { readConfigFile, storageFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { createScheduledRunStore, createScheduleRunner } from '@geekgeekrun/geek-auto-start-chat-with-boss/scheduled-runs.mjs'
import { normalizeJobSources } from '@geekgeekrun/geek-auto-start-chat-with-boss/search-source.mjs'
import { validateJobFilterConfig } from '@geekgeekrun/geek-auto-start-chat-with-boss/job-filter-config.mjs'
import { withGlobalRunPolicy } from './run-policy'
import { checkBossLoginStatus } from './boss-login-check'
import { getLastUsedAndAvailableBrowser } from '../flow/DOWNLOAD_DEPENDENCIES/utils/browser-history'
import { sendToDaemon, daemonEE } from '../flow/OPEN_SETTING_WINDOW/connect-to-daemon'
import { runCommon } from './run-common'
import { mainWindow } from '../window/mainWindow'
import { sendToast } from '../utils/toast'
import { readAutoChatResume } from './task-resume'
import { checkpointRecovery } from '../../common/task-recovery.mjs'
const store = () => createScheduledRunStore(storageFilePath)

export function notifyRunStatus(title: string, body: string) {
  try { sendToast({ type: 'info', title, message: body }) } catch { /* status remains persisted */ }
  if (!Notification.isSupported()) return
  try {
    const notice = new Notification({ title, body })
    notice.on('click', () => {
      mainWindow?.restore(); mainWindow?.show(); mainWindow?.focus()
      mainWindow?.webContents.send('navigate-task-list')
    })
    notice.show()
  } catch { /* In-app status is always available even when OS notifications are denied. */ }
}
async function identity(expected?: string) {
  const login = await checkBossLoginStatus()
  if (login.status !== 'valid' || !login.accountId) throw Error('BOSS登录未确认，请登录后重新设置定时启动')
  if (expected && login.accountId !== expected) throw Error('当前BOSS账号与定时启动绑定的账号不同，未启动；请切回原账号或重新设置定时启动')
  if (!await getLastUsedAndAvailableBrowser()) throw Error('浏览器未配置或已不可用，请检查浏览器设置')
  return login.accountId
}
export function listScheduledRuns() { return store().list() }
export function cancelScheduledRun(id: string) { store().cancel(id); return store().list() }
export async function scheduleJobRun(at: number) {
  const accountId = await identity()
  const config = withGlobalRunPolicy(Object.fromEntries(['boss.json', 'common-job-condition-config.json', 'target-company-list.json'].map(name => [name, readConfigFile(name)])))
  normalizeJobSources(config['boss.json'].jobSourceList)
  validateJobFilterConfig(config['boss.json'])
  store().create(at, accountId, config)
  return store().list()
}
export function startScheduledRuns() {
  const noticed = new Set<string>()
  daemonEE.on('message', (message: any) => {
    if (message.type !== 'worker-to-gui-message' || message.data?.type !== 'task-progress') return
    const { progress, runRecordId } = message.data
    if (!['blocked', 'paused', 'resting'].includes(progress?.state) || !progress.detail) return
    const key = `${runRecordId}:${progress.state}:${progress.restUntil || ''}:${progress.detail}`
    if (noticed.has(key)) return
    noticed.add(key)
    notifyRunStatus(progress.state === 'resting' ? '找岗位任务正在休息' : progress.state === 'paused' ? '找岗位任务等待验证' : /额度.*用尽/.test(progress.detail) ? '今日沟通额度已用尽' : '找岗位任务需要处理', progress.detail)
  })
  const jobs = store()
  try { for (const item of jobs.recoverOnOpen()) notifyRunStatus('定时启动需要处理', item.detail) }
  catch (error) { notifyRunStatus('定时启动记录无法读取', (error as Error).message); return }
  const tick = createScheduleRunner({ store: jobs,
    busy: async () => {
      const status = await sendToDaemon({ type: 'get-status' }, { needCallback: true }) as any
      if (!status) throw Error('任务服务尚未连接')
      return [...(status.workers || []), ...(status.queue || [])].some(item => item.workerId === 'geekAutoStartWithBossMain')
    },
    start: async (item) => {
      const checkpoint = readAutoChatResume({ strict: true })
      if (checkpoint && checkpointRecovery(checkpoint).reason !== 'completed') throw Error('已有暂停或待核对的找岗位任务，请先继续或结束原任务，再重新设置定时启动；未替换原进度。')
      const accountId = await identity(item.accountId)
      return runCommon({ mode: 'geekAutoStartWithBossMain', capturedConfig: item.config, expectedAccountId: accountId })
    }, notify: notifyRunStatus })
  let lastError = ''
  const timer = setInterval(() => { void tick().catch(error => { if (lastError !== error.message) { lastError = error.message; notifyRunStatus('定时启动暂未执行', error.message) } }) }, 5000)
  timer.unref()
  app.once('before-quit', () => clearInterval(timer))
}
