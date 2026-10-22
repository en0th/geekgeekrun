import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { openJobCardForReview } from '../auto-chat-navigation.mjs'

function fixture({ missing = false, wrongDetail = false, failedClick = false } = {}) {
  const state = { handles: 0, peak: 0, created: 0, clicks: 0 }
  const list = { evaluateHandle: async (select, index) => {
    const card = select({ querySelectorAll: () => missing ? [] : Array(1000).fill({ click: async () => {
      state.clicks++; if (failedClick) throw new Error('detached card')
    } }) }, index)
    state.created++; state.handles++; state.peak = Math.max(state.peak, state.handles)
    return { asElement: () => card, dispose: async () => { state.handles-- } }
  } }
  const page = { waitForFunction: async (fn, options, id) => {
    assert.equal(options.polling, 100, 'readiness must keep polling when minimized animation frames stop')
    assert.equal(state.handles, 0)
    const doc = { querySelector: selector => ({ __vue__: selector === '.page-jobs-main'
      ? { currentJob: { encryptJobId: id } } : { data: { jobInfo: { encryptId: wrongDetail ? 'old-job' : id } } } }) }
    if (!vm.runInNewContext('(' + fn.toString() + ')(id)', { document: doc, id })) throw new Error('timeout')
    state.created++; state.handles++; state.peak = Math.max(state.peak, state.handles)
    return { dispose: async () => { state.handles-- } }
  } }
  return { page, list, state }
}

test('repeated reviews keep one card handle in flight regardless of list length, including index zero', async () => {
  const current = fixture()
  for (let index = 0; index < 100; index++) await openJobCardForReview({ ...current, index, jobId: 'job-' + index })
  assert.deepEqual(current.state, { handles: 0, peak: 1, created: 200, clicks: 100 })
})

test('missing/detached cards release their handles and stale detail IDs remain blocked', async () => {
  for (const options of [{ missing: true }, { wrongDetail: true }, { failedClick: true }]) {
    const current = fixture(options)
    await assert.rejects(openJobCardForReview({ ...current, index: 0, jobId: 'expected' }), options.failedClick ? /detached/ : /DETAIL_NOT_READY/)
    assert.equal(current.state.handles, 0)
  }
})
