import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readLogSettings,
  shouldWriteLog,
  logFileName,
  expiredLogFiles
} from '../src/common/log-settings.mjs'

test('logging is on at info level by default', () => {
  assert.deepEqual(readLogSettings(undefined), { enabled: true, level: 'info' })
  assert.deepEqual(readLogSettings({ enabled: 'no', level: 'verbose' }), {
    enabled: true,
    level: 'info'
  })
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
  assert.deepEqual(
    expiredLogFiles(
      ['app-2026-09-30.log', 'app-2026-10-01.log', 'app-2026-10-14.log', 'log.log', 'error.log'],
      today,
      14
    ),
    ['app-2026-09-30.log']
  )
})
