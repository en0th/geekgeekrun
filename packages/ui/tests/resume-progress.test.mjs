import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const start = source.indexOf('    async function startTask(')
const code = source.slice(start, source.indexOf('    async function stop(task', start))

async function resume(live = null, checkpointChanges = false) {
  const messages = [], ref = value => ({ value })
  const ctx = vm.createContext({ starting: ref(false), taskStore: { getRunningTasks: async () => {}, runningTasks: [], taskQueue: [] },
    workerIds: { auto: 'worker' }, window: { electron: { ipcRenderer: { invoke: async (_channel, payload) => {
      assert.deepEqual(JSON.parse(JSON.stringify(payload)), { resume: true, runRecordId: 44 })
      if (checkpointChanges) ctx.autoResume.value = { runRecordId: 55, progress: { viewed: 99, sent: 99 } }
      return { runRecordId: 44 }
    } } } },
    requestedStop: {}, curtainDismissed: ref({}), autoResume: ref({ runRecordId: 44, progress: { startedAt: 123, viewed: 5, collected: 5, sent: 0, skipped: 1 } }),
    taskProgress: ref({ auto: live }), runIds: ref({}), running: ref({}), queued: ref({}), modal: ref(''),
    clone: value => structuredClone(value), R: { message: value => messages.push(value) } })
  vm.runInContext(code, ctx); await vm.runInContext("startTask('auto',true)", ctx)
  assert.ok(!messages.some(message => message.type === 'error'))
  return ctx.taskProgress.value.auto
}
test('resuming preserves saved counts in the result panel before the new worker starts reporting', async () => {
  const result = await resume()
  assert.deepEqual([result.viewed,result.collected,result.skipped,result.startedAt], [5,5,1,123])
})
test('already arrived progress for this run wins, while another run cannot leak into its counts', async () => {
  assert.equal((await resume({ runRecordId: 44, collected: 6 })).collected, 6)
  assert.equal((await resume({ runRecordId: 43, collected: 99 })).collected, 5)
})
test('a checkpoint refresh during dispatch cannot replace the counters captured for the selected run', async () => {
  const result = await resume(null, true)
  assert.deepEqual([result.viewed, result.collected, result.sent], [5, 5, 0])
})
