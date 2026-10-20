import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createNativeState } from '../src/renderer/src/page/Ux/native-state.js'

test('preview reads a bounded page of actual library rows without starting a worker', async t => {
  const previous = globalThis.window, calls = []
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous })
  globalThis.window = { electron: { ipcRenderer: { invoke: async (name, payload) => {
    calls.push({ name, payload })
    if (name === 'ux-load-state') return { revision: 1 }
    if (name === 'run-data-query') return { data: { data: [{ encryptJobId: 'saved', salaryDesc: '25-30元/时' }], pageNo: 1, totalItemCount: 1200 } }
    throw new Error('Unexpected mutation: ' + name)
  } } } }
  const native = await createNativeState(), result = await native.jobs()
  assert.equal(result.rows[0].salaryDesc, '25-30元/时')
  assert.equal(result.total, 1200)
  assert.deepEqual(calls.map(call => call.name), ['ux-load-state', 'run-data-query'])
  assert.equal(calls[1].payload.pageSize, 100)
  assert.equal(calls[1].payload.pageNo, 1)
})

test('the shipped preview entry opens results and ignores a response after its dialog was closed', async () => {
  const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
  const start = source.indexOf('    async function previewMatches()')
  const code = source.slice(start, source.indexOf('    function previewControls()', start))
  let resolveRows
  const ctx = vm.createContext({ effective: () => ({ runMode: 'collect' }), isCollectAll: () => false,
    conditionIssues() {}, presentErrors() { throw new Error('unexpected invalid draft') },
    previewBusy: { value: false }, preview: { value: null }, modal: { value: '' }, previewRequest: 0,
    native: { jobs: () => new Promise(resolve => { resolveRows = resolve }) }, evaluate: row => ({ ...row, result: '匹配' }),
    R: { message() {} } })
  vm.runInContext(code, ctx)
  const first = vm.runInContext('previewMatches()', ctx)
  assert.equal(ctx.modal.value, 'preview')
  resolveRows({ total: 1, rows: [{ encryptJobId: 'first' }] }); await first
  assert.equal(ctx.preview.value.rows[0].result, '匹配')
  const late = vm.runInContext('previewMatches()', ctx)
  ctx.modal.value = ''
  resolveRows({ total: 1, rows: [{ encryptJobId: 'late' }] }); await late
  assert.equal(ctx.preview.value, null)
  assert.equal(ctx.previewBusy.value, false)
})
