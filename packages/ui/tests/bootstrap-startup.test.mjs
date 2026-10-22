import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../src/renderer/src/page/BootstrapSplash/index.vue', import.meta.url), 'utf8')
const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
function bootstrap(invoke) {
  const routes = []
  let start
  vm.runInNewContext(script, {
    useRouter: () => ({ replace: route => routes.push(route) }),
    onMounted: callback => { start = callback },
    electron: { ipcRenderer: { invoke } }, console: { log() {} },
  })
  return { routes, start }
}

test('startup waits for the native first-use and browser checks before opening the workspace', async () => {
  let complete
  const current = bootstrap(channel => {
    assert.equal(channel, 'pre-enter-setting-ui')
    return new Promise(resolve => { complete = resolve })
  })
  const started = current.start()
  await Promise.resolve()
  assert.deepEqual(current.routes, [])
  complete()
  await started
  assert.deepEqual(current.routes, ['/ux/auto'])
})

test('a failed preflight retains the existing route fallback instead of leaving a permanent splash', async () => {
  const current = bootstrap(async () => { throw Error('preflight unavailable') })
  await current.start()
  assert.deepEqual(current.routes, ['/ux/auto'])
})
