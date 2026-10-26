import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { isSuccessfulTaskExit } from '../../pm/task-exit.cjs'
import { taskRecoveryGuidance } from '../src/common/task-recovery-guidance.mjs'

const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const start = source.indexOf('    const unlisten = window.electron.ipcRenderer.on(')
const code = source.slice(start, source.indexOf('    R.onUnmounted(', start))
async function exit(exitCode, { pending = false, active = false } = {}) {
  const messages = [], progress = { viewed: 3, collected: 3, sent: 0, detail: '已保存岗位信息' }
  const checkpoint = exitCode === 92 ? null : { runRecordId: 42, runMode: 'collect', exitCode, messageSendPending: pending || exitCode === 87, progress }
  const ctx = vm.createContext({ isSuccessfulTaskExit,
    taskStore: { getRunningTasks: async () => {}, runningTasks: active ? [{ workerId: 'geekAutoStartWithBossMain' }] : [] },
    refreshResume: async () => true,
    recoveryGuide: () => taskRecoveryGuidance({ checkpoint, code: exitCode, progress, currentMode: 'collect' }),
    window: { electron: { ipcRenderer: { on: (event, callback) => { ctx.exit = callback } } } },
    workerIds: { auto: 'geekAutoStartWithBossMain' }, running: { value: { auto: true } },
    taskProgress: { value: { auto: progress } }, requestedStop: {}, exitCodeLabels: { 92: '所有职位来源已轮换完成，任务正常结束', 95: '城市筛选未能确认' },
    R: { message: info => messages.push(info) }, openTaskDetail() {}, recoveryAction() {} })
  vm.runInContext(code, ctx)
  await ctx.exit(null, { workerId: 'geekAutoStartWithBossMain', code: exitCode, restarting: false })
  return { messages, progress }
}

test('the actual renderer labels source exhaustion as completed and retains collected counts', async () => {
  const result = await exit(92)
  assert.equal(result.progress.state, 'stopped')
  assert.match(result.progress.detail, /正常结束/)
  assert.equal(result.progress.collected, 3)
  assert.equal(result.messages[0].type, 'success')
  assert.equal(isSuccessfulTaskExit('readNoReplyAutoReminderMain', 92), false)
})

test('verification and budget failures keep their reason and allow resume', async () => {
  for (const code of [93, 95, 96, 97, 99, 100, 101]) {
    const result = await exit(code)
    assert.equal(result.progress.state, 'blocked')
    assert.equal(result.progress.detail, '已保存岗位信息')
    assert.equal(result.messages[0].type, 'warning')
  }
})

test('an unconfirmed send never receives a normal resume suggestion', async () => {
  const result = await exit(87)
  assert.equal(result.progress.state, 'blocked')
  assert.equal(result.progress.sent, 0)
  assert.equal(result.messages[0].action.label, '处理已核对记录')
  assert.doesNotMatch(result.messages[0].message, /可在任务列表中恢复/)
  assert.match(result.messages[0].message, /不能直接继续/)
})


test('a manual stop with an unresolved send cannot be announced as completed', async () => {
  const result = await exit(0, { pending: true })
  assert.equal(result.messages[0].type, 'warning')
  assert.equal(result.messages[0].action.label, '处理已核对记录')
  assert.equal(result.progress.sent, 0)
})

test('a stale exit notice cannot overwrite a worker that is already active again', async () => {
  const result = await exit(101, { active: true })
  assert.deepEqual(result.messages, [])
  assert.equal(result.progress.detail, '已保存岗位信息')
})
