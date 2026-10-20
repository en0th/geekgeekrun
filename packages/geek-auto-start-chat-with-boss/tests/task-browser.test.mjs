import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { launchTaskBrowser, showTaskBrowser } from '../task-browser.mjs'
import { clickTaskElement, hoverTaskElement } from '../task-page-input.mjs'
import { setDomainLocalStorage } from '../../utils/puppeteer/local-storage.mjs'
import { readRunSettings } from '../run-settings.mjs'
import { jobConfigSnapshot } from '../task-config-snapshot.mjs'

function fixture({ oldChrome = false, cannotMinimize = false } = {}) {
  const calls = [], state = { url: '', window: 'normal' }
  const session = { send: async (command, params) => {
    calls.push({ command, params })
    if (command === 'Target.createTarget') { state.url = params.url; if (!oldChrome) state.window = params.windowState; return { targetId: 'task' } }
    if (command === 'Browser.setWindowBounds' && !cannotMinimize) state.window = params.bounds.windowState
    return { windowId: 1, bounds: { windowState: cannotMinimize ? 'normal' : state.window } }
  }, detach: async () => calls.push('detach') }
  const page = { createCDPSession: async () => session, bringToFront: async () => calls.push('activate') }
  const browser = { target: () => ({ createCDPSession: async () => session }),
    waitForTarget: async predicate => { const target = { url: () => state.url, page: async () => page }; assert.ok(predicate(target)); return target },
    pages: async () => [page], close: async () => calls.push('close') }
  const puppeteer = { launch: async options => { calls.push({ launch: options }); return browser } }
  return { calls, state, page, browser, puppeteer }
}

test('background launch creates its first headed window minimized without activating a page', async () => {
  const f = fixture(), result = await launchTaskBrowser(f.puppeteer)
  assert.equal(result.page, f.page)
  const launch = f.calls[0].launch
  assert.equal(launch.headless, false)
  assert.equal(launch.waitForInitialPage, false)
  assert.deepEqual(launch.args, ['--no-startup-window'])
  const create = f.calls.find(call => call.command === 'Target.createTarget').params
  assert.equal(create.background, true)
  assert.equal(create.windowState, 'minimized')
  assert.equal(f.state.window, 'minimized')
  assert.ok(!f.calls.includes('activate'))
  assert.equal(f.calls.at(-1), 'detach')
})

test('older browsers are explicitly minimized; unconfirmed background state closes and stops', async () => {
  const f = fixture({ oldChrome: true })
  await launchTaskBrowser(f.puppeteer)
  assert.equal(f.state.window, 'minimized')
  const bad = fixture({ cannotMinimize: true })
  await assert.rejects(launchTaskBrowser(bad.puppeteer), error => {
    assert.match(error.message, /AUTO_CHAT_BACKGROUND_WINDOW_UNAVAILABLE/)
    assert.match(error.detail, /后台/)
    return true
  })
  assert.ok(bad.calls.includes('close'))
  assert.ok(!bad.calls.includes('activate'))
})

test('ordinary windows remain opt-in, while a security handoff restores and activates the same window', async () => {
  const visible = fixture()
  await launchTaskBrowser(visible.puppeteer, { background: false })
  assert.equal(visible.calls[0].launch.waitForInitialPage, undefined)
  assert.equal(visible.calls[0].launch.args, undefined)
  const bg = fixture()
  await launchTaskBrowser(bg.puppeteer)
  await showTaskBrowser(bg.page)
  assert.equal(bg.state.window, 'normal')
  assert.equal(bg.calls.at(-2), 'activate')
  assert.equal(bg.calls.at(-1), 'detach')
})

test('minimized controls do not wait for IntersectionObserver or stale painted hit-test data', async () => {
  const f = fixture(), input = []
  f.page.mouse = { click: async (x, y) => input.push(['click', x, y]), move: async (x, y) => input.push(['hover', x, y]) }
  let visibility = 'visible'
  const domNode = { isConnected: true, getClientRects: () => [{}], getAttribute: () => null, click: () => input.push('dom-click') }
  const element = { evaluate: async (fn,...args) => vm.runInNewContext('(' + fn.toString() + ')(node,...args)', {
    node: domNode, args, getComputedStyle: () => ({ display: 'block', visibility }) }),
    scrollIntoView: async () => input.push('scroll'), clickablePoint: async () => ({ x: 42, y: 23 }),
    click: () => { throw Error('IntersectionObserver must not run') }, hover: () => { throw Error('IntersectionObserver must not run') } }
  await launchTaskBrowser(f.puppeteer)
  await clickTaskElement(f.page, element); await hoverTaskElement(f.page, element)
  assert.deepEqual(input, ['dom-click', 'scroll', ['hover', 42, 23]])
  visibility = 'hidden'
  await assert.rejects(clickTaskElement(f.page, element), /not available/)
  await clickTaskElement(f.page, element, { allowHidden: true })
  assert.equal(input.at(-1), 'dom-click')
  domNode.isConnected = false
  await assert.rejects(clickTaskElement(f.page, element), /not available/)
  assert.ok(!f.calls.includes('activate'))
})

test('background choice survives task snapshots with explicit false and defaults enabled', () => {
  assert.equal(readRunSettings({}).runInBackground, true)
  assert.equal(readRunSettings({ autoChatRunInBackground: false }).runInBackground, false)
  const config = jobConfigSnapshot({ 'boss.json': { autoChatRunInBackground: false }, 'target-company-list.json': [] })
  assert.equal(config['boss.json'].autoChatRunInBackground, false)
})

function storageFixture(failed = false) {
  const calls = [], values = new Map(); let requestListener
  const page = {
    setRequestInterception: async value => calls.push(['intercept', value]),
    on: (event, listener) => { assert.equal(event, 'request'); requestListener = listener },
    off: (event, listener) => { assert.equal(event, 'request'); assert.equal(listener, requestListener); requestListener = null },
    goto: async () => { if (failed) throw Error('navigation failed'); requestListener({ respond: async () => {} }) },
    evaluate: async (fn, kv) => vm.runInNewContext('(' + fn.toString() + ')(kv)', { kv,
      localStorage: { setItem: (key, value) => values.set(key, String(value)) } }),
    close: async () => calls.push('close'),
  }
  const browser = { newPage: async () => { calls.push('new-page'); return page } }
  return { page, browser, calls, values }
}

test('restoring storage in the task tab does not create a foreground tab and removes interception', async () => {
  const f = storageFixture()
  await setDomainLocalStorage(f.browser, 'https://example.test', { sample: 'value' }, { page: f.page })
  assert.equal(f.values.get('sample'), 'value')
  assert.deepEqual(f.calls, [['intercept', true], ['intercept', false]])
  const bad = storageFixture(true)
  await assert.rejects(setDomainLocalStorage(bad.browser, 'https://example.test', {}, { page: bad.page }), /navigation failed/)
  assert.deepEqual(bad.calls, [['intercept', true], ['intercept', false]])
})

test('manual browsing callers retain the temporary storage tab and close it even on failure', async () => {
  for (const failed of [false, true]) {
    const f = storageFixture(failed)
    const operation = setDomainLocalStorage(f.browser, 'https://example.test', {})
    if (failed) await assert.rejects(operation, /navigation failed/)
    else await operation
    assert.deepEqual(f.calls, ['new-page', ['intercept', true], 'close'])
  }
})
