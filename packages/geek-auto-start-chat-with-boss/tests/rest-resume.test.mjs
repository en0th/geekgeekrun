import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { classifyBossLoginResponse, bossLoginError } from '../../utils/boss-login.mjs'
import { bindRunAccount } from '../run-account.mjs'
const text = fs.readFileSync(new URL('../index.mjs', import.meta.url), 'utf8')
const code = text.slice(text.indexOf('export async function recheckAfterRest()'), text.indexOf('async function toRecommendPage')).replace('export ', '')
test('rest expiry rechecks live browser account, login and daily goal before resuming', async () => {
  for (const [account, status, quota, blocked] of [['a', 200, false, false], ['b', 200, false, true], ['a', 401, false, true], ['a', 200, true, true]]) {
    const calls = []
    const ctx = vm.createContext({ classifyBossLoginResponse, bossLoginError, bindRunAccount,
      runBudget: { checkpoint: async () => calls.push('budget') }, runAccountId: 'a', isCollectMode: false,
      page: { evaluate: async () => ({ httpStatus: status, body: { code: status === 401 ? 7 : 0, zpData: { encryptUserId: account } } }) },
      dailyLimit: () => 100, dailyQuota: { assert() { calls.push('quota'); if (quota) throw Error('GOAL_REACHED') } },
      publishDailyQuota: () => calls.push('publish') })
    vm.runInContext(code, ctx)
    if (blocked) await assert.rejects(ctx.recheckAfterRest())
    else { await ctx.recheckAfterRest(); assert.deepEqual(calls, ['budget', 'quota', 'publish']) }
    if (account !== 'a' || status === 401) assert.equal(calls.includes('quota'), false)
  }
})
