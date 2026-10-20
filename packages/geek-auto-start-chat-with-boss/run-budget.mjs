import { performance } from 'node:perf_hooks'
import { normalizeRunBudget } from './run-settings.mjs'

export const RUN_BUDGET_TICK_MS = 1000
export function budgetStateError(detail = '运行预算记录无法读写，请检查数据目录或从备份恢复；累计用量没有清零') {
  return Object.assign(new Error('AUTO_CHAT_RUN_BUDGET_UNAVAILABLE'), { detail })
}
export function normalizeBudgetUsage(state) {
  if (state === undefined || state === null) return { requests: 0, detailRequests: 0, activeMs: 0 }
  if (typeof state !== 'object' || Array.isArray(state)) throw budgetStateError()
  const result = {}
  for (const key of ['requests', 'detailRequests', 'activeMs']) {
    if (!Number.isSafeInteger(state[key]) || state[key] < 0) throw budgetStateError()
    result[key] = state[key]
  }
  if (result.detailRequests > result.requests) throw budgetStateError()
  return result
}

/** One logical run, across browser retries and worker restarts. Limits never reset usage. */
export function createRunBudget({ limits, saved, seed, legacy = false, persist = () => {},
  onUpdate = () => {}, now = () => performance.now(), setTimer = setInterval, clearTimer = clearInterval } = {}) {
  limits = normalizeRunBudget(limits)
  for (const state of [saved, seed]) if (state != null && (!state.usage || typeof state.usage !== 'object')) throw budgetStateError()
  const disk = normalizeBudgetUsage(saved?.usage), snapshot = normalizeBudgetUsage(seed?.usage)
  const usage = Object.fromEntries(Object.keys(disk).map(key => [key, Math.max(disk[key], snapshot[key])]))
  const baselineUnknown = Boolean(saved?.baselineUnknown || seed?.baselineUnknown || (legacy && !saved && !seed))
  let started = null, timer = null, failure = null
  let rejectFailure
  const failed = new Promise((_, reject) => { rejectFailure = reject })
  failed.catch(() => {})
  const elapsed = () => usage.activeMs + (started === null ? 0 : Math.max(0, Math.floor(now() - started)))
  const status = () => ({ usage: { ...usage, activeMs: elapsed() }, limits: { ...limits }, baselineUnknown,
    running: started !== null, stopped: Boolean(failure) })
  const emit = () => { try { onUpdate(status()) } catch { /* Delivery cannot weaken the budget. */ } }
  function save() {
    // Reserve the next heartbeat's time before work. An unclean exit can overcount up
    // to one second, but cannot give that time back on restart. Normal pause saves exact time.
    const state = { usage: { ...usage, activeMs: elapsed() + (started === null ? 0 : RUN_BUDGET_TICK_MS) }, baselineUnknown }
    try { persist(state) } catch { throw stop(budgetStateError()) }
  }
  function stop(error) {
    if (failure) return failure
    failure = error
    usage.activeMs = elapsed()
    started = null
    if (timer !== null) clearTimer(timer)
    timer = null
    try { persist({ usage: { ...usage }, baselineUnknown }) } catch { failure = budgetStateError() }
    rejectFailure(failure)
    emit()
    return failure
  }
  function exceeded(key) {
    const label = { requests: '岗位接口请求', detailRequests: '详情请求', activeMinutes: '累计运行时长' }[key]
    const amount = key === 'activeMinutes' ? `${limits[key]} 分钟` : `${limits[key]} 次`
    return stop(Object.assign(new Error('AUTO_CHAT_RUN_BUDGET_EXCEEDED'), {
      budgetKey: key, detail: `已达到${label}上限（${amount}），任务已暂停并保留进度；调整上限后可恢复，已用额度继续累计`
    }))
  }
  function assertTime() {
    if (failure) throw failure
    if (limits.activeMinutes > 0 && elapsed() >= limits.activeMinutes * 60000) throw exceeded('activeMinutes')
  }
  function checkpoint() {
    assertTime()
    for (const key of ['requests', 'detailRequests']) if (limits[key] > 0 && usage[key] >= limits[key]) throw exceeded(key)
  }
  return {
    snapshot: status,
    assertTime,
    checkpoint,
    fail: stop,
    reserveRequest(kind) {
      checkpoint()
      if (!['list', 'detail'].includes(kind)) throw new Error('Unknown job request kind')
      if (limits.requests > 0 && usage.requests >= limits.requests) throw exceeded('requests')
      if (kind === 'detail' && limits.detailRequests > 0 && usage.detailRequests >= limits.detailRequests) throw exceeded('detailRequests')
      usage.requests++
      if (kind === 'detail') usage.detailRequests++
      save() // must finish before Fetch.continueRequest
      assertTime() // fsync / a sharing-violation retry may have crossed the time limit
      emit()
    },
    resume() {
      checkpoint()
      if (started !== null) return
      started = now()
      save()
      timer = setTimer(() => {
        try { assertTime(); save(); emit() } catch (error) { stop(error) }
      }, RUN_BUDGET_TICK_MS)
      timer?.unref?.()
      emit()
    },
    pause() {
      if (started === null) return
      usage.activeMs = elapsed()
      started = null
      if (timer !== null) clearTimer(timer)
      timer = null
      save()
      emit()
    },
    async guard(action) {
      assertTime()
      return Promise.race([Promise.resolve().then(() => { assertTime(); return action() }), failed])
    }
  }
}
