import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { CDPSessionEvent } = require('puppeteer')
import { createRunBudget } from '../run-budget.mjs'
import { attachJobRequestBudget } from '../job-request-budget.mjs'

const list = 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=Python'
const detail = 'https://www.zhipin.com/wapi/zpgeek/job/detail.json?jobId=test'
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture({ requests = 3, detailRequests = 3, persist, send } = {}) {
  const calls = [], session = new EventEmitter()
  session.send = async (method, args) => { calls.push({ method, args }); await send?.(method, args) }
  const budget = createRunBudget({ limits: { requests, detailRequests, activeMinutes: 0 }, persist })
  const page = { createCDPSession: async () => session }
  return { page, session, budget, calls, request: (url, id = 'req') => session.emit('Fetch.requestPaused', { requestId: id, request: { url } }) }
}

test('concurrent intercepted requests cannot overrun the cap and are charged before release', async () => {
  let saved = 0, released = 0
  const f = fixture({ persist: state => { saved = state.usage.requests }, send: method => {
    if (method === 'Fetch.continueRequest') { released++; assert.ok(saved >= released) }
  } })
  const monitor = await attachJobRequestBudget(f.page, f.budget)
  for (let i = 0; i < 12; i++) f.request(i % 2 ? detail : list, 'req-' + i)
  await flush()
  assert.equal(f.budget.snapshot().usage.requests, 3)
  assert.equal(f.calls.filter(c => c.method === 'Fetch.continueRequest').length, 3)
  assert.equal(f.calls.filter(c => c.method === 'Fetch.failRequest').length, 9)
  await assert.rejects(f.budget.guard(() => 'no more work'), /RUN_BUDGET_EXCEEDED/)
  monitor.dispose()
})

test('only job list/detail endpoints count, not identity, messages, assets or lookalike hosts', async () => {
  const f = fixture({ requests: 20, detailRequests: 20 })
  const monitor = await attachJobRequestBudget(f.page, f.budget)
  for (const url of ['https://www.zhipin.com/wapi/zpuser/wap/getUserInfo.json',
    'https://www.zhipin.com/wapi/zpgeek/friend/add.json', 'https://www.zhipin.com/static/main.js',
    'https://evilzhipin.com/wapi/zpgeek/job/detail.json']) f.request(url)
  f.request(list); f.request(list); f.request(detail)
  await flush()
  assert.equal(f.budget.snapshot().usage.requests, 3)
  assert.equal(f.budget.snapshot().usage.detailRequests, 1)
  assert.ok(f.calls[0].args.patterns.every(p => p.requestStage === 'Request'))
  monitor.dispose()
})

test('failed ledger writes abort the intercepted request instead of releasing it', async () => {
  const f = fixture({ persist: () => { throw Error('readonly volume') } })
  const monitor = await attachJobRequestBudget(f.page, f.budget)
  f.request(detail)
  await flush()
  assert.equal(f.calls.filter(c => c.method === 'Fetch.continueRequest').length, 0)
  assert.equal(f.calls.at(-1).method, 'Fetch.failRequest')
  await assert.rejects(f.budget.guard(() => 1), /RUN_BUDGET_UNAVAILABLE/)
  monitor.dispose()
})

test('company documents, filter loads and pagination share the durable request cap', async () => {
  const f = fixture({ requests: 3 })
  const monitor = await attachJobRequestBudget(f.page, f.budget)
  const brand = '0123456789abcdef1nRz'
  f.request(`https://www.zhipin.com/gongsi/job/c101280600/${brand}.html?salary=404`, 'document')
  f.request(`https://www.zhipin.com/wapi/zpgeek/brand/job/querylist.json?brandId=${brand}&page=1`, 'filter')
  f.request(`https://www.zhipin.com/wapi/zpgeek/brand/job/querylist.json?brandId=${brand}&page=2`, 'page2')
  f.request(`https://www.zhipin.com/wapi/zpgeek/brand/job/querylist.json?brandId=${brand}&page=3`, 'page3')
  await flush()
  assert.equal(f.budget.snapshot().usage.requests, 3)
  assert.equal(f.budget.snapshot().usage.detailRequests, 0)
  assert.deepEqual(f.calls.filter(c => c.method === 'Fetch.failRequest').map(c => c.args.requestId), ['page3'])
  await assert.rejects(f.budget.guard(() => 1), /RUN_BUDGET_EXCEEDED/)
  monitor.dispose()
})

test('lost interception and failed attachment fail closed; disposing is silent', async () => {
  assert.equal(CDPSessionEvent.Disconnected, require('puppeteer-extra').pptr.CDPSessionEvent.Disconnected)
  const f = fixture()
  const monitor = await attachJobRequestBudget(f.page, f.budget)
  f.session.emit(CDPSessionEvent.Disconnected)
  await assert.rejects(f.budget.guard(() => 1), /RUN_BUDGET_UNAVAILABLE/)
  monitor.dispose()
  const other = fixture()
  const disposed = await attachJobRequestBudget(other.page, other.budget)
  disposed.dispose(); other.session.emit(CDPSessionEvent.Disconnected)
  assert.equal(other.budget.snapshot().stopped, false)
  const failed = fixture({ send: method => { if (method === 'Fetch.enable') throw Error('unsupported') } })
  await assert.rejects(attachJobRequestBudget(failed.page, failed.budget), /RUN_BUDGET_UNAVAILABLE/)
})
