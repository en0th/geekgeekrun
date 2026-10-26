import { readConfigFile, writeConfigFile, storageFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { RUN_POLICY_FILE, normalizeRunPolicy, migrateRunPolicy, policyRunConfig } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-policy.mjs'
import { RUN_PACE_FILE, runPaceFromBossConfig } from '@geekgeekrun/geek-auto-start-chat-with-boss/run-settings.mjs'
import { createDailyQuotaStore, dayKey } from '@geekgeekrun/geek-auto-start-chat-with-boss/daily-chat-quota.mjs'
import { checkBossLoginStatus } from './boss-login-check'
import { sendToDaemon } from '../flow/OPEN_SETTING_WINDOW/connect-to-daemon'

export function readGlobalRunPolicy() {
  const saved = readConfigFile(RUN_POLICY_FILE)
  return saved ? normalizeRunPolicy(saved, { legacy: true }) : migrateRunPolicy(readConfigFile(RUN_PACE_FILE) || runPaceFromBossConfig(readConfigFile('boss.json')))
}
export async function saveGlobalRunPolicy(value: unknown) {
  const policy = normalizeRunPolicy(value)
  await writeConfigFile(RUN_POLICY_FILE, policy)
  return policy
}
export function withGlobalRunPolicy(config: Record<string, any>) {
  return { ...config, 'boss.json': { ...config['boss.json'], ...policyRunConfig(readGlobalRunPolicy()) } }
}
export async function dailyQuotaInfo() {
  const login = await checkBossLoginStatus()
  if (login.status !== 'valid' || !login.accountId) return { available: false, detail: '登录并验证当前BOSS账号后显示本软件今日累计。' }
  const policy = readGlobalRunPolicy()
  return { available: true, ...createDailyQuotaStore(storageFilePath).status(login.accountId, policy.dailyLimit) }
}
export async function addDailyQuota(amount: number, expectedAccountId: string, expectedDay: string) {
  if (expectedDay !== dayKey()) throw Error('日期已变化，请重新读取今日数量再追加。')
  const login = await checkBossLoginStatus()
  if (login.status !== 'valid' || !login.accountId || login.accountId !== expectedAccountId) throw Error('账号已变化或尚未验证，请重新读取今日数量后操作。')
  if (expectedDay !== dayKey()) throw Error('日期已变化，请重新读取今日数量再追加。')
  createDailyQuotaStore(storageFilePath).addToday(login.accountId, amount, readGlobalRunPolicy().dailyLimit)
  return { available: true, ...createDailyQuotaStore(storageFilePath).status(login.accountId, readGlobalRunPolicy().dailyLimit) }
}
export async function acknowledgeDailyPending(expectedAccountId: string, expectedDay: string, expectedCount: number) {
  const status = await sendToDaemon({ type: 'get-status' }, { needCallback: true }) as { workers?: { workerId: string }[]; queue?: { workerId: string }[] } | undefined
  if (!status || [...(status.workers || []), ...(status.queue || [])].some(task => task.workerId === 'geekAutoStartWithBossMain')) throw Error('请先暂停找岗位任务，确认已停止发送后再核对。')
  if (expectedDay !== dayKey()) throw Error('日期已变化，请重新读取今日数量。')
  const login = await checkBossLoginStatus()
  if (login.status !== 'valid' || login.accountId !== expectedAccountId) throw Error('账号已变化或尚未验证，请重新读取。')
  if (expectedDay !== dayKey()) throw Error('日期已变化，请重新读取今日数量。')
  createDailyQuotaStore(storageFilePath).acknowledgePending(expectedAccountId, expectedCount)
  return { available: true, ...createDailyQuotaStore(storageFilePath).status(expectedAccountId, readGlobalRunPolicy().dailyLimit) }
}
