export const RUN_POLICY_FILE = 'run-policy.json'
// Product protection ceiling for the account rule supplied by the user.
// This is not a query of BOSS allowance; the platform can stop earlier.
export const ACCOUNT_DAILY_CHAT_LIMIT = 150
export const beijingDay = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10)
export const RUN_PROFILES = Object.freeze({
  safe: { label: '安全模式', description: '较低运行强度，适合日常使用；不保证免于平台验证。', listSeconds: 8, detailSeconds: 3, budget: { requests: 500, detailRequests: 200, activeMinutes: 120 } },
  deep: { label: '深度模式', description: '保持较低强度，允许更长时间和更多覆盖，不放宽求职条件。', listSeconds: 8, detailSeconds: 3, budget: { requests: 1000, detailRequests: 400, activeMinutes: 240 } },
  fast: { label: '极速模式', description: '较高运行强度可能增加验证、限流或账号限制风险；仍保留运行保护。', listSeconds: 5, detailSeconds: 2, budget: { requests: 500, detailRequests: 200, activeMinutes: 120 } }
})
export const DEFAULT_RUN_POLICY = Object.freeze({ version: 1, profile: 'safe', dailyLimit: 100,
  rest: { enabled: true, workMinutes: 30, restMinutes: 10 } })
const object = value => value && typeof value === 'object' && !Array.isArray(value)
export function dailyTargetError(value) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') return '请填写每日自动目标（1—150之间的整数）。'
  const target = Number(value)
  if (!Number.isSafeInteger(target) || (typeof value === 'string' && !/^-?\d+$/.test(value.trim()))) return '每日自动目标只能填写1—150之间的整数，不能填写小数或其他字符。'
  if (target < 1) return '每日目标至少为1人；0或负数没有可用的自动打招呼数量。请输入1—150之间的整数。'
  if (target > ACCOUNT_DAILY_CHAT_LIMIT) return '单个账号的每日自动保护上限为150人，多个账号分别累计。请输入1—150之间的整数。'
  return ''
}
function integer(value, fallback, min, max, label) {
  if (value == null || value === '') return fallback
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label}须为${min}—${max}之间的整数`)
  return n
}
export function normalizeRunPolicy(value, { legacy = false } = {}) {
  if (value == null) value = {}
  if (!object(value) || (value.version != null && value.version !== 1)) throw new Error('运行偏好配置无效，原配置已保留')
  const profile = value.profile ?? 'safe'
  if (typeof profile !== 'string' || !Object.hasOwn(RUN_PROFILES, profile)) throw new Error('请选择有效的运行模式')
  const rest = value.rest ?? {}
  if (!object(rest) || (rest.enabled != null && typeof rest.enabled !== 'boolean')) throw new Error('定时休息配置无效')
  if (!legacy && value.dailyLimit != null) {
    const error = dailyTargetError(value.dailyLimit)
    if (error) throw new Error(error)
  }
  const dailyLimit = integer(value.dailyLimit, 100, 1, legacy ? 1000 : ACCOUNT_DAILY_CHAT_LIMIT, '每日自动打招呼目标')
  return { version: 1, profile, dailyLimit: Math.min(dailyLimit, ACCOUNT_DAILY_CHAT_LIMIT), rest: {
    enabled: rest.enabled ?? true,
    workMinutes: integer(rest.workMinutes, 30, 1, 240, '连续运行时间'),
    restMinutes: integer(rest.restMinutes, 10, 1, 120, '休息时间')
  } }
}
export function migrateRunPolicy(legacy) {
  // Operation counts cannot honestly be converted into minutes. Preserve only
  // the user's enabled flag and valid rest duration; explain the new time basis.
  return normalizeRunPolicy({ rest: { enabled: typeof legacy?.pause === 'boolean' ? legacy.pause : true,
    restMinutes: Number.isInteger(legacy?.minutes) && legacy.minutes >= 1 && legacy.minutes <= 120 ? legacy.minutes : 10 } })
}
export function policyRunConfig(input) {
  const policy = normalizeRunPolicy(input), p = RUN_PROFILES[policy.profile]
  return { autoChatRunInBackground: true, autoChatRunPolicy: policy, autoChatTimedRest: policy.rest,
    autoChatRunBudget: { ...p.budget }, isSageTimeEnabled: false,
    jobListLoadWaitSeconds: p.listSeconds, jobDetailViewWaitSeconds: p.detailSeconds }
}
export function estimateRun(progress, target = 100) {
  const viewed = Number(progress?.viewed || 0), sent = Number(progress?.sent || 0)
  const elapsed = Number(progress?.elapsedWorkingMs ?? progress?.budget?.usage?.activeMs)
  if (viewed < 10 || !Number.isFinite(elapsed) || elapsed <= 0) return { ready: false, text: '处理满10个岗位后，根据实际速度估算耗时；不承诺成功打招呼数量。' }
  const minutes = elapsed / viewed * target / 60000
  return { ready: true, text: `按本次实际速度，再处理${target}个岗位约${Math.max(1, Math.floor(minutes * .8))}—${Math.max(2, Math.ceil(minutes * 1.3))}分钟；未来休息、验证和手动暂停需另计，不代表成功打招呼数量。`,
    sentRate: sent >= 5 ? sent / viewed : null }
}
