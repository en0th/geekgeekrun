import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../src/renderer/src/page/Ux/index.js', import.meta.url), 'utf8')
const loader = source.slice(source.indexOf('    const runSnapshot = ref(null);'), source.indexOf('    R.watch(detailTab,'))
function history() {
  const requests = []
  const ctx = vm.createContext({
    ref: value => ({ value }),
    window: { electron: { ipcRenderer: { invoke: (_channel, payload) => new Promise((resolve, reject) => requests.push({ payload, resolve, reject })) } } }
  })
  vm.runInContext(loader, ctx)
  return { requests, load: id => ctx.loadRunSnapshot({ runRecordId: id }),
    snapshot: () => vm.runInContext('runSnapshot.value', ctx),
    loading: () => vm.runInContext('runSnapshotLoading.value', ctx) }
}

test('switching runs clears the previous config while the next one loads', async () => {
  const current = history()
  const first = current.load(1)
  current.requests[0].resolve({ draft: { titles: ['产品'] } })
  await first
  const next = current.load(2)
  assert.equal(current.snapshot(), null)
  assert.equal(current.loading(), true)
  current.requests[1].resolve({ draft: { titles: ['工程师'] } })
  await next
  assert.deepEqual(current.snapshot().draft.titles, ['工程师'])
  assert.equal(current.loading(), false)
})
test('a late response cannot overwrite the selected run config', async () => {
  const current = history()
  const first = current.load(1)
  const next = current.load(2)
  current.requests[1].resolve({ run: 2 })
  await next
  current.requests[0].resolve({ run: 1 })
  await first
  assert.deepEqual(current.snapshot(), { run: 2 })
})
test('an older failed request cannot clear the selected run config', async () => {
  const current = history()
  const first = current.load(1)
  const next = current.load(2)
  current.requests[1].resolve({ run: 2 })
  await next
  current.requests[0].reject(Error('old IPC request failed'))
  await first
  assert.deepEqual(current.snapshot(), { run: 2 })
  assert.equal(current.loading(), false)
})
test('opening a run without an id invalidates a pending request', async () => {
  const current = history()
  const first = current.load(1)
  await current.load(null)
  current.requests[0].resolve({ run: 1 })
  await first
  assert.equal(current.snapshot(), null)
  assert.equal(current.loading(), false)
})
