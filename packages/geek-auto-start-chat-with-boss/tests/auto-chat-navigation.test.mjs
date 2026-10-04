import test from 'node:test'
import assert from 'node:assert/strict'
import * as navigation from '../auto-chat-navigation.mjs'
const { NoMatchBatchGuard } = navigation

test('the guard stops after max batches without anything usable', () => {
  const guard = new NoMatchBatchGuard(2)
  guard.beforeLoad(); guard.loadedBatch()
  guard.beforeLoad(); guard.loadedBatch()
  assert.throws(() => guard.beforeLoad(), /AUTO_CHAT_NO_MATCH_BATCH_LIMIT/)
})

test('finding something to collect starts the count again', () => {
  const guard = new NoMatchBatchGuard(2)
  for (let i = 0; i < 5; i++) {
    guard.beforeLoad(); guard.loadedBatch()
    guard.reset()
  }
  assert.doesNotThrow(() => guard.beforeLoad())
})

test('collect mode never greets, whatever the job', () => {
  const { assertCanGreet } = navigation
  assert.throws(
    () => assertCanGreet({ isCollectMode: true, targetJobIndex: 3, matchedJobId: 'a', targetJobId: 'a' }),
    /COLLECT_MODE_CHAT_BLOCKED/
  )
})

test('only the job that passed the checks may be greeted', () => {
  const { assertCanGreet } = navigation
  // the loop ended at the last page right after skipping a job: nothing was matched
  assert.throws(
    () => assertCanGreet({ isCollectMode: false, targetJobIndex: -1, matchedJobId: null, targetJobId: 'last-seen' }),
    /UNMATCHED_JOB_CHAT_BLOCKED/
  )
  assert.throws(
    () => assertCanGreet({ isCollectMode: false, targetJobIndex: 2, matchedJobId: 'a', targetJobId: 'b' }),
    /UNMATCHED_JOB_CHAT_BLOCKED/
  )
  assert.doesNotThrow(() =>
    assertCanGreet({ isCollectMode: false, targetJobIndex: 2, matchedJobId: 'a', targetJobId: 'a' })
  )
})
