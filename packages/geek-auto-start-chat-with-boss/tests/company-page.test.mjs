import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import { normalizeJobSources, sourceFingerprintEntry } from '../search-source.mjs'
import { companyJobsUrl, isCompanyJobsDocument } from '../company-source.mjs'
import { companyFilterScope, companyFilteredUrl, companyRequestMatches, applyCompanyPageFilters,
  assertCompanyPlatformFilters, COMPANY_LIST_PATH } from '../company-page.mjs'
import { watchJobResponses } from '../boss-job-responses.mjs'
import { waitForCurrentJobList } from '../job-list-ready.mjs'
import { loadNextJobBatch, NoMatchBatchGuard, describeListScope } from '../auto-chat-navigation.mjs'
import { beginChatConfirmation } from '../browser-health.mjs'

const brand = '0123456789abcdef1nRz', other = 'fedcba98765432101nRz'
const source = { type: 'company', brandId: brand, keyword: '' }
const row = (id, brandId = brand) => ({ encryptJobId: id, encryptBrandId: brandId, city: 101280600 })
const detail = id => ({ jobInfo: { encryptId: id }, brandComInfo: { encryptBrandId: brand, scale: 306, industry: 100020 } })
function request(parameters, path = COMPANY_LIST_PATH) {
  return { url: () => 'https://www.zhipin.com' + path + '?' + new URLSearchParams(parameters) }
}
function fixture(t, { pages = [[row('first')], [row('second'), row('last')]], beforeSearch = () => {}, wrapped = false } = {}) {
  let currentUrl = companyJobsUrl(brand), clock = 0
  const page = new EventEmitter(), actions = []
  const view = { encryptBrandId: brand, isLogin: true, city: '', position: 0, queryParams: {}, currentPage: 1,
    pageSize: 15, totalCount: 30, jobLoading: false, jobList: pages[0], brandJobInfo: { hasMore: true },
    currentJob: pages[0][0], jobDetail: detail(pages[0][0]?.encryptJobId) }
  view.$store = { getters: { get isLogin() { return view.isLogin } } }
  Object.assign(view.brandJobInfo, { salaryList: [{ code: 404 }], experienceList: [{ code: 104 }], degreeList: [{ code: 203 }] })
  const emit = (parameters, rows, options = {}) => {
    const req = request(parameters, options.path), body = options.body ?? { code: 0, zpData: { jobList: rows } }
    page.emit('response', { url: req.url, request: () => req, status: () => options.status ?? 200,
      json: options.json || (async () => body) })
  }
  const parameters = () => ({ brandId: view.encryptBrandId, city: view.city, positionLv1: view.position,
    ...view.queryParams, page: view.currentPage })
  const load = number => {
    view.currentPage = number; view.jobList = pages[number - 1] || []; view.currentJob = view.jobList[0]
    view.jobDetail = detail(view.currentJob?.encryptJobId); view.brandJobInfo.hasMore = number < pages.length
    emit(parameters(), view.jobList)
  }
  view.searchAction = () => { actions.push('search'); beforeSearch(view); load(1) }
  view.onCurrentPageChange = number => { actions.push(number); load(number) }
  page.evaluate = async (fn, ...args) => vm.runInNewContext(typeof fn === 'string' ? fn : '(' + fn.toString() + ')(...args)', {
    args, document: { querySelector: selector => selector === '.page-company-position' ? { __vue__: wrapped ? { $children: [view] } : view }
      : selector === '.job-detail-box' ? { __vue__: { data: view.jobDetail } }
        : selector.startsWith('ul.') ? { querySelectorAll: () => view.jobList.map(() => ({ scrollIntoView() {} })) } : null }
  })
  page.url = () => currentUrl
  page.goto = async value => {
    currentUrl = value; const u = new URL(value)
    view.city = u.pathname.match(/\/c(\d+)\//)?.[1] || ''
    view.queryParams = Object.fromEntries(u.searchParams)
  }
  page.waitForFunction = async (fn, _options, ...args) => {
    assert.ok(await page.evaluate(fn, ...args)); return { dispose: async () => {} }
  }
  page.waitForResponse = (matches, { signal }) => new Promise((resolve, reject) => {
    const done = () => { page.off('response', listener); signal?.removeEventListener('abort', abort) }
    const listener = response => { if (matches(response)) { done(); resolve(response) } }
    const abort = () => { done(); reject(Error('aborted')) }
    page.on('response', listener); signal?.addEventListener('abort', abort)
  })
  const monitor = watchJobResponses(page)
  t.after(() => monitor.dispose())
  const pause = async ms => { clock += ms }
  const ready = options => waitForCurrentJobList({ page, monitor, source, now: () => clock, pause, timeoutMs: 300, ...options })
  const apply = (filters = {}) => {
    monitor.expectList()
    return applyCompanyPageFilters(page, source, filters, { checkResponses: () => monitor.assertHealthy(), pause })
  }
  const next = () => loadNextJobBatch({ page, list: {}, now: () => clock, pause, timeoutMs: 300, checkResponses: () => monitor.assertHealthy() })
  return { page, view, monitor, emit, parameters, ready, apply, next, actions }
}

test('company source configuration normalizes URLs, preserves order, deduplicates identity and binds resume to brand plus keyword', () => {
  const rows = [{ enabled: true, brandId: companyJobsUrl(brand), keyword: ' Java ' },
    { enabled: true, brandId: brand, keyword: 'Java', label: '展示备注' },
    { enabled: false, brandId: 'bad' }, { enabled: true, brandId: other }]
  const normalized = normalizeJobSources([{ type: 'company', enabled: true, children: rows }])
  assert.deepEqual(normalized, [{ ...source, keyword: 'Java' }, { ...source, brandId: other }])
  assert.notDeepEqual(sourceFingerprintEntry(source), sourceFingerprintEntry({ ...source, brandId: other }))
  assert.notDeepEqual(sourceFingerprintEntry(source), sourceFingerprintEntry({ ...source, keyword: 'Java' }))
  for (const children of [undefined, {}, [], [{ enabled: true, brandId: 'bad' }], [{ enabled: true, brandId: brand, keyword: 'x'.repeat(51) }]])
    assert.throws(() => normalizeJobSources([{ type: 'company', enabled: true, children }]), /公司|品牌/)
  assert.deepEqual(normalizeJobSources([{ type: 'company', enabled: false }]), [])
})

test('company URL filters use the native company route and reject unknown or multi-select codes before requesting', () => {
  const filters = { cityList: ['101280600'], salaryList: [404], experienceList: [104], degreeList: [203], industryList: [100020], scaleList: [306] }
  const u = new URL(companyFilteredUrl({ ...source, keyword: 'C++ & Java' }, filters))
  assert.equal(u.pathname, `/gongsi/job/c101280600/${brand}.html`)
  assert.equal(u.searchParams.get('query'), 'C++ & Java')
  assert.equal(u.searchParams.get('salary'), '404')
  assert.equal(isCompanyJobsDocument(u.href, brand), true)
  assert.equal(isCompanyJobsDocument(u.href, other), false)
  assert.equal(isCompanyJobsDocument('https://evil.example' + u.pathname), false)
  assert.equal(companyFilterScope(source, { cityList: ['100010000'] }).city, '')
  for (const [key, value] of [['salaryList', [404, 405]], ['degreeList', [999]], ['experienceList', [999]],
    ['scaleList', [999]], ['industryList', [999]], ['cityList', ['101999999']]])
    assert.throws(() => companyFilteredUrl(source, { [key]: value }), /COMPANY_SOURCE_NOT_CONFIRMED|选项/)
  const scope = companyFilterScope(source, filters)
  assert.equal(companyRequestMatches(request(scope), source, scope), true)
  for (const posted of [JSON.stringify(scope), new URLSearchParams(scope).toString()])
    assert.equal(companyRequestMatches({ url: () => 'https://www.zhipin.com' + COMPANY_LIST_PATH, postData: () => posted }, source, scope), true)
  for (const patch of [{ brandId: other }, { query: 'other' }, { salary: '' }, { positionLv1: '100000' }])
    assert.equal(companyRequestMatches(request({ ...scope, ...patch }), source, scope), false)
})

test('native filtering confirms the company request and rendered rows; industry/scale remain strict brand conditions', async t => {
  const f = fixture(t)
  assert.equal(await f.apply({ cityList: ['101280600'], salaryList: [404], industryList: [100020], scaleList: [306] }), true)
  assert.equal((await f.ready()).count, 1)
  assert.deepEqual(f.actions, ['search'])
  assertCompanyPlatformFilters(source, row('first'), detail('first'), { cityList: ['101280600'], industryList: [100020] })
  assert.throws(() => assertCompanyPlatformFilters(source, { ...row('first'), city: 101010100 }, detail('first'), { cityList: ['101280600'] }), /COMPANY_SOURCE_NOT_CONFIRMED/)
  assert.throws(() => assertCompanyPlatformFilters(source, row('first'), detail('first'), { scaleList: [301] }), /COMPANY_SOURCE_NOT_CONFIRMED/)
  assert.equal(await f.apply({ scaleList: [301] }), false)
})

test('a guest page, stale company identity or missing brand metadata cannot silently relax the company source', async t => {
  const guest = fixture(t); guest.view.isLogin = false
  await assert.rejects(guest.apply(), /COMPANY_SOURCE_NOT_CONFIRMED/)
  const foreign = fixture(t, { pages: [[row('foreign', other)]] })
  await assert.rejects(foreign.apply(), /LOGIN_STATUS_UNKNOWN|COMPANY_SOURCE_NOT_CONFIRMED/)
  const missing = fixture(t)
  missing.view.searchAction = () => { missing.view.jobDetail = null; missing.emit(missing.parameters(), missing.view.jobList) }
  await assert.rejects(missing.apply({ scaleList: [306] }), /COMPANY_SOURCE_NOT_CONFIRMED/)
})

test('a page that drops a filter or does not offer a selected native option pauses before rows are processed', async t => {
  const missingOption = fixture(t)
  await assert.rejects(missingOption.apply({ experienceList: [101] }), /COMPANY_SOURCE_NOT_CONFIRMED/)
  assert.deepEqual(missingOption.actions, [])
  const cleared = fixture(t)
  cleared.view.searchAction = () => {
    cleared.emit(cleared.parameters(), cleared.view.jobList)
    cleared.view.queryParams.salary = ''
  }
  await assert.rejects(cleared.apply({ salaryList: [404] }), /COMPANY_SOURCE_NOT_CONFIRMED/)
})

test('a company response timeout becomes a resumable source pause rather than an automatic retry', async t => {
  const f = fixture(t)
  f.page.waitForResponse = async () => { throw Object.assign(Error('timeout'), { name: 'TimeoutError' }) }
  await assert.rejects(f.apply(), error => error.message === 'AUTO_CHAT_COMPANY_SOURCE_NOT_CONFIRMED' && /网络/.test(error.detail))
})

test('company paging replaces the model and response IDs instead of requiring an accumulated infinite list', async t => {
  const f = fixture(t, { wrapped: true })
  await f.apply(); await f.ready()
  const next = await f.next()
  assert.equal(next.page, 2)
  assert.equal(next.hasMore, false)
  assert.deepEqual(f.monitor.getListSnapshot().ids, ['second', 'last'])
  assert.equal((await f.ready()).count, 2)
  assert.deepEqual(f.actions, ['search', 2])
  assert.deepEqual(await f.next(), { hasMore: false })
})

test('an empty company model needs a genuine matching empty response and an authenticated page', async t => {
  const f = fixture(t, { pages: [[]] })
  await assert.rejects(f.ready(), /PAGE_FILTER_NOT_APPLIED/)
  await f.apply(); assert.equal((await f.ready()).count, 0)
  f.view.isLogin = false
  await assert.rejects(f.ready(), /COMPANY_SOURCE_NOT_CONFIRMED/)
})

test('a late response or body cannot replace current page IDs or introduce another company', async t => {
  const f = fixture(t)
  let release
  f.emit(f.parameters(), [], { json: () => new Promise(resolve => { release = resolve }) })
  await new Promise(resolve => setImmediate(resolve))
  f.view.onCurrentPageChange(2)
  release({ code: 0, zpData: { jobList: [row('old-first')] } })
  await f.monitor.assertHealthy()
  assert.deepEqual(f.monitor.getListSnapshot().ids, ['second', 'last'])
  await f.ready()
  f.emit({ ...f.parameters(), brandId: other }, [row('foreign', other)])
  await assert.rejects(f.monitor.guard(() => assert.fail('must not process foreign rows')), /LOGIN_STATUS_UNKNOWN/)
})

test('restrictions on the next company page and HTML document pause before another action', async t => {
  for (const options of [{ status: 429 }, { status: 403 }, { body: { code: 31 } }, { body: { code: 37 } }]) {
    const f = fixture(t); await f.apply(); await f.ready()
    f.view.onCurrentPageChange = number => f.emit({ ...f.parameters(), page: number }, [], options)
    await assert.rejects(f.next(), /LOGIN_STATUS_RESTRICTED/)
  }
  const f = fixture(t)
  f.page.emit('response', { url: () => companyJobsUrl(brand), status: () => 403, json: () => assert.fail('HTML must not be decoded as JSON') })
  await assert.rejects(f.monitor.assertHealthy(), /LOGIN_STATUS_RESTRICTED/)
})

test('company pagination stops when the site stalls, changes brand, or loses login', async t => {
  for (const mutate of [() => {}, v => { v.encryptBrandId = other }, v => { v.isLogin = false }]) {
    const f = fixture(t); await f.apply(); await f.ready()
    f.view.onCurrentPageChange = () => mutate(f.view)
    await assert.rejects(f.next(), /LIST_STALLED|COMPANY_SOURCE_NOT_CONFIRMED/)
  }
})

test('the shipped collect loop saves every job on the final replacement page without reaching greeting or marking', async t => {
  const f = fixture(t, { wrapped: true }); await f.apply(); await f.ready()
  const handles = () => ({ dispose: async () => {} })
  f.page.waitForSelector = async () => handles()
  f.page.$ = async () => handles()
  const saved = [], progress = [], blocked = new Set()
  const code = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
  const start = code.indexOf('          const { targetJobIndex, targetJobData, matchedJobId } = await new Promise')
  const end = code.indexOf('          // last line of defence', start)
  assert.ok(start > 0 && end > start)
  const context = {
    page: f.page, computedSourceList: [source], currentSourceIndex: 0, jobResponseMonitor: f.monitor,
    waitForCurrentJobList, loadNextJobBatch, NoMatchBatchGuard, describeListScope, assertCompanyPlatformFilters,
    filterCondition: {}, isCollectAll: true, isCollectMode: true, runBudget: null,
    blockJobNotSuit: blocked, blockBossNotActive: new Set(), blockBossNotNewChat: new Set(), expectCompanySet: new Set(),
    guardJobResponses: fn => f.monitor.guard(fn), checkJobResponses: () => f.monitor.assertHealthy(),
    waitForSageTimeOrJustContinue: async () => {}, sleep: async () => {}, sleepWithRandomDelay: async () => {},
    jobListLoadWaitSeconds: 0, jobDetailViewWaitSeconds: 0, countSourceSuccess: () => false,
    autoStartChatEventBus: { emit: (_name, value) => progress.push(value) },
    openJobCardForReview: async ({ index, jobId }) => {
      assert.equal(f.view.jobList[index].encryptJobId, jobId)
      f.view.currentJob = f.view.jobList[index]; f.view.jobDetail = detail(jobId)
    },
    hooks: { jobDetailIsGetFromRecommendList: { promise: async value => saved.push(value.jobInfo.encryptId) },
      checkpoint: { promise: async () => {} }, newChatWillStartup: { promise: () => assert.fail('collection cannot send') },
      jobMarkedAsNotSuit: { promise: () => assert.fail('collection cannot mark') } },
  }
  await assert.rejects(vm.runInNewContext('(async () => {' + code.slice(start, end) + '})()', context), /CANNOT_FIND_EXCEPT_JOB_IN_THIS_FILTER_CONDITION/)
  assert.deepEqual(saved, ['first', 'second', 'last'])
  assert.equal(progress.filter(item => item.kind === 'collected').length, 3)
  assert.deepEqual([...blocked], saved)
})

test('a confirmed empty company combination advances the shipped filter loop without waiting for nonexistent cards', async t => {
  const f = fixture(t, { wrapped: true, pages: [[]] }); await f.apply()
  const code = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
  const start = code.indexOf('        const readyList = await guardJobResponses')
  const end = code.indexOf('        try {', start)
  const progress = [], inspected = []
  await vm.runInNewContext('(async () => { iterateFilterCondition: for (let i = 0; i < 2; i++) {' + code.slice(start, end) + 'inspected.push(i) } })()', {
    page: f.page, jobResponseMonitor: f.monitor, computedSourceList: [source], currentSourceIndex: 0,
    waitForCurrentJobList, checkJobResponses: () => f.monitor.assertHealthy(), guardJobResponses: fn => f.monitor.guard(fn),
    autoStartChatEventBus: { emit: (_type, data) => progress.push(data) }, inspected,
  })
  assert.deepEqual(inspected, [])
  assert.equal(progress.filter(item => item.detail?.includes('没有岗位')).length, 2)
})

test('the shipped final click rechecks company and job after the last asynchronous checkpoint', async t => {
  const code = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
  const start = code.indexOf('          await checkJobResponses()', code.indexOf('          const sourceUrlBeforeGreet ='))
  const end = code.indexOf('          const waitAddFriendResponse =', start)
  assert.ok(start > 0 && end > start)
  for (const mode of ['changed-brand', 'changed-job', 'same']) {
    const f = fixture(t, { wrapped: true }); let clicks = 0
    const confirmations = []
    const context = { page: f.page, computedSourceList: [source], currentSourceIndex: 0, filterCondition: {},
      targetJobData: detail('first'), runBudget: null, assertCompanyPlatformFilters, startChatButtonProxy: {}, beginChatConfirmation,
      autoStartChatEventBus: { emit: (event, pending) => { assert.equal(event, 'CHAT_CONFIRMATION'); confirmations.push(pending) } },
      checkJobResponses: async () => {
        if (mode === 'changed-brand') f.view.currentJob = row('first', other)
        if (mode === 'changed-job') { f.view.currentJob = row('different'); f.view.jobDetail = detail('different') }
      }, clickTaskElement: async () => { clicks++ },
    }
    const run = () => vm.runInNewContext('(async () => {' + code.slice(start, end) + '})()', context)
    if (mode === 'same') { await run(); assert.equal(clicks, 1); assert.deepEqual(confirmations, [true]) }
    else { await assert.rejects(run(), /COMPANY_SOURCE_NOT_CONFIRMED/); assert.equal(clicks, 0); assert.deepEqual(confirmations, []) }
  }
})
