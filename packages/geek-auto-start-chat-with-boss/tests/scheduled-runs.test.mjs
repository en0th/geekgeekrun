import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createScheduledRunStore, createScheduleRunner } from '../scheduled-runs.mjs'
const config = { 'boss.json': { autoChatRunMode: 'collect', expectJobNameRegExpStr: '产品', apiKey: 'not-copied' } }
test('schedules freeze non-secret settings, validate future time and cancel safely', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-schedule-')), store = createScheduledRunStore(folder, { now: () => 1000000 })
  assert.throws(() => store.create(1000000, 'a', config)); assert.throws(() => store.create(1060000, '', config))
  const id = store.create(1060000, 'a', config)
  assert.equal(store.list()[0].config, undefined)
  assert(!fs.readFileSync(path.join(folder, 'scheduled-job-runs.json'), 'utf8').includes('not-copied'))
  store.cancel(id); assert.equal(store.list()[0].state, 'cancelled')
})
test('runner waits for serial availability and starts exactly once despite concurrent ticks', async () => {
  let now = 1000000, busy = true, starts = 0
  const store = createScheduledRunStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-schedule-run-')), { now: () => now })
  store.create(now + 60000, 'a', config); now += 60000
  const tick = createScheduleRunner({ store, busy: async () => busy, start: async item => { starts++; assert.equal(item.accountId, 'a'); return { runRecordId: 4 } } })
  await tick(); assert.equal(store.list()[0].state, 'waiting'); busy = false
  await Promise.all([tick(), tick()]); await tick(); assert.equal(starts, 1); assert.equal(store.list()[0].runRecordId, 4)
})
test('reopening never catches up missed or unconfirmed launches silently', () => {
  let now = 1000000
  const store = createScheduledRunStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-schedule-missed-')), { now: () => now })
  const a = store.create(now + 60000, 'a', config), b = store.create(now + 120000, 'a', config)
  store.set(b, 'starting', 'checking'); now += 61000; store.recoverOnOpen()
  assert.equal(store.list().find(x => x.id === a).state, 'missed'); assert.equal(store.list().find(x => x.id === b).state, 'needs-review'); assert.equal(store.due().length, 0)
})
test('account or login failures block without creating a successful run', async () => {
  let now = 1000000
  const store = createScheduledRunStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-schedule-login-')), { now: () => now })
  store.create(now + 60000, 'a', config); now += 60000
  await createScheduleRunner({ store, busy: async () => false, start: async () => { throw Error('账号已变化，请重新登录') } })()
  assert.equal(store.list()[0].state, 'blocked'); assert.equal(store.list()[0].runRecordId, undefined)
})

test('notification failure cannot turn a submitted booking into a retryable booking', async () => {
  let now = 1000000, starts = 0
  const store = createScheduledRunStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-schedule-notice-')), { now: () => now })
  store.create(now + 60000, 'a', config); now += 60000
  const tick = createScheduleRunner({ store, busy: async () => false,
    start: async () => { starts++; return { runRecordId: 8 } }, notify() { throw Error('OS notification denied') } })
  await tick(); await tick(); assert.equal(starts, 1); assert.equal(store.list()[0].state, 'started')
})

test('a missing dispatch receipt is held for review and is never retried', async () => {
  let now = 1000000, starts = 0
  const store = createScheduledRunStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-schedule-receipt-')), { now: () => now })
  store.create(now + 60000, 'a', config); now += 60000
  const tick = createScheduleRunner({ store, busy: async () => false, start: async () => { starts++ } })
  await tick(); await tick(); assert.equal(starts, 1); assert.equal(store.list()[0].state, 'needs-review')
})
