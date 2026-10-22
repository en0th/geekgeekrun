import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { transformSync } from 'esbuild'
import { watchTaskBrowser, browserLaunchError, taskBrowserError, beginChatConfirmation, finishChatConfirmation } from '../browser-health.mjs'
import { launchTaskBrowser } from '../task-browser.mjs'
import { createRunBudget } from '../run-budget.mjs'
import { isResumableTaskExit } from '../../pm/task-exit.cjs'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../run-core-of-geek-auto-start-chat-with-boss/enums.mjs'

function fixture(t, onFailure) {
  const browser = new EventEmitter(), page = new EventEmitter(), failures = []
  const state = { url: 'https://www.zhipin.com/web/geek/job', closed: false }
  const frame = { url: () => state.url }
  browser.connected = true
  page.mainFrame = () => frame; page.isClosed = () => state.closed
  const monitor = watchTaskBrowser(browser, page, { onFailure: error => { failures.push(error); onFailure?.(error) } })
  t.after(() => monitor.dispose())
  const request = (url, { text = 'net::ERR_CONNECTION_RESET', main = true, navigation = true } = {}) => ({
    url: () => url, failure: () => ({ errorText: text }), frame: () => main ? frame : {}, isNavigationRequest: () => navigation,
  })
  return { browser, page, frame, state, monitor, failures, request }
}

test('launch failures become explicit pauses in both window modes and diagnostics omit raw paths and secrets', async () => {
  const cause = Object.assign(Error('Could not find Chrome at /private/person/token=secret ws://127.0.0.1/debugger'), { code: 'ENOENT' })
  for (const background of [false, true]) {
    await assert.rejects(launchTaskBrowser({ launch: async () => { throw cause } }, { background }), error => {
      assert.equal(error.message, 'AUTO_CHAT_BROWSER_UNAVAILABLE')
      assert.equal(error.diagnostic.reason, 'executable')
      assert.equal(/secret|private|debugger/.test(JSON.stringify(error) + error.stack), false)
      assert.equal(error.cause, undefined)
      return true
    })
  }
  assert.equal(browserLaunchError(Error('Timed out waiting for the WS endpoint')).diagnostic.reason, 'launch')
  assert.equal(taskBrowserError('launch', { cause: Error('/private/ERR_SECRET_CREDENTIAL') }).diagnostic.code, undefined)
})

test('crashes, closed pages and disconnected browsers interrupt an in-flight action and reject further actions once', async t => {
  for (const event of ['error', 'close', 'disconnected']) {
    const f = fixture(t); let started
    const began = new Promise(resolve => { started = resolve })
    const running = f.monitor.guard(() => { started(); return new Promise(() => {}) })
    await began
    ;(event === 'disconnected' ? f.browser : f.page).emit(event, Error('Page crashed'))
    await assert.rejects(running, /AUTO_CHAT_BROWSER_UNAVAILABLE/)
    await assert.rejects(f.monitor.guard(() => assert.fail('must not send')), /AUTO_CHAT_BROWSER_UNAVAILABLE/)
    f.browser.emit('disconnected')
    assert.equal(f.failures.length, 1)
  }
})

test('job request failures distinguish network, proxy and certificate problems without recording their URLs', async t => {
  for (const [code, reason] of [['ERR_CONNECTION_RESET', 'network'], ['ERR_PROXY_CONNECTION_FAILED', 'proxy'], ['ERR_CERT_DATE_INVALID', 'certificate']]) {
    const f = fixture(t)
    f.page.emit('requestfailed', f.request('https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=secret', { text: 'net::' + code }))
    await assert.rejects(f.monitor.guard(() => 'no action'), error => {
      assert.deepEqual(error.diagnostic, { stage: 'navigation', reason, code })
      assert.equal(JSON.stringify(error).includes('secret'), false)
      return true
    })
  }
})

test('aborted old requests, unrelated assets, other hosts, script errors and subframes do not stop a healthy task', async t => {
  const f = fixture(t)
  for (const [url, options] of [
    ['https://www.zhipin.com/wapi/zpgeek/search/joblist.json', { text: 'net::ERR_ABORTED' }],
    ['https://www.zhipin.com/static/main.js', { navigation: false }],
    ['https://example.com/wapi/zpgeek/job/detail.json', {}],
    ['https://www.zhipin.com/iframe', { main: false }],
  ]) f.page.emit('requestfailed', f.request(url, options))
  f.page.emit('pageerror', Error('site script error'))
  f.page.emit('framenavigated', { url: () => 'chrome-error://chromewebdata/' })
  assert.equal(await f.monitor.guard(() => 'continue'), 'continue')
  assert.equal(f.failures.length, 0)
})

test('main-document failures pause but a rendered security challenge remains available for a person', async t => {
  for (const status of [403, 429, 500, 503]) {
    const f = fixture(t), request = f.request(f.state.url)
    f.page.emit('response', { url: request.url, request: () => request, status: () => status })
    await assert.rejects(f.monitor.guard(() => 'no action'), status < 500 ? /LOGIN_STATUS_RESTRICTED/ : /AUTO_CHAT_BROWSER_UNAVAILABLE/)
  }
  const f = fixture(t), request = f.request('https://www.zhipin.com/web/common/security-check.html?token=secret')
  f.page.emit('response', { url: request.url, request: () => request, status: () => 403 })
  assert.doesNotThrow(f.monitor.assertHealthy)
})

test('browser error documents stop; the initial blank target is not mistaken for a failed navigation', async t => {
  const f = fixture(t); f.state.url = 'about:blank'; f.page.emit('framenavigated', f.frame)
  assert.doesNotThrow(f.monitor.assertHealthy)
  f.state.url = 'chrome-error://chromewebdata/'; f.page.emit('framenavigated', f.frame)
  await assert.rejects(f.monitor.guard(() => 'no action'), error => error.diagnostic.reason === 'blank')
})

test('a browser failure saves cumulative request/time use and a resumed budget retains it', async t => {
  let clock = 0, saved
  const budget = createRunBudget({ limits: { requests: 20, detailRequests: 20, activeMinutes: 0 }, now: () => clock,
    persist: value => { saved = structuredClone(value) }, setTimer: () => 1, clearTimer: () => {} })
  budget.resume(); budget.reserveRequest('list'); budget.reserveRequest('detail'); clock = 400
  const f = fixture(t, error => budget.fail(error))
  f.browser.emit('disconnected')
  await assert.rejects(budget.guard(() => assert.fail('cannot act after disconnect')), /BROWSER_UNAVAILABLE/)
  assert.deepEqual(saved.usage, { requests: 2, detailRequests: 1, activeMs: 400 })
  const resumed = createRunBudget({ limits: { requests: 20, detailRequests: 20, activeMinutes: 0 }, saved })
  assert.deepEqual(resumed.snapshot().usage, saved.usage)
})

test('disconnect after a greeting starts is unconfirmed, while a persisted confirmation permits an ordinary pause', async t => {
  for (const confirmed of [false, true]) {
    const f = fixture(t)
    beginChatConfirmation(f.page)
    if (confirmed) finishChatConfirmation(f.page)
    f.browser.emit('disconnected')
    await assert.rejects(f.monitor.guard(() => 'no action'), confirmed ? /BROWSER_UNAVAILABLE/ : /MESSAGE_SEND_UNCONFIRMED/)
  }
})

test('disposing the monitor before an owned browser closes releases listeners without reporting a failure', async t => {
  const f = fixture(t)
  f.monitor.dispose(); f.page.emit('close'); f.browser.emit('disconnected')
  assert.equal(f.failures.length, 0)
  for (const event of ['close', 'error', 'requestfailed', 'response', 'framenavigated']) assert.equal(f.page.listenerCount(event), 0)
  assert.equal(f.browser.listenerCount('disconnected'), 0)
  const page = new EventEmitter(), browser = new EventEmitter(); page.isClosed = () => true
  const early = watchTaskBrowser(browser, page)
  assert.throws(early.assertHealthy, /BROWSER_UNAVAILABLE/); early.dispose()
})

test('shipped GUI and CLI handlers stop without auto-retry; only pre-send browser errors are resumable', async () => {
  const files = ['../../ui/src/main/flow/GEEK_AUTO_START_CHAT_WITH_BOSS_MAIN/index.ts', '../../run-core-of-geek-auto-start-chat-with-boss/main.mjs']
  for (const file of files) {
    const raw = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    const start = raw.indexOf("        if (['AUTO_CHAT_BROWSER_UNAVAILABLE'")
    const end = raw.indexOf("        if (err.message.includes('AUTO_CHAT_PAGE_FILTER_NOT_APPLIED'))", start)
    assert.ok(start > 0 && end > start)
    const { code } = transformSync('(async () => {' + raw.slice(start, end) + '})()', { loader: 'ts', target: 'es2022' })
    for (const unconfirmed of [false, true]) {
      const calls = [], error = taskBrowserError('connection')
      if (unconfirmed) { error.message = 'AUTO_CHAT_MESSAGE_SEND_UNCONFIRMED'; error.detail = '发送结果未确认' }
      await vm.runInNewContext(code, { err: error, AUTO_CHAT_ERROR_EXIT_CODE,
        taskProgress: { update: (_kind, detail, state) => calls.push([state, detail]) }, saveResume: () => calls.push('save'),
        closeBrowserWindow: async () => calls.push('close'), process: { exit: value => calls.push(value) }, console: { error() {} } })
      assert.equal(calls.at(-1), unconfirmed ? 87 : 101)
      assert.equal(calls.includes('close'), true)
      if (file.endsWith('.ts')) { assert.equal(calls.includes('save'), true); assert.equal(calls[0][0], 'blocked') }
      assert.equal(isResumableTaskExit('geekAutoStartWithBossMain', calls.at(-1)), !unconfirmed)
    }
  }
})
