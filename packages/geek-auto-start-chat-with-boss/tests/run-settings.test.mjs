import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readRunSettings,
  readJobStatusPollSettings,
  readRunPace,
  runPaceFromBossConfig,
  DEFAULT_RUN_PACE,
  waitSeconds,
  DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS,
  DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS,
  MAX_WAIT_SECONDS
} from '../run-settings.mjs'

test('configs without the settings get the defaults', () => {
  assert.deepEqual(readRunSettings({}), {
    runMode: 'chat',
    collectOnlyMatchingJobs: true,
    skipUnparseableSalaryJob: true,
    jobListLoadWaitSeconds: DEFAULT_JOB_LIST_LOAD_WAIT_SECONDS,
    jobDetailViewWaitSeconds: DEFAULT_JOB_DETAIL_VIEW_WAIT_SECONDS
  })
})

test('saved settings are used as they are', () => {
  assert.deepEqual(
    readRunSettings({
      autoChatRunMode: 'collect',
      collectOnlyMatchingJobs: false,
      skipUnparseableSalaryJob: false,
      jobListLoadWaitSeconds: 0,
      jobDetailViewWaitSeconds: 3.5
    }),
    {
      runMode: 'collect',
      collectOnlyMatchingJobs: false,
      skipUnparseableSalaryJob: false,
      jobListLoadWaitSeconds: 0,
      jobDetailViewWaitSeconds: 3.5
    }
  )
})

test('an unknown run mode falls back to chatting', () => {
  assert.equal(readRunSettings({ autoChatRunMode: 'spam' }).runMode, 'chat')
  assert.equal(readRunSettings({ collectOnlyMatchingJobs: 'no' }).collectOnlyMatchingJobs, true)
})

test('job status poll settings keep only allowed values', () => {
  assert.deepEqual(readJobStatusPollSettings(undefined), { enabled: true, intervalHours: 6 })
  assert.deepEqual(readJobStatusPollSettings({ enabled: false, intervalHours: 24 }), {
    enabled: false,
    intervalHours: 24
  })
  assert.deepEqual(readJobStatusPollSettings({ enabled: 'yes', intervalHours: 5 }), {
    enabled: true,
    intervalHours: 6
  })
})

test('invalid waits fall back to the default and huge ones are capped', () => {
  for (const value of [null, undefined, '', -1, 'abc', NaN]) {
    assert.equal(waitSeconds(value, 5), 5, String(value))
  }
  assert.equal(waitSeconds('2', 5), 2)
  assert.equal(waitSeconds(99999, 5), MAX_WAIT_SECONDS)
})

test('global run pace keeps valid values and falls back for the rest', () => {
  assert.deepEqual(readRunPace(null), DEFAULT_RUN_PACE)
  assert.deepEqual(
    readRunPace({ pause: false, actions: 30, minutes: 0, jobListLoadWaitSeconds: 1, jobDetailViewWaitSeconds: 0 }),
    { pause: false, actions: 30, minutes: 0, jobListLoadWaitSeconds: 1, jobDetailViewWaitSeconds: 0 }
  )
  assert.deepEqual(readRunPace({ actions: 0.5, minutes: -1 }), DEFAULT_RUN_PACE)
})

test('the global pace starts from what boss.json already uses', () => {
  assert.deepEqual(
    runPaceFromBossConfig({ isSageTimeEnabled: true, sageTimeOpTimes: 50, sageTimePauseMinute: 10, jobListLoadWaitSeconds: 3 }),
    { pause: true, actions: 50, minutes: 10, jobListLoadWaitSeconds: 3, jobDetailViewWaitSeconds: DEFAULT_RUN_PACE.jobDetailViewWaitSeconds }
  )
})
