import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readRunSettings,
  waitSeconds,
  DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS,
  DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS,
  MAX_WAIT_SECONDS
} from '../run-settings.mjs'

test('configs without the settings get the defaults', () => {
  assert.deepEqual(readRunSettings({}), {
    skipUnparseableSalaryJob: true,
    jobListLoadWaitSeconds: DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS,
    jobDetailViewWaitSeconds: DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS
  })
})

test('saved settings are used as they are', () => {
  assert.deepEqual(
    readRunSettings({ skipUnparseableSalaryJob: false, jobListLoadWaitSeconds: 0, jobDetailViewWaitSeconds: 3.5 }),
    { skipUnparseableSalaryJob: false, jobListLoadWaitSeconds: 0, jobDetailViewWaitSeconds: 3.5 }
  )
})

test('invalid waits fall back to the default and huge ones are capped', () => {
  for (const value of [null, undefined, '', -1, 'abc', NaN]) {
    assert.equal(waitSeconds(value, 5), 5, String(value))
  }
  assert.equal(waitSeconds('2', 5), 2)
  assert.equal(waitSeconds(99999, 5), MAX_WAIT_SECONDS)
})
