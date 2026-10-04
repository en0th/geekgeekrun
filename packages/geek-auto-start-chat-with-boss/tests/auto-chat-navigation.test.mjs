import test from 'node:test'
import assert from 'node:assert/strict'
import { NoMatchBatchGuard } from '../auto-chat-navigation.mjs'

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
