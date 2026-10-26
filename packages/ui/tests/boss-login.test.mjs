import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { cookieHeaderFor, interpretUserInfoResponse, BOSS_USER_INFO_URL } from '../src/common/boss-login.mjs'

const cookie = (name, domain, extra = {}) => ({
  name,
  value: name + '-v',
  domain,
  path: '/',
  secure: true,
  session: false,
  httpOnly: false,
  ...extra
})

test('only unexpired cookies of the BOSS site are sent', () => {
  const now = 1000
  const header = cookieHeaderFor(
    [
      cookie('wt2', '.zhipin.com', { expirationDate: 2000 }),
      cookie('old', '.zhipin.com', { expirationDate: 10 }),
      cookie('sess', 'www.zhipin.com', { session: true, expirationDate: 10 }),
      cookie('other', '.example.com')
    ],
    'www.zhipin.com',
    now
  )
  assert.equal(header, 'wt2=wt2-v; sess=sess-v')
})

test('a successful user identity confirms login; explicit expiry invalidates it', () => {
  assert.equal(interpretUserInfoResponse(200, '{"code":0,"zpData":{"encryptUserId":"account-a"}}').status, 'valid')
  const invalid = interpretUserInfoResponse(200, '{"code":7,"message":"当前登录状态已失效"}')
  assert.deepEqual(invalid, { status: 'invalid', detail: '当前登录状态已失效' })
})

test('platform restrictions and unknown failures do not invalidate credentials', () => {
  for (const body of [{ code: 31 }, { code: 37, message: '环境存在异常' }, { code: 1, message: '请完成安全验证' }])
    assert.equal(interpretUserInfoResponse(200, JSON.stringify(body)).status, 'restricted')
  assert.equal(interpretUserInfoResponse(429, '{}').status, 'restricted')
  for (const body of [{ code: 1 }, { code: 0, zpData: {} }, {}, null])
    assert.equal(interpretUserInfoResponse(200, JSON.stringify(body)).status, 'unknown')
  assert.equal(interpretUserInfoResponse(503, '{"code":7}').status, 'unknown')
})

test('pages that are not the API answer are reported as unknown', () => {
  assert.equal(interpretUserInfoResponse(200, '<html>安全验证</html>').status, 'unknown')
  assert.equal(interpretUserInfoResponse(502, '{"code":1}').status, 'unknown')
})

const loginSource = fs.readFileSync(new URL('../src/main/features/boss-login-check.ts', import.meta.url), 'utf8')
const loginBody = (await transform(loginSource.slice(loginSource.indexOf('export async function checkBossLoginStatus')).replace('export async function', 'async function'), { loader: 'ts' })).code
function identityFixture() {
  let session = 'a-first-login'
  const ids = { 'a-first-login': 'account-a', 'b-login': 'account-b', 'a-new-cookie': 'account-a' }
  const ctx = vm.createContext({ cookieHeaderFor, interpretUserInfoResponse, BOSS_USER_INFO_URL, TIMEOUT_MS: 10000, AbortSignal,
    checkCookieListFormat: cookies => Array.isArray(cookies) && cookies.length > 0,
    readStorageFile: () => [{ name: 'wt2', value: session, domain: '.zhipin.com', session: true }],
    fetch: async (url, options) => {
      assert.equal(url, BOSS_USER_INFO_URL); assert.equal(options.headers.Cookie, 'wt2=' + session)
      return { status: 200, text: async () => JSON.stringify({ code: 0, zpData: { encryptUserId: ids[session], name: '相同昵称' } }) }
    },
  })
  vm.runInContext(loginBody, ctx)
  return { check: () => ctx.checkBossLoginStatus(), switchTo: value => { session = value } }
}

test('the actual login check identifies A/B/A by returned user ID rather than cookies or nickname', async () => {
  const f = identityFixture()
  assert.equal((await f.check()).accountId, 'account-a')
  f.switchTo('b-login'); assert.equal((await f.check()).accountId, 'account-b')
  f.switchTo('a-new-cookie'); assert.equal((await f.check()).accountId, 'account-a')
})

test('a response without an account ID cannot authorize a guessed identity', async () => {
  const f = identityFixture(); f.switchTo('missing-id')
  const result = await f.check()
  assert.equal(result.status, 'unknown'); assert.equal(result.accountId, undefined)
})
