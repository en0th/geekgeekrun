import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { AsyncSeriesHook } from 'tapable'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-login-test-'))
const outfile = path.join(dir, 'plugin.cjs')
await build({ entryPoints: [path.join(here, '../src/main/features/cookie-invalid-handle-plugin.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', plugins: [{
    name: 'isolated-login-services', setup(builder) {
      builder.onResolve({ filter: /connect-to-daemon|runtime-file-utils|login-with-cookie-assistant|utils\/cookie$|utils\/sleep\.mjs$|^electron$/ }, args =>
        ({ path: args.path, namespace: 'login-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'login-fixture' }, () => ({ contents: `
        export const sendToDaemon = () => {};
        export const readStorageFile = () => {
          const error = globalThis.__ggrLoginState.readError;
          globalThis.__ggrLoginState.readError = null;
          if (error) throw error;
          return [{name:'fixture',value:'fixture'}];
        };
        export const writeStorageFile = async (...args) => globalThis.__ggrLoginOps.push(['write', ...args]);
        export const loginWithCookieAssistant = async () => {
          globalThis.__ggrLoginOps.push(['login']);
          const error = globalThis.__ggrLoginState.loginError;
          globalThis.__ggrLoginState.loginError = null;
          if (error) throw error;
        };
        export const checkCookieListFormat = cookies =>
          !globalThis.__ggrLoginState.invalidCookies || cookies.length > 0;
        export const sleep = async () => {};
        export const app = {};
      ` }))
    }
  }] })
const { CookieInvalidHandlePlugin } = createRequire(import.meta.url)(outfile)
after(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  delete globalThis.__ggrLoginOps
  delete globalThis.__ggrLoginState
})
function setup() {
  globalThis.__ggrLoginOps = []
  globalThis.__ggrLoginState = {}
  const hooks = { cookieWillSet: new AsyncSeriesHook(['args']), userInfoResponse: new AsyncSeriesHook(['args']) }
  new CookieInvalidHandlePlugin().apply(hooks)
  return { hooks, browser: { close: async () => globalThis.__ggrLoginOps.push(['close']) } }
}

test('restricted and unknown responses neither delete cookies nor launch a login loop', async () => {
  for (const userInfoResponse of [{ code: 37 }, { code: 1 }, { code: 0, zpData: {} }]) {
    const { hooks, browser } = setup()
    await assert.rejects(hooks.userInfoResponse.promise({ userInfoResponse, browser }), /LOGIN_STATUS_(RESTRICTED|UNKNOWN)/)
    assert.deepEqual(globalThis.__ggrLoginOps, [])
  }
})

test('an explicit expired session still clears credentials and starts the login assistant', async () => {
  const { hooks, browser } = setup()
  await assert.rejects(hooks.userInfoResponse.promise({ userInfoResponse: { code: 7 }, browser }), /THROW_FOR_RETRY/)
  assert.deepEqual(globalThis.__ggrLoginOps, [['close'], ['write', 'boss-cookies.json', []], ['login']])
})

test('cookie read failures escape the login loop with their original storage error', async () => {
  for (const code of ['GGR_JSON_INVALID', 'GGR_FILE_READ_FAILED']) {
    const { hooks, browser } = setup()
    const error = Object.assign(Error('fixture storage failure'), { code })
    Object.assign(globalThis.__ggrLoginState, { invalidCookies: true, readError: error })
    await assert.rejects(hooks.cookieWillSet.promise({ cookies: [], browser }), actual => actual === error)
    assert.deepEqual(globalThis.__ggrLoginOps, [['close'], ['login']])
  }
})

test('both login hooks propagate assistant failures instead of silently retrying', async () => {
  for (const hook of ['cookieWillSet', 'userInfoResponse']) {
    const { hooks, browser } = setup()
    const error = Object.assign(Error('fixture save failure'), { code: 'GGR_FILE_WRITE_FAILED' })
    Object.assign(globalThis.__ggrLoginState, { invalidCookies: true, loginError: error })
    await assert.rejects(hooks[hook].promise({ cookies: [], userInfoResponse: { code: 7 }, browser }),
      actual => actual === error)
    assert.equal(globalThis.__ggrLoginOps.filter(([op]) => op === 'login').length, 1)
  }
})

test('cancelling either login hook still stops with LOGIN_STATUS_INVALID', async () => {
  for (const hook of ['cookieWillSet', 'userInfoResponse']) {
    const { hooks, browser } = setup()
    Object.assign(globalThis.__ggrLoginState, { invalidCookies: true, loginError: Error('USER_CANCELLED_LOGIN') })
    await assert.rejects(hooks[hook].promise({ cookies: [], userInfoResponse: { code: 7 }, browser }),
      /LOGIN_STATUS_INVALID/)
    assert.equal(globalThis.__ggrLoginOps.filter(([op]) => op === 'login').length, 1)
  }
})
