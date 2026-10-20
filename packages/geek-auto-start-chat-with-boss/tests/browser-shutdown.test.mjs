import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
const loop = source.slice(source.indexOf('async function runBrowserLoop (hooks)'), source.indexOf('export async function waitUntilSecurityCheckPassed'))
const close = source.slice(source.indexOf('export function closeBrowserWindow ()'), source.indexOf('async function storeStorage (page)')).replace('export ', '')

test('stopping during browser launch awaits and closes the newly owned browser before exit', async () => {
  let launch, finishClose
  const calls = [], owned = { name: 'owned fixture' }
  const context = vm.createContext({ puppeteer: {}, browser: null, page: null,
    browserOpening: null, browserClosing: null, jobRequestBudgetMonitor: null, jobResponseMonitor: null,
    runBudget: null, runInBackground: true, console,
    launchTaskBrowser: () => new Promise(resolve => { launch = resolve }),
    closeOwnedBrowser: browser => new Promise(resolve => { calls.push(browser); finishClose = resolve }) })
  vm.runInContext(loop + '\n' + close, context)
  const running = vm.runInContext('runBrowserLoop({})', context)
  let stopped = false
  const stopping = vm.runInContext('closeBrowserWindow()', context).then(() => { stopped = true })
  assert.equal(vm.runInContext('closeBrowserWindow()', context), context.browserClosing)
  launch({ browser: owned, page: {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stopped, false)
  assert.deepEqual(calls, [owned])
  const rejection = assert.rejects(running, /AUTO_CHAT_TASK_STOPPING/)
  finishClose()
  await stopping
  await rejection
  assert.equal(context.browser, null)
  assert.equal(context.page, null)
})
