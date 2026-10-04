import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readLogSettings,
  shouldWriteLog,
  logFileName,
  expiredLogFiles
} from '../src/common/log-settings.mjs'

test('logging is on at info level by default', () => {
  assert.deepEqual(readLogSettings(undefined), { enabled: true, level: 'info', retentionDays: 7 })
  assert.deepEqual(readLogSettings({ enabled: 'no', level: 'verbose', retentionDays: 0 }), {
    enabled: true,
    level: 'info',
    retentionDays: 7
  })
  assert.equal(readLogSettings({ retentionDays: 30 }).retentionDays, 30)
  assert.equal(readLogSettings({ retentionDays: 2.5 }).retentionDays, 7)
})

test('a level keeps itself and everything more severe', () => {
  const info = { enabled: true, level: 'info' }
  assert.equal(shouldWriteLog(info, 'debug'), false)
  assert.equal(shouldWriteLog(info, 'info'), true)
  assert.equal(shouldWriteLog(info, 'error'), true)
  assert.equal(shouldWriteLog({ enabled: true, level: 'trace' }, 'trace'), true)
  assert.equal(shouldWriteLog({ enabled: true, level: 'error' }, 'warning'), false)
  assert.equal(shouldWriteLog({ enabled: false, level: 'trace' }, 'error'), false)
})

test('daily files past the retention period are expired, others untouched', () => {
  const today = new Date(2026, 9, 15)
  assert.equal(logFileName(today), 'app-2026-10-15.log')
  const names = ['app-2026-10-08.log', 'app-2026-10-09.log', 'app-2026-10-15.log', 'log.log']
  // a week: today and the six days before it
  assert.deepEqual(expiredLogFiles(names, today, 7), ['app-2026-10-08.log'])
  assert.deepEqual(expiredLogFiles(names, today, 1), ['app-2026-10-08.log', 'app-2026-10-09.log'])
})
