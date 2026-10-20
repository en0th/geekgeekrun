const test = require('node:test')
const assert = require('node:assert/strict')
const { createDetailWriter } = require('../dist/detail-writer.js')
const detail = (text = '岗位') => ({ jobInfo: { encryptId: 'job', postDescription: text }, bossInfo: {}, brandComInfo: {} })

test('concurrent capture and detail callbacks save the same version once', async () => {
  let count = 0
  const save = createDetailWriter(async value => {
    count++
    value.bossInfo.__ggr_encryptBossId = 'metadata'
    await new Promise(resolve => setTimeout(resolve, 5))
  })
  const first = detail()
  const reordered = { brandComInfo: {}, bossInfo: {}, jobInfo: { postDescription: '岗位', encryptId: 'job' } }
  await Promise.all([save(first), save(reordered), save(detail())])
  await save(first)
  assert.equal(count, 1)
  await save(detail('岗位变更'))
  assert.equal(count, 2)
})

test('updates of one job are serialized and failed writes can be retried', async () => {
  let active = 0, maximum = 0, calls = 0
  const save = createDetailWriter(async () => {
    calls++
    active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
    if (calls === 1) throw new Error('database unavailable')
  })
  await assert.rejects(save(detail()), /database unavailable/)
  await Promise.all([save(detail()), save(detail('new'))])
  assert.equal(calls, 3)
  assert.equal(maximum, 1)
})

test('the successful-version cache is bounded', async () => {
  let count = 0
  const save = createDetailWriter(async () => { count++ }, 1)
  await save(detail())
  await save({ ...detail(), jobInfo: { encryptId: 'other' } })
  await save(detail())
  assert.equal(count, 3)
})

test('different jobs also serialize writes on the shared connection', async () => {
  let active = 0, maximum = 0
  const write = createDetailWriter(async () => {
    active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
  })
  await Promise.all(['one', 'two', 'three'].map(id => write({ ...detail(), jobInfo: { encryptId: id } })))
  assert.equal(maximum, 1)
})
