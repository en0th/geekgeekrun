import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldAskAccountApi, waitForLogin } from '../login-watch.mjs'

test('the account API is asked when a login cookie appears or changes, or now and then', () => {
  assert.equal(shouldAskAccountApi([{ name: '__a', value: '1' }], 1), false)
  assert.equal(shouldAskAccountApi([{ name: 'wt2', value: 'x' }], 1), true)
  assert.equal(shouldAskAccountApi([{ name: 'wt2', value: '' }], 1), false)
  // a stale cookie that was already answered is not asked about on every poll
  assert.equal(shouldAskAccountApi([{ name: 'wt2', value: 'x' }], 2, 'wt2=x'), false)
  assert.equal(shouldAskAccountApi([{ name: 'wt2', value: 'y' }], 2, 'wt2=x'), true)
  assert.equal(shouldAskAccountApi([], 5), true)
  assert.equal(shouldAskAccountApi([], 0), false)
})

test('waits through failed polls until the account API confirms the login', async () => {
  let poll = 0
  const answers = [false, false, true]
  const result = await waitForLogin({
    getCookies: async () => {
      poll++
      if (poll === 1) throw new Error('navigating')
      // the login cookie is renewed at each step of the login
      return [{ name: 'wt2', value: 'token' + poll }]
    },
    askAccountApi: async () => answers.shift(),
    isClosed: () => false,
    sleep: async () => {}
  })
  assert.equal(result, true)
  assert.equal(poll, 4)
})

test('stops waiting when the login window is closed', async () => {
  let closed = false
  const result = await waitForLogin({
    getCookies: async () => {
      closed = true
      return []
    },
    askAccountApi: async () => true,
    isClosed: () => closed,
    sleep: async () => {}
  })
  assert.equal(result, false)
})
