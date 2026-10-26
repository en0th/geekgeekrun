import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const start = source.indexOf('    async function startTask(')
const body = source.slice(start, source.indexOf('    async function stop(', start))

async function failedStart(message) {
  const messages = [], calls = [], starting = { value: false }
  const context = vm.createContext({ starting, autoResume: { value: null }, workerIds: { auto: 'auto' },
    taskStore: { getRunningTasks: async () => {}, runningTasks: [], taskQueue: [] },
    window: { electron: { ipcRenderer: { invoke: async name => { calls.push(name); throw Error(message) } } } },
    R: { message: value => messages.push(value) }, acknowledgeDaily: () => calls.push('reconcile-confirmation'),
  })
  vm.runInContext(body, context); await context.startTask('auto')
  assert.equal(starting.value, false)
  return { messages, calls }
}

test('a pending-send start failure offers software confirmation without exposing the IPC wrapper or sending again', async () => {
  for (const detail of ['有一次发送记录待处理', '有一次开聊结果尚未确认']) {
    const result = await failedStart(`Error invoking remote method 'run-geek-auto-start-chat-with-boss': Error: ${detail}`)
    assert.equal(result.messages[0].title, '先处理上次发送记录')
    assert.doesNotMatch(result.messages[0].message, /remote method|run-geek-auto/)
    assert.equal(result.messages[0].action.label, '处理已核对记录')
    assert.deepEqual(result.calls, ['run-geek-auto-start-chat-with-boss'])
    result.messages[0].action.onClick()
    assert.deepEqual(result.calls, ['run-geek-auto-start-chat-with-boss', 'reconcile-confirmation'])
  }
})

test('another start failure retains its actual reason without offering an unrelated reconciliation', async () => {
  const result = await failedStart('当前账号与任务账号不同')
  assert.equal(result.messages[0].message, '当前账号与任务账号不同')
  assert.equal(result.messages[0].action, undefined)
})
