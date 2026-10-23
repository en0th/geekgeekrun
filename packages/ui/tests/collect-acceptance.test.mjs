import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { transformSync } from 'esbuild'
import { SyncHook, AsyncSeriesHook } from 'tapable'

const source = fs.readFileSync(new URL('../src/main/features/collect-acceptance.ts', import.meta.url), 'utf8')
const { code } = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' })
const { attachCollectAcceptance } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

function fixture(t, { company = false, failGuard = false } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-collect-audit-'))
  const previous = new Set(process.listeners('exit'))
  t.after(() => {
    for (const listener of process.listeners('exit')) if (!previous.has(listener)) process.off('exit', listener)
    fs.rmSync(folder, { recursive: true, force: true })
  })
  const hooks = { pageGotten: new SyncHook(['page']), cookieWillSet: new AsyncSeriesHook(['cookies']),
    jobDetailIsGetFromRecommendList: new AsyncSeriesHook(['detail']) }
  const events = new EventEmitter(), page = new EventEmitter(), calls = []
  const companyView = { jobList: [], currentPage: 2, encryptBrandId: 'verified-brand', city: '101280600',
    queryParams: { query: '配送', degree: '203' }, $store: { getters: { isLogin: true } },
    currentJob: { encryptJobId: 'company-job', encryptBrandId: 'verified-brand' } }
  const jobsView = { formData: { query: 'Java', city: '101010100', degree: '203' }, currentJob: { encryptJobId: 'search-job' } }
  const session = { send: async (method, params) => {
    calls.push({ method, params })
    if (failGuard && method === 'Network.setBlockedURLs') throw Error('Guard setup failed')
    return { bounds: { windowState: 'minimized' } }
  }, detach: async () => calls.push({ method: 'detach' }) }
  page.createCDPSession = async () => session
  page.evaluate = async fn => vm.runInNewContext('(' + fn.toString() + ')()', { globalThis: { document: {
    visibilityState: 'hidden', querySelector: selector => selector === '.page-company-position' && company
      ? { __vue__: { $children: [companyView] } } : selector === '.page-jobs-main'
        ? { __vue__: jobsView } : selector === '.job-detail-box' ? { innerText: 'visible sample detail' } : null
  } } })
  attachCollectAcceptance({ folder, hooks, events, runMode: 'collect', runRecordId: 7 })
  hooks.pageGotten.call(page)
  const records = () => fs.readFileSync(path.join(folder, 'run-7.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  return { folder, hooks, events, page, calls, records }
}

test('acceptance is opt-in and rejects greeting mode before attaching any browser hooks', () => {
  assert.doesNotThrow(() => attachCollectAcceptance({ folder: '', runMode: 'chat' }))
  assert.throws(() => attachCollectAcceptance({ folder: os.tmpdir(), runMode: 'chat' }), /collect mode/)
})

test('acceptance blocks side-effect endpoints before restoring cookies and retains the agent until page close', async t => {
  const f = fixture(t)
  await f.hooks.cookieWillSet.promise({ cookies: [] })
  const urls = f.calls.find(x => x.method === 'Network.setBlockedURLs').params.urls
  assert.ok(urls.includes('*://*.zhipin.com/wapi/zpchat/*/send*'))
  assert.ok(urls.includes('*://*.zhipin.com/wapi/zpgeek/friend/add*'))
  assert.equal(urls.includes('*://*.zhipin.com/wapi/zpchat/*'), false)
  assert.equal(urls.includes('*://*.zhipin.com/wapi/zpgeek/friend/*'), false)
  assert.ok(urls.includes('*://zhipin.com/wapi/zpgeek/job/notmatch*'))
  assert.ok(urls.includes('*://*.zhipin.com/wapi/zpgeek/negativefeedback/*'))
  assert.equal(f.calls.some(x => x.method === 'detach'), false)
  assert.equal(f.records().at(-1).kind, 'side-effects-blocked')
  f.page.emit('close')
  assert.equal(f.calls.at(-1).method, 'detach')
  const bad = fixture(t, { failGuard: true })
  await assert.rejects(bad.hooks.cookieWillSet.promise({ cookies: [] }), /Guard setup failed/)
  assert.equal(bad.records().some(x => x.kind === 'side-effects-blocked'), false)
  assert.equal(bad.calls.at(-1).method, 'detach')
})

test('network evidence distinguishes communication and marking without copying URLs, bodies or credentials', t => {
  const f = fixture(t)
  for (const url of ['https://www.zhipin.com/wapi/zpgeek/brand/job/querylist.json', 'https://zhipin.com.evil.test/wapi/zpchat/send.json'])
    f.page.emit('request', { url: () => url, method: () => 'GET' })
  f.page.emit('request', { url: () => 'https://www.zhipin.com/wapi/zpchat/geek/getUnreadCount.json', method: () => 'GET' })
  assert.equal(f.records().at(-1).kind, 'protected-request')
  f.page.emit('request', { url: () => 'https://www.zhipin.com/wapi/zpgeek/negativefeedback/reasons.json', method: () => 'GET' })
  assert.equal(f.records().at(-1).kind, 'protected-request')
  for (const url of ['https://www.zhipin.com/wapi/zpgeek/friend/add.json?token=secret', 'https://www.zhipin.com/wapi/zpchat/geek/sendMsg?token=secret', 'https://www.zhipin.com/wapi/zpgeek/job/notmatch?token=secret', 'https://www.zhipin.com/wapi/zpgeek/negativefeedback/submit.json?token=secret'])
    f.page.emit('request', { url: () => url, method: () => 'POST' })
  const rows = f.records().filter(x => x.kind === 'side-effect-request')
  assert.deepEqual(rows.map(x => x.operation), ['communication', 'communication', 'mark', 'mark'])
  assert.equal(/secret|https:|token|sendMsg/.test(JSON.stringify(rows)), false)
})

test('company evidence records the selected job, confirmed native scope, page and login while search evidence is preserved', async t => {
  for (const company of [false, true]) {
    const f = fixture(t, { company })
    await f.hooks.jobDetailIsGetFromRecommendList.promise({ jobInfo: { encryptId: company ? 'company-job' : 'search-job' },
      brandComInfo: { encryptBrandId: 'verified-brand' } })
    const review = f.records().find(x => x.kind === 'review')
    assert.equal(review.row.encryptJobId, company ? 'company-job' : 'search-job')
    assert.equal(review.source, company ? 'company' : 'jobs')
    assert.equal(review.scope.city, company ? '101280600' : '101010100')
    assert.equal(review.scope.query, company ? '配送' : 'Java')
    assert.equal(review.pageNumber, company ? 2 : null)
    assert.equal(review.loggedIn, company ? true : null)
    assert.equal(review.brandComInfo.encryptBrandId, 'verified-brand')
    assert.equal(review.windowState, 'minimized')
    f.events.emit('TASK_PROGRESS', { kind: 'collected', detail: 'accepted' })
    assert.equal(f.records().at(-1).jobId, review.jobInfo.encryptId)
    assert.equal(f.records().at(-1).accepted, true)
  }
})

test('unexpected sent or marked progress is recorded as a failed collection boundary', t => {
  const f = fixture(t)
  for (const kind of ['sent', 'marked']) assert.throws(() => f.events.emit('TASK_PROGRESS', { kind }), /must not send messages or mark jobs/)
  assert.deepEqual(f.records().slice(1).map(x => x.kind), ['unexpected-send', 'unexpected-mark'])
})

test('early job-response failures retain safe status and shape without response bodies or URLs', async t => {
  const f = fixture(t)
  for (const [status, body] of [[200, { code: 0, zpData: { jobList: [] } }],
    [200, { code: 31, message: 'private-account token=secret', zpData: null }], [200, null]]) {
    f.page.emit('response', { url: () => 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?token=secret',
      status: () => status, json: async () => { if (!body) throw Error('private HTML'); return body } })
  }
  await new Promise(resolve => setImmediate(resolve))
  const rows = f.records().filter(x => x.kind === 'job-response')
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map(x => x.format), ['json', 'json', 'unreadable'])
  assert.deepEqual(rows.map(x => x.code), [0, 31, null])
  assert.deepEqual(rows.map(x => x.listArray), [true, false, false])
  assert.equal(/secret|private|https:|token|HTML/.test(JSON.stringify(rows)), false)
})
