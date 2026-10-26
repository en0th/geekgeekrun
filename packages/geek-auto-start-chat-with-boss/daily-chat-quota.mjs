import fs from 'node:fs'
import path from 'node:path'
import { writeJsonAtomicSync } from '@geekgeekrun/utils/atomic-json.mjs'
import { ACCOUNT_DAILY_CHAT_LIMIT, beijingDay } from './run-policy.mjs'
export const DAILY_QUOTA_FILE = 'daily-chat-usage.json'
export const dayKey = beijingDay
export const quotaError = (kind, detail) => Object.assign(new Error(`AUTO_CHAT_DAILY_${kind}`), { detail })
const object = v => v && typeof v === 'object' && !Array.isArray(v)
const positive = n => Number.isSafeInteger(n) && n >= 0
const effectiveLimit = (limit, extra) => {
  if (!Number.isSafeInteger(limit) || limit < 1) throw Error('每日自动打招呼目标无效')
  return Math.min(ACCOUNT_DAILY_CHAT_LIMIT, limit + extra)
}
export function createDailyQuotaStore(folder, { now = Date.now, write = writeJsonAtomicSync } = {}) {
  const file = path.join(folder, DAILY_QUOTA_FILE)
  function read() {
    try {
      if (!fs.existsSync(file)) return { version: 1, accounts: {} }
      const state = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (state.version !== 1 || !object(state.accounts)) throw Error('Invalid')
      for (const days of Object.values(state.accounts)) {
        if (!object(days)) throw Error('Invalid')
        for (const d of Object.values(days)) {
          if (!object(d) || !positive(d.confirmed) || !positive(d.extra) || !object(d.pending) ||
            typeof d.platformExhausted !== 'boolean' || Object.values(d.pending).some(v => typeof v !== 'string')) throw Error('Invalid')
        }
      }
      return state
    } catch { throw quotaError('UNAVAILABLE', '每日数量记录无法读取，原文件已保留。请检查数据目录或恢复备份，不能清零后继续发送。') }
  }
  function access(accountId, mutate) {
    if (typeof accountId !== 'string' || !accountId.trim() || ['__proto__', 'constructor', 'prototype'].includes(accountId)) throw Error('LOGIN_STATUS_UNKNOWN')
    let lock
    if (mutate) {
      try { fs.mkdirSync(folder, { recursive: true }); lock = fs.openSync(file + '.lock', 'wx') }
      catch { throw quotaError('UNAVAILABLE', '每日数量正在保存或文件锁不可用，请稍后重试；不会清零或继续发送。') }
    }
    try {
      const state = read(), account = accountId.trim(), day = dayKey(now())
      const days = Object.hasOwn(state.accounts, account) ? state.accounts[account] : (state.accounts[account] = {})
      const data = days[day] ||= { confirmed: 0, extra: 0, pending: {}, platformExhausted: false, seeded: false }
      if (mutate) {
        mutate(data, days)
        try { write(file, state) }
        catch { throw quotaError('UNAVAILABLE', '每日数量无法保存，任务已停止；请检查数据目录，不会继续发送或清零。') }
      }
      return { accountId: account, day, ...data, pendingCount: Object.keys(data.pending).length }
    } finally { if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(file + '.lock') } }
  }
  const status = (account, limit) => {
    const s = access(account)
    const target = effectiveLimit(limit, s.extra)
    return { ...s, limit: target, remaining: Math.max(0, target - s.confirmed - s.pendingCount) }
  }
  return {
    status,
    seed(account, confirmed) { if (!positive(confirmed)) throw Error('Invalid confirmed count'); return access(account, d => { d.confirmed = Math.max(d.confirmed, confirmed); d.seeded = true }) },
    assert(account, limit) {
      const s = status(account, limit)
      if (s.platformExhausted) throw quotaError('PLATFORM_LIMIT', 'BOSS已提示该账号今日沟通额度用尽，自动打招呼已停止，结果和进度已保留。请在平台额度恢复后再运行。')
      if (s.pendingCount) throw quotaError('UNCONFIRMED', '有一次开聊结果尚未确认，请先在BOSS中核对。为避免重复发送，不能直接继续或清零人数。')
      if (!s.remaining) throw quotaError('GOAL_REACHED', `本软件今日已自动打招呼${s.confirmed}人，已暂停并保留进度。` + (s.limit >= ACCOUNT_DAILY_CHAT_LIMIT ? `已达到该账号今日${ACCOUNT_DAILY_CHAT_LIMIT}人的软件保护上限，可查看结果，明日再运行。` : `达到你设置的${s.limit}人目标，可查看结果或仅为今天追加数量。`))
      return s
    },
    reserve(account, limit, operation) {
      this.assert(account, limit)
      return access(account, d => {
        if (d.platformExhausted) throw quotaError('PLATFORM_LIMIT', 'BOSS今日沟通额度已用尽，请在平台额度恢复后再运行。')
        if (d.confirmed + Object.keys(d.pending).length >= effectiveLimit(limit, d.extra)) throw quotaError('GOAL_REACHED', '今日自动打招呼目标已达到，请查看结果')
        if (Object.keys(d.pending).length) throw quotaError('UNCONFIRMED', '开聊结果待确认，请先核对')
        Object.defineProperty(d.pending, operation, { value: new Date(now()).toISOString(), enumerable: true, configurable: true, writable: true })
      })
    },
    confirm(account, operation) { return access(account, (d, days) => {
      let found = false
      for (const day of Object.values(days)) if (Object.hasOwn(day.pending, operation)) { delete day.pending[operation]; found = true }
      if (found) d.confirmed++
    }) },
    rejected(account, operation) { return access(account, (_d, days) => { for (const d of Object.values(days)) delete d.pending[operation] }) },
    platformExhausted(account, operation) { return access(account, (d, days) => { for (const day of Object.values(days)) delete day.pending[operation]; d.platformExhausted = true }) },
    acknowledgePending(account, expectedCount) {
      return access(account, d => {
        const count = Object.keys(d.pending).length
        if (!count || count !== expectedCount) throw Error('待核对记录已变化，请重新读取')
        // Manual acknowledgement never retries a send or refunds a reservation.
        d.confirmed += count; d.pending = {}
      })
    },
    addToday(account, amount, limit = 100) {
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > ACCOUNT_DAILY_CHAT_LIMIT) throw Error(`追加人数须为1—${ACCOUNT_DAILY_CHAT_LIMIT}之间的整数`)
      return access(account, d => {
        if (d.platformExhausted) throw quotaError('PLATFORM_LIMIT', '平台今日额度已用尽，追加软件目标不能恢复平台额度。')
        if (Object.keys(d.pending).length) throw quotaError('UNCONFIRMED', '请先核对未确认的开聊结果，不能直接追加后继续。')
        const target = effectiveLimit(limit, d.extra)
        if (d.confirmed < target) throw Error('尚未达到今日自动目标，无需追加。')
        const baseline = Math.max(target, d.confirmed)
        if (baseline + amount > ACCOUNT_DAILY_CHAT_LIMIT) throw Error(`每个账号每日自动目标最多${ACCOUNT_DAILY_CHAT_LIMIT}人，不能继续追加。`)
        d.extra += baseline - target + amount
      })
    }
  }
}
