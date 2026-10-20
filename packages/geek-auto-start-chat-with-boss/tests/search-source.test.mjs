import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { positionOptions, positionCatalogMetadata, normalizePositionCodes, normalizeJobSources,
  sourceFingerprintEntry, searchRequestMatches, searchPageMatches, buildPositionSearchUrl,
  activateSearchSource, describeSearchSource } from '../search-source.mjs'
import { activateSourceAndWait } from '../auto-chat-navigation.mjs'
import { jobConfigSnapshot } from '../task-config-snapshot.mjs'
import { validateJobFilterConfig } from '../job-filter-config.mjs'

const endpoint = 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json'
const request = (body, url = endpoint) => ({ url: () => url, postData: () => body })
const search = children => ({ type: 'search', enabled: true, children })
const row = (keyword, positionCodes = [], enabled = true) => ({ keyword, positionCodes, enabled })

test('the shipped catalog contains 848 unique selectable leaf positions and source metadata', () => {
  const leaves = positionOptions.flatMap(group => group.children.flatMap(subgroup => subgroup.children))
  assert.equal(positionOptions.length, 21)
  assert.equal(leaves.length, 848)
  assert.equal(new Set(leaves.map(leaf => leaf.value)).size, 848)
  assert.equal(positionCatalogMetadata.fetched, '2026-10-19')
  assert.match(positionCatalogMetadata.source, /zpCommon\/data\/position\.json$/)
})
test('selected positions are deduplicated, sorted and validated', () => {
  assert.deepEqual(normalizePositionCodes([100109, '100101', '100109']), ['100101', '100109'])
  assert.deepEqual(normalizePositionCodes(null), [])
  assert.throws(() => normalizePositionCodes(['unknown']), /平台职位类目/)
  assert.throws(() => normalizePositionCodes(['100000']), /平台职位类目/)
  assert.throws(() => validateJobFilterConfig({ jobSourceList: [search([row('', ['unknown'])])] }), /平台职位类目/)
})
test('category-only searches are valid and distinct categories with the same word remain separate sources', () => {
  const result = normalizeJobSources([search([row(' Java ', ['100101']), row('Java', ['100109']),
    row('Java', ['100101']), row('', ['100109']), row(''), row('off', [], false)])])
  assert.deepEqual(result, [
    { type: 'search', keyword: 'Java', positionCodes: ['100101'] },
    { type: 'search', keyword: 'Java', positionCodes: ['100109'] },
    { type: 'search', keyword: '', positionCodes: ['100109'] }
  ])
  assert.match(describeSearchSource(result[2]), /Python/)
  assert.match(describeSearchSource({ positionCodes: ['old-code'] }), /重新选择/)
})
test('normalizing sources preserves priority and existing recommend/expect deduplication', () => {
  assert.deepEqual(normalizeJobSources([{ type: 'recommend', enabled: true }, search([row('a')]),
    { type: 'recommend', enabled: true }, { type: 'expect', enabled: false }]).map(source => source.type), ['recommend', 'search'])
})
test('legacy fingerprints stay compatible and a position change invalidates the saved source scope', () => {
  assert.deepEqual(sourceFingerprintEntry({ type: 'search', keyword: 'Java' }), ['search', null, 'Java'])
  assert.notDeepEqual(sourceFingerprintEntry({ type: 'search', keyword: 'Java', positionCodes: ['100101'] }),
    sourceFingerprintEntry({ type: 'search', keyword: 'Java', positionCodes: ['100109'] }))
  assert.deepEqual(sourceFingerprintEntry({ type: 'search', keyword: 'Java', positionCodes: ['100109', '100101'] }),
    sourceFingerprintEntry({ type: 'search', keyword: 'Java', positionCodes: ['100101', '100109'] }))
})
test('a queued snapshot retains nested positions when the live draft is edited', () => {
  const live = { 'boss.json': { jobSourceList: [search([row('', ['100109'])])] }, 'target-company-list.json': [] }
  const snapshot = jobConfigSnapshot(live)
  live['boss.json'].jobSourceList[0].children[0].positionCodes[0] = '100101'
  assert.deepEqual(snapshot['boss.json'].jobSourceList[0].children[0].positionCodes, ['100109'])
})
test('request verification reads GET, form and JSON parameters, including sorted multiple codes', () => {
  const source = { keyword: 'Java', positionCodes: ['100101', '100109'] }
  for (const current of [request(null, endpoint + '?query=Java&position=100101%2C100109'),
    request('query=Java&position=100109%2C100101', endpoint + '?_t=1'),
    request(JSON.stringify({ query: 'Java', position: ['100109', '100101'] }))])
    assert.equal(searchRequestMatches(current, source), true)
  for (const current of [request('query=Python&position=100101,100109'), request('query=Java'),
    request('query=Java&position=100101'), request('query=Java&position=100101,100109', 'https://example.com' + new URL(endpoint).pathname)])
    assert.equal(searchRequestMatches(current, source), false)
})
test('an empty query is explicit and a cleared category cannot silently retain the previous code', () => {
  assert.equal(searchRequestMatches(request('position=100109'), { keyword: '', positionCodes: ['100109'] }), true)
  assert.equal(searchRequestMatches(request('query=AI+Agent&position=100109'), { keyword: '', positionCodes: ['100109'] }), false)
  assert.equal(searchPageMatches({ query: 'Java', position: '100109' }, { keyword: 'Java' }), false)
  const url = new URL(buildPositionSearchUrl({ keyword: '', positionCodes: ['100109'] }, 'https://www.zhipin.com/web/geek/job?city=101020100&page=8'))
  assert.equal(url.searchParams.get('query'), '')
  assert.equal(url.searchParams.get('position'), '100109')
  assert.equal(url.searchParams.get('city'), '101020100')
  assert.equal(url.searchParams.has('page'), false)
  const cleared = new URL(buildPositionSearchUrl({ keyword: 'Java' }, url.href))
  assert.equal(cleared.searchParams.has('position'), false)
})

class SearchPage extends EventEmitter {
  scope = { query: 'old', position: '', city: '101020100' }
  navigated = null
  waitForResponse(predicate, { signal, timeout }) {
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.off('response', listener); signal.removeEventListener('abort', abort) }
      const listener = response => { if (predicate(response)) { cleanup(); resolve(response) } }
      const abort = () => { cleanup(); reject(Error('aborted')) }
      const timer = setTimeout(() => { cleanup(); const error = Error('timeout'); error.name = 'TimeoutError'; reject(error) }, timeout)
      this.on('response', listener)
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  async evaluate() { return this.scope }
  url() { return 'https://www.zhipin.com/web/geek/job?city=101020100' }
  async goto(url) {
    this.navigated = url
    const values = new URL(url).searchParams
    for (const query of ['old', values.get('query')]) this.emit('response', {
      url: () => endpoint,
      request: () => request(new URLSearchParams({ query, position: values.get('position') || '' }).toString())
    })
  }
}
test('a synchronous response is captured after navigation while a late previous-query response is ignored', async () => {
  const page = new SearchPage(), source = { keyword: '', positionCodes: ['100109'] }
  const result = await activateSourceAndWait(page, () => activateSearchSource(page, source, '.search'),
    { matchesResponse: response => searchRequestMatches(response.request(), source) })
  assert.equal(searchRequestMatches(result.request(), source), true)
  assert.equal(new URL(page.navigated).searchParams.get('query'), '')
  assert.equal(page.listenerCount('response'), 0)
})
test('a failed navigation aborts its response waiter and does not leak a listener', async () => {
  const page = new SearchPage()
  await assert.rejects(activateSourceAndWait(page, () => { throw Error('navigation failed') }), /navigation failed/)
  assert.equal(page.listenerCount('response'), 0)
})
test('a response missing the requested position cannot confirm successful activation', async () => {
  const page = new SearchPage(), source = { keyword: 'Java', positionCodes: ['100101'] }
  await assert.rejects(activateSourceAndWait(page, () => page.emit('response', {
    url: () => endpoint, request: () => request('query=Java')
  }), { matchesResponse: response => searchRequestMatches(response.request(), source), timeout: 5 }), { name: 'TimeoutError' })
  assert.equal(page.listenerCount('response'), 0)
})
