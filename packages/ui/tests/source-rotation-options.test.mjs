import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceRotationLabel } from '../src/common/source-rotation-options.mjs'

test('source summaries explain actual default thresholds without inventing a preset selection', () => {
  const draft = { perSourceSuccessLimit: null, noMatchStreakLimit: null }
  assert.equal(sourceRotationLabel(draft), '每成功打招呼20个岗位后切换来源；连续不符合条件30个岗位后切换来源')
  assert.deepEqual(draft, { perSourceSuccessLimit: null, noMatchStreakLimit: null })
})
test('legacy custom values are kept, including disabled triggers and numeric strings', () => {
  for (const d of [{ perSourceSuccessLimit: 1001, noMatchStreakLimit: 1000 }, { perSourceSuccessLimit: 0, noMatchStreakLimit: 17 }]) {
    const before = structuredClone(d)
    sourceRotationLabel(d); assert.deepEqual(d, before)
  }
  assert.match(sourceRotationLabel({ perSourceSuccessLimit: '20', noMatchStreakLimit: '30', runMode: 'collect' }), /收集20个岗位/)
})
test('disabled thresholds and malformed legacy values agree with runtime interpretation', () => {
  assert.equal(sourceRotationLabel({ perSourceSuccessLimit: 0, noMatchStreakLimit: 0 }), '不按岗位数量提前切换')
  assert.match(sourceRotationLabel({ perSourceSuccessLimit: -1 }), /成功打招呼20个岗位/)
  assert.doesNotMatch(sourceRotationLabel({ perSourceSuccessLimit: 0, noMatchStreakLimit: 17 }), /成功打招呼|自定义/)
})
