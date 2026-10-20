import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { classifyJobResponse, jobResponseKind, watchJobResponses } from '../boss-job-responses.mjs'

const listUrl = 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json'
const available = { code: 0, zpData: { jobList: [{ encryptJobId: 'job-a' }] } }
const response = (body, { url = listUrl, status = 200, json = async () => body, request } = {}) =>
  ({ url: () => url, status: () => status, json, request: () => request })
function monitored(t, options) {
  const page = new EventEmitter()
  const blocked = []
  const monitor = watchJobResponses(page, { onBlocked: error => blocked.push(error), ...options })
  t.after(() => monitor.dispose())
  return { page, monitor, blocked }
}

test('job responses distinguish empty results from authentication and restrictions', () => {
  assert.equal(classifyJobResponse(200, available).status, 'available')
  assert.equal(classifyJobResponse(200, { code: '0', zpData: { jobList: [] } }).status, 'empty')
  assert.equal(classifyJobResponse(200, { code: 0, zpData: { jobInfo: { encryptId: 'a' } } }, 'detail').status, 'available')
  for (const jobInfo of [{}, [], null])
    assert.equal(classifyJobResponse(200, { code: 0, zpData: { jobInfo } }, 'detail').status, 'unknown')
  for (const body of [{ code: 31 }, { code: '37' }, { code: 1, message: '请完成安全验证' }])
    assert.equal(classifyJobResponse(200, body).status, 'restricted')
  for (const status of [403, 429]) assert.equal(classifyJobResponse(status, null).status, 'restricted')
  assert.equal(classifyJobResponse(401, null).status, 'invalid')
  for (const body of [null, {}, { code: 0 }, { code: 0, zpData: {} }, { code: 2 }])
    assert.equal(classifyJobResponse(200, body).status, 'unknown')
  assert.equal(classifyJobResponse(503, available).status, 'unknown')
})
test('only BOSS job endpoints are monitored', () => {
  assert.equal(jobResponseKind(listUrl), 'list')
  assert.equal(jobResponseKind('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json?x=1'), 'list')
  assert.equal(jobResponseKind('https://www.zhipin.com/wapi/zpgeek/job/detail.json'), 'detail')
  for (const url of ['broken', 'https://example.com' + new URL(listUrl).pathname,
    'https://www.zhipin.com.example.com' + new URL(listUrl).pathname,
    'https://www.zhipin.com/wapi/zpuser/wap/getUserInfo.json']) assert.equal(jobResponseKind(url), null)
})

test('list diagnostics read POST search parameters and omit credentials and job payloads', async t => {
  const summaries = []
  const { page, monitor } = monitored(t, { onListResponse: value => summaries.push(value) })
  const body = { code: 0, zpData: { jobList: [], totalCount: 0, hasMore: false, secretToken: 'DO_NOT_LOG' } }
  page.emit('response', response(body, { request: { url: () => listUrl, postData: () => 'query=test&city=100010000&token=DO_NOT_LOG' } }))
  await monitor.assertHealthy()
  assert.equal(summaries[0].query, 'test')
  assert.equal(summaries[0].city, '100010000')
  assert.equal(summaries[0].count, 0)
  assert.equal(JSON.stringify(summaries).includes('DO_NOT_LOG'), false)
})
test('a second-page restriction blocks the next page without restarting or clearing credentials', async t => {
  const { page, monitor, blocked } = monitored(t)
  page.emit('response', response(available))
  await monitor.assertHealthy()
  page.emit('response', response({ code: 37, message: '环境存在异常' }))
  let thirdPage = 0
  await assert.rejects(monitor.guard(() => { thirdPage++ }), /LOGIN_STATUS_RESTRICTED/)
  assert.equal(thirdPage, 0)
  assert.equal(blocked.length, 1)
  page.emit('response', response(available))
  await assert.rejects(monitor.assertHealthy(), /LOGIN_STATUS_RESTRICTED/)
})
test('a restricted detail response blocks the send checkpoint', async t => {
  const { page, monitor } = monitored(t)
  page.emit('response', response({ code: 31 }, { url: 'https://www.zhipin.com/wapi/zpgeek/job/detail.json' }))
  let sent = false
  await assert.rejects(monitor.guard(() => { sent = true }), /LOGIN_STATUS_RESTRICTED/)
  assert.equal(sent, false)
})
test('an in-flight page wait is interrupted as soon as a restriction is decoded', async t => {
  const { page, monitor } = monitored(t)
  let actionStarted
  const started = new Promise(resolve => { actionStarted = resolve })
  const waiting = monitor.guard(() => { actionStarted(); return new Promise(() => {}) })
  await started
  page.emit('response', response({ code: 37 }))
  await assert.rejects(waiting, /LOGIN_STATUS_RESTRICTED/)
})
test('a response arriving during a body read is checked before the next action', async t => {
  const { page, monitor } = monitored(t)
  let resolveFirst, resolveSecond, acted = false
  page.emit('response', response(null, { json: () => new Promise(resolve => { resolveFirst = resolve }) }))
  const nextAction = monitor.guard(() => { acted = true })
  page.emit('response', response(null, { json: () => new Promise(resolve => { resolveSecond = resolve }) }))
  await new Promise(resolve => setImmediate(resolve))
  resolveFirst(available)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(acted, false)
  resolveSecond({ code: 37 })
  await assert.rejects(nextAction, /LOGIN_STATUS_RESTRICTED/)
  assert.equal(acted, false)
})
test('empty search results remain healthy and allow normal source rotation', async t => {
  const { page, monitor, blocked } = monitored(t)
  page.emit('response', response({ code: 0, zpData: { jobList: [] } }))
  assert.equal(await monitor.guard(() => 'next source'), 'next source')
  assert.deepEqual(blocked, [])
})
test('malformed data and unreadable restricted responses fail closed', async t => {
  for (const options of [{ json: async () => { throw Error('not JSON') } }, { status: 429, json: async () => { throw Error('blocked HTML') } }]) {
    const { page, monitor } = monitored(t)
    page.emit('response', response(null, options))
    await assert.rejects(monitor.assertHealthy(), options.status ? /LOGIN_STATUS_RESTRICTED/ : /LOGIN_STATUS_UNKNOWN/)
  }
})
test('an unreadable body has a bounded wait', async t => {
  const { page, monitor } = monitored(t, { bodyTimeoutMs: 5 })
  page.emit('response', response(null, { json: () => new Promise(() => {}) }))
  await assert.rejects(monitor.assertHealthy(), /LOGIN_STATUS_UNKNOWN/)
})
test('a known HTTP restriction blocks immediately without waiting for its response body', async t => {
  const { page, monitor } = monitored(t)
  let bodyReads = 0
  page.emit('response', response(null, { status: 429, json: () => { bodyReads++; return new Promise(() => {}) } }))
  await assert.rejects(monitor.assertHealthy(), /LOGIN_STATUS_RESTRICTED/)
  assert.equal(bodyReads, 0)
})
test('late responses from a different search scope pause instead of mixing results', async t => {
  const { page, monitor } = monitored(t)
  monitor.expectSearch(request => request.query === 'Python')
  page.emit('response', response(available, { request: { query: 'Java' } }))
  await assert.rejects(monitor.assertHealthy(), error => error.message === 'LOGIN_STATUS_UNKNOWN' && /不一致/.test(error.detail))
})
test('disposing a run releases its listener and cancels body reads without reporting a new failure', async t => {
  const { page, monitor, blocked } = monitored(t)
  page.emit('response', response(null, { json: () => new Promise(() => {}) }))
  assert.equal(page.listenerCount('response'), 1)
  monitor.dispose()
  assert.equal(page.listenerCount('response'), 0)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(blocked, [])
})
test('a failed progress callback does not disable the blocker', async t => {
  const { page, monitor } = monitored(t, { onBlocked: () => { throw Error('IPC closed') } })
  page.emit('response', response(null, { json: async () => { throw Error('invalid body') } }))
  await assert.rejects(monitor.assertHealthy(), /LOGIN_STATUS_UNKNOWN/)
})
test('closing a run cancels an outstanding guarded action', async t => {
  const { monitor } = monitored(t)
  let start
  const started = new Promise(resolve => { start = resolve })
  const waiting = monitor.guard(() => { start(); return new Promise(() => {}) })
  await started
  monitor.dispose()
  await assert.rejects(waiting, /AUTO_CHAT_JOB_PAGE_CLOSED/)
})
