import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { ExpiringBlockSet } from '../job-safety.mjs'

// Exercise the shipped checkpoints with browser/IPC effects isolated.
const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
const stateCode = source.slice(source.indexOf('let runPosition ='), source.indexOf('async function markJobAsNotSuitInRecommendPage'))
  .replaceAll('export function', 'function')
const resumeCode = source.slice(source.indexOf('  const resumeFrom ='), source.indexOf('  afterPageLoad:'))
function context(successLimit = 20, noMatchLimit = 30) {
  const events = []
  const ctx = vm.createContext({
    perSourceSuccessLimit: successLimit, noMatchStreakLimit: noMatchLimit,
    blockJobNotSuit: new ExpiringBlockSet(), blockBossNotActive: new ExpiringBlockSet(), blockBossNotNewChat: new Set(),
    positionFingerprint: '', computedSourceList: [{ type: 'recommend' }, { type: 'search' }],
    autoStartChatEventBus: { emit: (type, data) => events.push({ type, ...data }) }
  })
  vm.runInContext(stateCode, ctx)
  return { ctx, events, run: code => vm.runInContext(code, ctx),
    saved: () => JSON.parse(JSON.stringify(vm.runInContext('exportRunState()', ctx))) }
}
function resume(saved, successLimit = 20, noMatchLimit = 30, fingerprint = '') {
  const current = context(successLimit, noMatchLimit)
  current.ctx.saved = saved
  current.ctx.positionFingerprint = fingerprint
  current.run('importRunState(saved)')
  current.run('(function () {' + resumeCode + '})()')
  return current
}

test('pausing/yielding retains the per-source success limit across worker processes', () => {
  const first = context(3)
  assert.equal(first.run('countSourceSuccess()'), false)
  assert.equal(first.run('countSourceSuccess()'), false)
  const next = resume(first.saved(), 3)
  assert.equal(next.run('countSourceSuccess()'), true)
  assert.equal(next.saved().position.sourceSuccessCount, 3)
})
test('the no-match streak survives restart and a success resets it', () => {
  const first = context(20, 3)
  first.run('countSourceNoMatch(); countSourceNoMatch()')
  const next = resume(first.saved(), 20, 3)
  assert.equal(next.run('countSourceNoMatch()'), true)
  next.run('countSourceSuccess()')
  assert.equal(next.saved().position.noMatchStreak, 0)
  assert.equal(next.run('hasReachedSourceRotationLimit()'), false)
})
test('an in-process security-check restart retains rotation counters', () => {
  const current = context(2)
  current.run('countSourceSuccess(); resumeFromCurrentPosition()')
  current.run('(function () {' + resumeCode + '})()')
  assert.equal(current.run('countSourceSuccess()'), true)
})
test('legacy states and a changed source fingerprint start fresh counters', () => {
  const legacy = { position: { sourceIndex: 0, filterConditionIndex: 0, fingerprint: '' } }
  assert.equal(resume(legacy).saved().position.sourceSuccessCount, 0)
  const current = context(1)
  current.run('countSourceSuccess()')
  assert.equal(resume(current.saved(), 1, 30, 'changed').run('hasReachedSourceRotationLimit()'), false)
})
test('resuming at an already reached threshold does not process another job', () => {
  const current = context(1)
  current.run('countSourceSuccess()')
  const next = resume(current.saved(), 1)
  const start = source.indexOf('    iterateFilterCondition: for (')
  const end = source.indexOf('      runPosition =', start)
  next.ctx.attempted = []
  next.run('(function () { const filterConditions = [1, 2]; let filterConditionIndex = -1; const skipFilterConditions = 0; ' +
    source.slice(start, end) + ' attempted.push(filterCondition) } })()')
  assert.deepEqual(next.ctx.attempted, [])
})

test('both collection checkpoints count the threshold job once', () => {
  for (const [startText, endText] of [
    ['                  if (isCollectAll) {', '                  const parsedSalary ='],
    ['                  if (isCollectMode) {', '                  const startChatButtonInnerHTML =']
  ]) {
    const current = context(1)
    Object.assign(current.ctx, {
      isCollectAll: true, isCollectMode: true,
      targetJobData: { jobInfo: { encryptId: 'job-1' } }, searchGuard: { reset() {} }, reject() {}
    })
    const start = source.indexOf(startText)
    const body = source.slice(start, source.indexOf(endText, start)).replace('continue continueFind', 'return')
    current.run('(function () {' + body + '})()')
    assert.equal(current.events.filter(event => event.kind === 'collected').length, 1)
    assert.equal(current.events.at(-1).state, 'searching')
  }
})
test('greeting at the threshold emits one success and saves browser state', async () => {
  const current = context(1)
  let saves = 0
  Object.assign(current.ctx, {
    targetJobData: { jobInfo: { encryptUserId: 'boss-1' } }, currentSourceIndex: 0,
    hooks: { newChatStartup: { promise: async () => {} } },
    ChatStartupFrom: { AutoFromRecommendList: 1 }, JobSource: { recommend: 1 },
    page: { $: async () => null }, storeStorage: async () => { saves++ }, sleepWithRandomDelay: async () => {},
    chatSourceRotationDone: false
  })
  const start = source.indexOf('          const waitAndHandleChatSuccess =')
  const end = source.indexOf('          const handleAddFriendResponse =', start)
  await current.run('(async function () {' + source.slice(start, end) + ' await waitAndHandleChatSuccess() })()')
  assert.equal(current.events.filter(event => event.kind === 'sent').length, 1)
  assert.equal(current.events.at(-1).state, 'searching')
  assert.equal(current.ctx.chatSourceRotationDone, true)
  assert.equal(saves, 1)
})
