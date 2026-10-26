import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeRunPolicy, policyRunConfig, migrateRunPolicy, estimateRun, ACCOUNT_DAILY_CHAT_LIMIT, beijingDay, dailyTargetError } from '../run-policy.mjs'
import { createTimedRest } from '../timed-rest.mjs'
import { createDailyQuotaStore } from '../daily-chat-quota.mjs'
test('policy profiles force background and distinguish coverage from speed', () => {
  const safe = policyRunConfig({}), deep = policyRunConfig({ profile: 'deep' }), fast = policyRunConfig({ profile: 'fast' })
  assert(safe.autoChatRunInBackground); assert.equal(safe.jobDetailViewWaitSeconds, deep.jobDetailViewWaitSeconds)
  assert(deep.autoChatRunBudget.detailRequests > safe.autoChatRunBudget.detailRequests)
  assert(fast.jobDetailViewWaitSeconds >= 2); assert(fast.autoChatRunBudget.requests > 0)
})
test('policy validates all user values and preserves understandable legacy rest values', () => {
  for (const v of [{ dailyLimit: -1 }, { dailyLimit: 0 }, { dailyLimit: true }, { profile: 'unknown' }, { rest: { workMinutes: 0 } }]) assert.throws(() => normalizeRunPolicy(v))
  assert.equal(migrateRunPolicy({ pause: false, actions: 800, minutes: 15 }).rest.enabled, false)
  assert.equal(migrateRunPolicy({ actions: 800, minutes: 15 }).rest.workMinutes, 30)
})

test('daily target is at most 150; legacy targets are bounded without losing rest or mode preferences', () => {
  assert.equal(ACCOUNT_DAILY_CHAT_LIMIT, 150)
  for (const dailyLimit of [151, 1000, 1.5, 'NaN']) assert.throws(() => normalizeRunPolicy({ dailyLimit }))
  const legacy = { dailyLimit: 999, profile: 'deep', rest: { enabled: false, workMinutes: 45, restMinutes: 15 } }
  const before = structuredClone(legacy), migrated = normalizeRunPolicy(legacy, { legacy: true })
  assert.equal(migrated.dailyLimit, 150); assert.deepEqual(migrated.rest, legacy.rest); assert.equal(migrated.profile, 'deep')
  assert.deepEqual(legacy, before); assert.equal(normalizeRunPolicy({ dailyLimit: 130 }, { legacy: true }).dailyLimit, 130)
  assert.equal(beijingDay(Date.parse('2026-10-26T16:00:00Z')), '2026-10-27')
})

test('daily target errors explain zero and over-limit values without silently normalizing user input', () => {
  assert.match(dailyTargetError('0'), /没有可用的自动打招呼数量/)
  assert.match(dailyTargetError('151'), /单个账号.*150.*分别累计/)
  for (const input of ['0', '151', '300', '-1', '1.5', '', 'abc', '1e2']) {
    assert(dailyTargetError(input))
    assert.throws(() => normalizeRunPolicy({ dailyLimit: input }))
  }
  assert.equal(dailyTargetError('1'), ''); assert.equal(dailyTargetError('150'), '')
})

test('all mode intervals and technical request budgets retain their intended values', () => {
  for (const [profile, list, detail, requests, details, minutes] of [
    ['safe', 8, 3, 500, 200, 120], ['deep', 8, 3, 1000, 400, 240], ['fast', 5, 2, 500, 200, 120],
  ]) {
    const c = policyRunConfig({ profile, dailyLimit: 130 })
    assert.equal(c.jobListLoadWaitSeconds, list); assert.equal(c.jobDetailViewWaitSeconds, detail)
    assert.deepEqual(c.autoChatRunBudget, { requests, detailRequests: details, activeMinutes: minutes })
    assert.equal(c.autoChatRunPolicy.dailyLimit, 130)
  }
})
test('time-based rest waits once and starts continuous-work timer after resting', async () => {
  let now = 0, calls = 0
  const rest = createTimedRest({ workMinutes: 1, restMinutes: 2, now: () => now, sleep: async ms => { assert.equal(ms, 120000); calls++; now += ms } })
  await rest(); now = 60000; await rest(); await rest(); assert.equal(calls, 1)
  now += 60000; await rest(); assert.equal(calls, 2)
})
test('cold estimates never invent a time or guaranteed send count', () => {
  assert.equal(estimateRun({ viewed: 9 }).ready, false)
  assert.equal(estimateRun({ viewed: 20, elapsedWorkingMs: 60000, sent: 0 }).sentRate, null)
})
test('daily goals survive new store instances, tasks and restart; success is idempotent', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-daily-test-')), store = createDailyQuotaStore(folder)
  store.reserve('a', 1, 'task1:job1'); store.confirm('a', 'task1:job1'); store.confirm('a', 'task1:job1')
  assert.equal(createDailyQuotaStore(folder).status('a', 1).confirmed, 1)
  assert.throws(() => store.reserve('a', 1, 'task2:job2'), /GOAL_REACHED/)
  store.reserve('b', 1, 'task2:job2'); store.rejected('b', 'task2:job2'); assert.equal(store.status('b', 1).confirmed, 0)
})
test('only today additions survive restart but not next day; platform limit cannot be bypassed', () => {
  let now = Date.parse('2026-10-26T12:00:00Z')
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-daily-day-')), s = createDailyQuotaStore(folder, { now: () => now })
  s.seed('a', 100); s.addToday('a', 10); assert.equal(s.status('a', 100).remaining, 10)
  s.platformExhausted('a', 'none'); assert.throws(() => s.addToday('a', 10), /PLATFORM_LIMIT/)
  now += 86400000; assert.equal(s.status('a', 100).limit, 100); assert.equal(s.status('a', 100).confirmed, 0)
})

test('account-day ceiling cannot be exceeded by additions, settings changes, restart or a new task', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-daily-ceiling-')), s = createDailyQuotaStore(folder)
  s.seed('a', 130)
  assert.throws(() => s.addToday('a', 21, 130), /最多150/)
  s.addToday('a', 20, 130)
  assert.equal(s.status('a', 130).remaining, 20)
  assert.equal(createDailyQuotaStore(folder).status('a', 150).limit, 150)
  assert.throws(() => s.addToday('a', 1, 130), /尚未达到/)
  for (let i = 130; i < 150; i++) { s.reserve('a', 150, `task:${i}`); s.confirm('a', `task:${i}`) }
  assert.throws(() => s.reserve('a', 1000, 'another-task'), /GOAL_REACHED/)
  assert.throws(() => s.addToday('a', 1, 130), /最多150/)
  assert.equal(s.status('a', 130).confirmed, 150)
  assert.equal(s.status('b', 130).confirmed, 0)
  s.seed('b', 140)
  s.addToday('b', 10, 100)
  assert.equal(s.status('b', 100).limit, 150)
  assert.equal(s.status('b', 100).remaining, 10)
  assert.throws(() => s.addToday('b', 11, 100), /尚未达到/)
})

test('legacy additions cannot raise the effective account-day ceiling or erase recorded usage', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-legacy-extra-')), s = createDailyQuotaStore(folder)
  const day = beijingDay()
  fs.writeFileSync(path.join(folder, 'daily-chat-usage.json'), JSON.stringify({ version: 1, accounts: { a: {
    [day]: { confirmed: 180, extra: 900, pending: {}, platformExhausted: false, seeded: true },
  } } }))
  assert.equal(s.status('a', 100).limit, 150); assert.equal(s.status('a', 100).remaining, 0)
  assert.throws(() => s.assert('a', 100), /GOAL_REACHED/)
  assert.throws(() => s.addToday('a', 1, 100), /最多150/)
  assert.equal(s.status('a', 100).confirmed, 180)
})

test('two accounts can independently reach 150 each on the same day without sharing counters or platform stops', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-two-accounts-')), store = createDailyQuotaStore(folder)
  store.seed('a', 149); store.seed('b', 149)
  store.reserve('a', 150, 'a:job'); store.confirm('a', 'a:job')
  store.platformExhausted('a', 'none')
  const reopened = createDailyQuotaStore(folder)
  assert.equal(reopened.assert('b', 150).remaining, 1)
  reopened.reserve('b', 150, 'b:job'); reopened.confirm('b', 'b:job')
  assert.equal(reopened.status('a', 150).confirmed, 150)
  assert.equal(reopened.status('b', 150).confirmed, 150)
  assert.throws(() => reopened.assert('a', 150), /PLATFORM_LIMIT/)
  assert.throws(() => reopened.assert('b', 150), /GOAL_REACHED/)
})

test('130 target: A sends 50, B sends 60, then A resumes with 80 remaining across store reopen and recalibration', () => {
  let now = Date.parse('2026-10-26T03:00:00Z')
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-account-switch-'))
  const reopen = () => createDailyQuotaStore(folder, { now: () => now })
  function send(account, amount) {
    const store = reopen(), from = store.status(account, 130).confirmed
    for (let i = from; i < from + amount; i++) {
      store.reserve(account, 130, `${account}:job-${i}`)
      store.confirm(account, `${account}:job-${i}`)
    }
  }
  send('account-a', 50)
  assert.equal(reopen().status('account-a', 130).remaining, 80)
  send('account-b', 60)
  const backToA = reopen()
  backToA.seed('account-a', 0) // An older/empty SQL history cannot clear the journal.
  assert.equal(backToA.assert('account-a', 130).confirmed, 50)
  assert.equal(backToA.assert('account-a', 130).remaining, 80)
  assert.equal(backToA.assert('account-b', 130).remaining, 70)
  send('account-a', 80)
  assert.throws(() => reopen().reserve('account-a', 130, 'new-task:extra'), /GOAL_REACHED/)
  assert.equal(reopen().assert('account-b', 130).confirmed, 60)
  assert.equal(reopen().assert('account-b', 130).remaining, 70)
  now += 86400000
  assert.equal(reopen().assert('account-a', 130).confirmed, 0)
})
test('unconfirmed sends and corrupt journals fail closed rather than giving quota back', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-daily-pending-')), s = createDailyQuotaStore(folder)
  s.reserve('a', 100, 'send'); assert.throws(() => createDailyQuotaStore(folder).assert('a', 100), /UNCONFIRMED/)
  assert.throws(() => s.addToday('a', 10), /UNCONFIRMED/)
  fs.writeFileSync(path.join(folder, 'daily-chat-usage.json'), '{bad')
  assert.throws(() => s.status('a', 100), /UNAVAILABLE/)
})

test('failed writes and an occupied ledger lock never authorize another send', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-daily-write-'))
  const broken = createDailyQuotaStore(folder, { write() { throw Error('disk full') } })
  assert.throws(() => broken.reserve('a', 100, 'one'), /UNAVAILABLE/)
  fs.writeFileSync(path.join(folder, 'daily-chat-usage.json.lock'), 'occupied')
  assert.throws(() => createDailyQuotaStore(folder).reserve('a', 100, 'two'), /UNAVAILABLE/)
  assert.equal(fs.readFileSync(path.join(folder, 'daily-chat-usage.json.lock'), 'utf8'), 'occupied')
})

test('an in-flight success crossing Beijing midnight is counted once on the confirmation day', () => {
  let now = Date.parse('2026-10-26T15:59:59Z')
  const s = createDailyQuotaStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-midnight-')), { now: () => now })
  s.reserve('a', 1, 'one'); now += 2000; s.confirm('a', 'one'); s.confirm('a', 'one')
  assert.equal(s.status('a', 1).day, '2026-10-27'); assert.equal(s.status('a', 1).confirmed, 1)
  assert.equal(s.status('a', 1).pendingCount, 0); assert.throws(() => s.assert('a', 1), /GOAL_REACHED/)
})

test('manual reconciliation counts unknown sends conservatively without granting extra allowance', () => {
  const s = createDailyQuotaStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-ack-')))
  s.reserve('a', 1, 'one'); assert.throws(() => s.acknowledgePending('a', 2), /已变化/)
  s.acknowledgePending('a', 1); assert.equal(s.status('a', 1).confirmed, 1)
  assert.equal(s.status('a', 1).pendingCount, 0); assert.throws(() => s.assert('a', 1), /GOAL_REACHED/)
  assert.throws(() => s.acknowledgePending('a', 1), /已变化/)
})
