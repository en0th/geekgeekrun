import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { watchJobResponses } from '../boss-job-responses.mjs'
import { listRequestMatches, waitForCurrentJobList } from '../job-list-ready.mjs'
import { searchRequestMatches } from '../search-source.mjs'

const path = '/wapi/zpgeek/search/joblist.json'
const selected = { query: '工程师', position: '', city: '100010000', salary: '404', experience: '', degree: '', industry: '', scale: '', jobType: '' }
const source = { type: 'search', keyword: '工程师', positionCodes: [] }
function request(parameters, pathname = path, host = 'www.zhipin.com') {
  return { url: () => `https://${host}${pathname}`, postData: () => new URLSearchParams(parameters).toString() }
}
function response(parameters, ids, { pathname = path, json, status = 200 } = {}) {
  const req = request(parameters, pathname)
  return { url: req.url, request: () => req, status: () => status,
    json: json || (async () => ({ code: 0, zpData: { jobList: ids.map(encryptJobId => ({ encryptJobId })), hasMore: true } })) }
}
function fixture(t, { ids = ['old-job'], parameters = selected, advance = () => {} } = {}) {
  let clock = 0
  const view = { formData: { ...parameters }, jobList: ids.map(encryptJobId => ({ encryptJobId })) }
  const state = { loading: false, events: [], view }
  const page = new EventEmitter()
  page.evaluate = async fn => vm.runInNewContext('(' + fn.toString() + ')()', {
    document: { querySelector: selector => selector === '.page-jobs-main' ? { __vue__: view } : state.loading ? {} : null },
    URL, location: { href: 'https://www.zhipin.com/web/geek/job' },
  })
  const monitor = watchJobResponses(page)
  t.after(() => monitor.dispose())
  const emit = (parameters, ids, options) => page.emit('response', response(parameters, ids, options))
  const render = ids => { view.jobList = ids.map(encryptJobId => ({ encryptJobId })) }
  const run = options => waitForCurrentJobList({ page, monitor, source, timeoutMs: 3000,
    now: () => clock, pause: async ms => { clock += ms; await advance({ clock, emit, render, state }) },
    onReady: data => state.events.push(data), ...options })
  return { page, monitor, emit, render, run, state }
}

test('a hidden loader cannot release the old list while the matching response and model are delayed', async t => {
  const current = fixture(t, { advance: ({ clock, emit, render }) => {
    if (clock === 2000) emit(selected, ['new-job'])
    if (clock === 2200) render(['new-job'])
  } })
  current.emit({ ...selected, salary: '' }, ['old-job'])
  const ready = await current.run()
  assert.equal(ready.elapsedMs, 2200)
  assert.equal(ready.scopeConfirmed, true)
  assert.equal(ready.rowsConfirmed, true)
  assert.equal(current.state.events.length, 1)
})

test('an already-current list has no artificial 1.5 second wait, even when result IDs did not change', async t => {
  const current = fixture(t)
  current.emit(selected, ['old-job'])
  assert.equal((await current.run()).elapsedMs, 0)
})

test('a genuine empty response is ready but an unconfirmed empty model cannot stand in for one', async t => {
  const current = fixture(t, { ids: [] })
  await assert.rejects(current.run(), error => error.message === 'AUTO_CHAT_PAGE_FILTER_NOT_APPLIED' && error.field === 'list')
  current.emit(selected, [])
  assert.equal((await current.run()).count, 0)
})

test('matching request parameters alone do not release mismatched rows or an active loader', async t => {
  for (const mode of ['rows', 'loading', 'missing-id']) {
    const current = fixture(t, { ids: mode === 'missing-id' ? [''] : ['old-job'] })
    if (mode === 'loading') current.state.loading = true
    current.emit(selected, mode === 'rows' ? ['new-job'] : mode === 'missing-id' ? [''] : ['old-job'])
    await assert.rejects(current.run(), /AUTO_CHAT_PAGE_FILTER_NOT_APPLIED/)
    assert.equal(current.state.events.length, 0)
  }
})

test('wrong query, source endpoint or missing selected filter cannot confirm a list', async t => {
  for (const options of [
    { parameters: { ...selected, query: '其他职位' } },
    { parameters: { ...selected, salary: '' } },
    { parameters: selected, pathname: '/wapi/zpgeek/pc/recommend/job/list.json' },
  ]) {
    const current = fixture(t)
    current.emit(options.parameters, ['old-job'], options)
    await assert.rejects(current.run(), /AUTO_CHAT_PAGE_FILTER_NOT_APPLIED/)
  }
  assert.equal(listRequestMatches(request(selected, path, 'zhipin.com.example.com'), selected, source), false)
  assert.equal(listRequestMatches(request({ ...selected, salary: 404, degree: 0 }), selected, source), true)
})

test('a page scope change while waiting pauses and restrictions retain their original classification', async t => {
  const changed = fixture(t, { advance: ({ state }) => { state.view.formData.query = '另一来源' } })
  await assert.rejects(changed.run(), /AUTO_CHAT_PAGE_FILTER_NOT_APPLIED/)
  const restricted = fixture(t)
  restricted.emit(selected, [], { json: async () => ({ code: 37 }) })
  await assert.rejects(restricted.run(), /LOGIN_STATUS_RESTRICTED/)
})

test('consecutive pages are checked against the whole rendered list, and a new first page replaces old IDs', async t => {
  const current = fixture(t)
  current.emit({ ...selected, page: 1 }, ['first'])
  await current.monitor.assertHealthy()
  current.emit({ ...selected, page: 2 }, ['second'])
  current.render(['first', 'second'])
  assert.equal((await current.run()).count, 2)
  current.emit({ ...selected, page: 1 }, ['refreshed'])
  current.render(['refreshed'])
  assert.equal((await current.run()).count, 1)
  assert.deepEqual(current.monitor.getListSnapshot().ids, ['refreshed'])
})

test('out-of-order bodies cannot replace a newer first page and missing pagination is not guessed', async t => {
  const current = fixture(t)
  let release
  current.emit({ ...selected, page: 1 }, ['stale'], { json: () => new Promise(resolve => { release = resolve }) })
  await new Promise(resolve => setImmediate(resolve))
  current.emit({ ...selected, page: 1 }, ['current'])
  await new Promise(resolve => setImmediate(resolve))
  release({ code: 0, zpData: { jobList: [{ encryptJobId: 'stale' }] } })
  await current.monitor.assertHealthy()
  assert.deepEqual(current.monitor.getListSnapshot().ids, ['current'])
  current.emit({ ...selected, page: 3 }, ['third'])
  await current.monitor.assertHealthy()
  assert.equal(current.monitor.getListSnapshot().ids, null)
})

test('a delayed earlier page completes the current pagination without replacing its newer rows', async t => {
  const current = fixture(t)
  let release
  current.emit({ ...selected, page: 1 }, ['first'], {
    json: () => new Promise(resolve => { release = resolve }),
  })
  await new Promise(resolve => setImmediate(resolve))
  current.emit({ ...selected, page: 2 }, ['second'])
  await new Promise(resolve => setImmediate(resolve))
  current.render(['first', 'second'])
  release({ code: 0, zpData: { jobList: [{ encryptJobId: 'first' }] } })
  await current.monitor.assertHealthy()
  assert.deepEqual(current.monitor.getListSnapshot().ids, ['first', 'second'])
  assert.equal(current.monitor.getListSnapshot().page, 2)
  assert.equal((await current.run()).count, 2)
})

test('a late list with different filters blocks the next action after readiness', async t => {
  const current = fixture(t)
  current.emit(selected, ['old-job'])
  await current.run()
  current.emit({ ...selected, salary: '' }, ['wrong'])
  let acted = false
  await assert.rejects(current.monitor.guard(() => { acted = true }), error => error.message === 'LOGIN_STATUS_UNKNOWN' && /筛选条件不一致/.test(error.detail))
  assert.equal(acted, false)
})

test('the shipped source transition clears both previous guards before activating the next source', async t => {
  const current = fixture(t)
  current.emit(selected, ['old-job'])
  await current.run()
  current.monitor.expectSearch(req => searchRequestMatches(req, source))
  const next = { type: 'search', keyword: '开发', positionCodes: [], confirmed: false,
    setToActiveSource: async () => current.emit({ ...selected, query: '开发' }, ['next-source']) }
  const code = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
  const start = code.indexOf('          const source = computedSourceList[currentSourceIndex]')
  const end = code.indexOf('          await storeStorage(page)', start)
  assert.ok(start > 0 && end > start)
  await vm.runInNewContext('(async () => {' + code.slice(start, end) + '})()', {
    computedSourceList: [next], currentSourceIndex: 0, page: current.page, jobResponseMonitor: current.monitor,
    searchRequestMatches, guardJobResponses: action => current.monitor.guard(action),
    checkJobResponses: () => current.monitor.assertHealthy(),
    activateSourceAndWait: async (_page, activate) => activate(),
  })
  assert.equal(next.confirmed, true)
  await current.monitor.assertHealthy()
})

test('a response that starts before readiness and decodes after it is checked against the newly armed scope', async t => {
  const current = fixture(t)
  current.emit(selected, ['old-job'])
  await current.monitor.assertHealthy()
  const evaluate = current.page.evaluate
  let calls = 0, release
  current.page.evaluate = async fn => {
    const view = await evaluate(fn)
    if (++calls === 2) current.emit({ ...selected, salary: '' }, ['late'], {
      json: () => new Promise(resolve => { release = resolve }),
    })
    return view
  }
  await current.run()
  release({ code: 0, zpData: { jobList: [{ encryptJobId: 'late' }] } })
  await assert.rejects(current.monitor.guard(() => assert.fail('must not process late rows')), /LOGIN_STATUS_UNKNOWN/)
})

test('closing a run releases retained list IDs and cannot repopulate them from a pending body', async t => {
  const current = fixture(t)
  let release
  current.emit(selected, ['first'])
  await current.monitor.assertHealthy()
  current.emit(selected, [], { json: () => new Promise(resolve => { release = resolve }) })
  await new Promise(resolve => setImmediate(resolve))
  current.monitor.dispose()
  release({ code: 0, zpData: { jobList: [{ encryptJobId: 'late' }] } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.monitor.getListSnapshot(), null)
})
