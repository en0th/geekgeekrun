import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { isSuccessfulTaskExit, isResumableTaskExit } from '../../pm/task-exit.cjs'

const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const start = source.indexOf('    const unlisten = window.electron.ipcRenderer.on(')
const code = source.slice(start, source.indexOf('    R.onUnmounted(', start))
function exit(exitCode) {
  const messages = [], progress = { viewed: 3, collected: 3, sent: 0, detail: '已保存岗位信息' }
  const ctx = vm.createContext({ isSuccessfulTaskExit, isResumableTaskExit,
    window: { electron: { ipcRenderer: { on: (event, callback) => { ctx.exit = callback } } } },
    workerIds: { auto: 'geekAutoStartWithBossMain' }, running: { value: { auto: true } },
    taskProgress: { value: { auto: progress } }, requestedStop: {}, exitCodeLabels: { 92: '所有职位来源已轮换完成，任务正常结束', 95: '城市筛选未能确认' },
    R: { message: info => messages.push(info) }, openTaskDetail() {} })
  vm.runInContext(code, ctx)
  ctx.exit(null, { workerId: 'geekAutoStartWithBossMain', code: exitCode, restarting: false })
  return { messages, progress }
}

test('the actual renderer labels source exhaustion as completed and retains collected counts', () => {
  const result = exit(92)
  assert.equal(result.progress.state, 'stopped')
  assert.match(result.progress.detail, /正常结束/)
  assert.equal(result.progress.collected, 3)
  assert.equal(result.messages[0].type, 'success')
  assert.equal(isSuccessfulTaskExit('readNoReplyAutoReminderMain', 92), false)
})

test('verification and budget failures keep their reason and allow resume', () => {
  for (const code of [93, 95, 96, 97, 99, 100, 101]) {
    const result = exit(code)
    assert.equal(result.progress.state, 'blocked')
    assert.equal(result.progress.detail, '已保存岗位信息')
    assert.equal(result.messages[0].type, 'warning')
  }
})
