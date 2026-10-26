import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { retryProblem } from '../automatic-retry.mjs'

const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
const loop = source.slice(source.indexOf('async function runBrowserLoop (hooks)'), source.indexOf('export async function waitUntilSecurityCheckPassed'))

test('switching a job card recovers in the same browser without registering duplicate hooks or resetting login', async () => {
  const counts = { launch: 0, close: 0, review: 0, hook: 0, cookies: 0, attach: 0, rebind: 0 }, browser = { connected: true }, page = { isClosed: () => false, url: () => 'https://www.zhipin.com/web/geek/jobs' }
  const ctx = vm.createContext({ puppeteer: {}, browser, page, browserOpening: null, browserClosing: null, keepBrowserForRecovery: false,
    hasLiveTaskBrowser: () => true, retryProblem, taskPageError: (_page, error) => error, isSecurityCheckUrl: () => false,
    abortBrowserAttempt() {}, disposeTaskMonitors() {}, runInBackground: true, runBudget: null,
    browserHealthMonitor: null, jobRequestBudgetMonitor: null, jobResponseMonitor: null,
    watchTaskBrowser: () => ({ dispose() {}, guard: action => action() }),
    attachJobRequestBudget: async () => { counts.attach++; return { dispose() {}, isActive: () => true, setBudget() { counts.rebind++ } } }, watchJobResponses: () => ({ dispose() {}, assertHealthy: async () => {} }),
    launchTaskBrowser: async () => { counts.launch++; throw Error('must reuse browser') }, closeBrowserWindow: async () => { counts.close++ },
    readStorageFile: () => { counts.cookies++; throw Error('must not replace current login') },
    autoStartChatEventBus: { emit() {} }, console: { debug() {}, error() {} },
    toRecommendPage: async () => { if (++counts.review === 1) throw Error('Node is detached from document') },
    hooks: { pageGotten: { call: () => counts.hook++ }, puppeteerLaunched: { call: () => counts.hook++ } },
  })
  vm.runInContext(loop, ctx)
  await assert.rejects(ctx.runBrowserLoop(ctx.hooks), /detached/)
  await ctx.runBrowserLoop(ctx.hooks)
  assert.deepEqual(counts, { launch: 0, close: 0, review: 2, hook: 0, cookies: 0, attach: 1, rebind: 1 })
  assert.equal(ctx.browser, browser); assert.equal(ctx.page, page)
})

test('preparing a live browser retry disposes only monitors and keeps the same owned window and spent usage', async () => {
  const code = source.slice(source.indexOf('export async function prepareForAutomaticRetry'), source.indexOf('\nfunction ensureRunBudget')).replace('export ', '')
  const calls = [], state = { accountId: 'a', position: { sourceIndex: 1, sourceSuccessCount: 4 }, budget: { usage: { requests: 19, detailRequests: 10, activeMs: 45000 } } }
  const ctx = vm.createContext({ hasLiveTaskBrowser: () => true, abortBrowserAttempt: () => calls.push('abort'), disposeTaskMonitors: () => calls.push('dispose'),
    closeBrowserWindow: () => assert.fail('a connected browser must not close'), exportRunState: () => structuredClone(state),
    importRunState: saved => { calls.push('restore'); assert.deepEqual(saved, state) }, jobRequestBudgetMonitor: { settled: async () => calls.push('settled') }, spent: state.budget })
  vm.runInContext('let keepBrowserForRecovery=false, runBudget={snapshot:()=>spent}, browserAttemptWork=Promise.resolve();\n' + code, ctx)
  await ctx.prepareForAutomaticRetry()
  assert.deepEqual(calls, ['abort', 'dispose', 'settled', 'restore']); assert.equal(vm.runInContext('keepBrowserForRecovery', ctx), false)
})
