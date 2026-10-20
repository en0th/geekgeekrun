import test from 'node:test'
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
        export const readStorageFile = () => [];
        export const writeStorageFile = async (...args) => globalThis.__ggrLoginOps.push(['write', ...args]);
        export const loginWithCookieAssistant = async () => globalThis.__ggrLoginOps.push(['login']);
        export const checkCookieListFormat = () => true;
        export const sleep = async () => {};
        export const app = {};
      ` }))
    }
  }] })
const { CookieInvalidHandlePlugin } = createRequire(import.meta.url)(outfile)
function setup() {
  globalThis.__ggrLoginOps = []
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
