import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { classifyBossLoginResponse, bossLoginError } from '../../utils/boss-login.mjs'
import { bindRunAccount } from '../run-account.mjs'
import { isSecurityCheckUrl } from '../security-check.mjs'
import { taskBrowserError } from '../browser-health.mjs'

// Run the actual login prefix, stopping before source browsing or any outreach.
const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
const start = source.indexOf('async function toRecommendPage (hooks)')
const prefix = source.slice(start, source.indexOf('  const computedSourceList = []', start)) + '\n}'
function run({ url = 'https://www.zhipin.com/web/geek/job', body, timeout = false, readyState = 'complete', rootReady = true, onLogin = async () => {} }) {
  const calls = [], navigation = []
  const ctx = vm.createContext({
    classifyBossLoginResponse, bossLoginError, bindRunAccount, isSecurityCheckUrl, taskBrowserError,
    runAccountId: null, browser: {}, recommendJobPageUrl: 'https://www.zhipin.com/web/geek/job',
    document: { readyState, querySelector: () => rootReady ? { __vue__: { jobList: [] } } : null }, location: { href: url },
    sleep: async () => {}, storeStorage: async () => calls.push('store'),
    writeStorageFile: async () => calls.push('clear'), autoStartChatEventBus: { emit() {} },
    page: {
      waitForResponse: async () => ({ json: async () => body, status: () => 200 }),
      goto: async (url, options) => { navigation.push({ url, options }) }, url: () => url,
      waitForFunction: async (fn, options, args) => {
        calls.push(args ? 'job-url' : 'document-ready')
        if (timeout || (args && url.includes('/web/user/'))) throw new Error('page was not ready')
        if (!fn(args)) throw new Error('page was not ready')
        assert.equal(options.timeout, 30000)
      }
    },
    hooks: { pageLoaded: { call: () => calls.push('loaded') }, userInfoResponse: { promise: onLogin } }
  })
  vm.runInContext(prefix, ctx)
  return { promise: vm.runInContext('toRecommendPage(hooks)', ctx), calls, ctx, navigation }
}

test('a login redirect reaches authentication handling without waiting for a job URL', async () => {
  const current = run({ url: 'https://www.zhipin.com/web/user/?ka=login', body: null, onLogin: async ({ httpStatus }) => {
    assert.equal(httpStatus, 401)
    throw new Error('LOGIN_HANDLER_REACHED')
  } })
  await assert.rejects(current.promise, /LOGIN_HANDLER_REACHED/)
  assert.deepEqual(current.calls, ['document-ready', 'loaded'])
})

test('restricted or unconfirmed user responses stop without clearing credentials', async () => {
  for (const body of [{ code: 37 }, { code: 1 }, { code: 0, zpData: {} }]) {
    const current = run({ body })
    await assert.rejects(current.promise, /LOGIN_STATUS_(RESTRICTED|UNKNOWN)/)
    assert.deepEqual(current.calls, ['document-ready'])
  }
})

test('confirmed identity precedes history hooks and successful page storage', async () => {
  const current = run({ body: { code: 0, zpData: { encryptUserId: 'account-a' } }, onLogin: async () => {
    assert.equal(current.ctx.runAccountId, 'account-a')
    current.calls.push('identity-hook')
  } })
  await current.promise
  assert.deepEqual(current.calls, ['document-ready', 'job-url', 'loaded', 'identity-hook', 'store'])
})

test('a page readiness timeout becomes a stable unconfirmed-login error', async () => {
  const current = run({ body: { code: 0 }, timeout: true })
  await assert.rejects(current.promise, /LOGIN_STATUS_UNKNOWN/)
  assert.deepEqual(current.calls, ['document-ready'])
})

test('an initial navigation left blank is diagnosed without clearing the saved login', async () => {
  const current = run({ url: 'about:blank', body: null })
  await assert.rejects(current.promise, error => error.message === 'AUTO_CHAT_BROWSER_UNAVAILABLE' && error.diagnostic.reason === 'blank')
  assert.deepEqual(current.calls, ['document-ready'])
})

test('interactive job documents can proceed without waiting for unrelated load completion', async () => {
  const current = run({ body: { code: 0, zpData: { encryptUserId: 'account-a' } }, readyState: 'interactive' })
  await current.promise
  assert.equal(current.navigation[0].options.waitUntil, 'domcontentloaded')
  assert.equal(current.ctx.runAccountId, 'account-a')
  assert.deepEqual(current.calls, ['document-ready', 'job-url', 'loaded', 'store'])
  const loading = run({ body: { code: 0, zpData: { encryptUserId: 'account-a' } }, readyState: 'loading' })
  await assert.rejects(loading.promise, /LOGIN_STATUS_UNKNOWN/)
  assert.equal(loading.calls.includes('store'), false)
  const missing = run({ body: { code: 0, zpData: { encryptUserId: 'account-a' } }, readyState: 'interactive', rootReady: false })
  await assert.rejects(missing.promise, /LOGIN_STATUS_UNKNOWN/)
  assert.equal(missing.calls.includes('store'), false)
})
