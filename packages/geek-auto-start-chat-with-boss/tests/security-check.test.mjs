import test from 'node:test'
import assert from 'node:assert/strict'
import { isSecurityCheckUrl, waitForSecurityCheck } from '../security-check.mjs'

test('recognises BOSS verification pages only', () => {
  assert.equal(isSecurityCheckUrl('https://www.zhipin.com/web/user/safe/verify-slider?callbackUrl=x'), true)
  assert.equal(isSecurityCheckUrl('https://www.zhipin.com/web/common/security-check.html?seed=1'), true)
  assert.equal(isSecurityCheckUrl('https://www.zhipin.com/web/passport/zp/verify.html'), true)
  assert.equal(isSecurityCheckUrl('https://www.zhipin.com/web/geek/jobs?query=AI'), false)
  assert.equal(isSecurityCheckUrl('https://www.zhipin.com/web/common/403.html'), false)
  assert.equal(isSecurityCheckUrl('https://example.com/web/user/safe/verify-slider'), false)
  assert.equal(isSecurityCheckUrl('not a url'), false)
})

test('waits until the page leaves the verification page', async () => {
  const urls = [
    'https://www.zhipin.com/web/user/safe/verify-slider',
    'https://www.zhipin.com/web/common/security-check.html',
    'https://www.zhipin.com/web/geek/jobs'
  ]
  let slept = 0
  const result = await waitForSecurityCheck({
    currentUrl: async () => urls.shift(),
    isClosed: () => false,
    sleep: async () => void slept++
  })
  assert.equal(result, 'passed')
  assert.equal(slept, 2)
})

test('stops waiting when the window is closed', async () => {
  let closed = false
  const result = await waitForSecurityCheck({
    currentUrl: async () => 'https://www.zhipin.com/web/user/safe/verify-slider',
    isClosed: () => closed,
    sleep: async () => void (closed = true)
  })
  assert.equal(result, 'closed')
  const thrown = await waitForSecurityCheck({
    currentUrl: async () => {
      throw new Error('Target closed')
    },
    isClosed: () => false,
    sleep: async () => {}
  })
  assert.equal(thrown, 'closed')
})
