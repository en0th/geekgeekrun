import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCompanyBrandId, companyHomeUrl, companyJobsUrl, companySourceFingerprint,
  assertCompanyJobIdentity } from '../company-source.mjs'
import { searchRequestMatches, searchPageMatches, activateSearchSource } from '../search-source.mjs'
import { EventEmitter } from 'node:events'
import { watchJobResponses } from '../boss-job-responses.mjs'

const brand = '0123456789abcdef1nRz', other = 'fedcba98765432101nRz'
test('brand IDs, homepage and jobs URLs normalize to a single identity without retaining tracking parameters', () => {
  for (const value of [brand, `https://www.zhipin.com/gongsi/${brand}.html?ka=ignored`, `https://zhipin.com/gongsi/job/${brand}.html`]) {
    assert.equal(normalizeCompanyBrandId(value), brand)
    assert.equal(companyHomeUrl(value), `https://www.zhipin.com/gongsi/${brand}.html`)
    assert.deepEqual(companySourceFingerprint(value), ['company', brand])
  }
  assert.equal(companyJobsUrl(brand), `https://www.zhipin.com/gongsi/job/${brand}.html`)
  assert.notDeepEqual(companySourceFingerprint(brand), companySourceFingerprint(other))
})
test('company URLs reject other hosts, embedded credentials, ports and legal-entity or escaped paths', () => {
  for (const value of ['', null, {}, '12345', `https://evil.example/gongsi/${brand}.html`,
    `https://www.zhipin.com.evil.example/gongsi/${brand}.html`, `https://user:pass@www.zhipin.com/gongsi/${brand}.html`,
    `https://www.zhipin.com:444/gongsi/${brand}.html`, `https://www.zhipin.com/companys/${brand}.html`,
    `https://www.zhipin.com/gongsis/${brand}.html`, 'https://www.zhipin.com/gongsi/%2Fescape.html'])
    assert.throws(() => normalizeCompanyBrandId(value), /品牌/)
})
test('company membership requires both list and detail to identify the exact same brand and job', () => {
  const row = { encryptJobId: 'job', encryptBrandId: brand }
  const detail = { jobInfo: { encryptId: 'job' }, brandComInfo: { encryptBrandId: brand } }
  assert.equal(assertCompanyJobIdentity(brand, row, detail), true)
  for (const [list, body] of [[row, undefined], [row, {}], [{ ...row, encryptBrandId: other }, detail], [{ encryptJobId: 'job' }, detail],
    [row, { ...detail, brandComInfo: { encryptBrandId: other } }], [row, { ...detail, jobInfo: { encryptId: 'old-job' } }]])
    assert.throws(() => assertCompanyJobIdentity(brand, list, body), /COMPANY_SOURCE_NOT_CONFIRMED/)
})
test('ordinary search cannot inherit a hidden company restriction in URL, POST or page state', () => {
  for (const key of ['brandId', 'encryptBrandId', 'companyId', 'encryptCompanyId']) {
    const params = { query: 'Python', [key]: brand }
    const request = { url: () => 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?' + new URLSearchParams(params) }
    assert.equal(searchRequestMatches(request, { keyword: 'Python' }), false)
    assert.equal(searchRequestMatches({ url: () => 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json', postData: () => JSON.stringify(params) }, { keyword: 'Python' }), false)
    assert.equal(searchPageMatches(params, { keyword: 'Python' }), false)
  }
})
test('switching back to ordinary search navigates to a clean scope instead of reusing a company-bound input', async () => {
  let next
  const page = { evaluate: async () => ({ query: '', city: '100010000', position: '', brandId: brand }),
    url: () => `https://www.zhipin.com/web/geek/jobs?brandId=${brand}&city=100010000`,
    goto: async url => { next = new URL(url) } }
  await activateSearchSource(page, { keyword: 'Python' }, '.search')
  assert.equal(next.searchParams.has('brandId'), false)
  assert.equal(next.searchParams.get('query'), 'Python')
})

test('pagination cannot join the first page of one brand to a later page of another brand', async t => {
  const page = new EventEmitter(), monitor = watchJobResponses(page)
  t.after(() => monitor.dispose())
  const emit = (brandId, number, id) => {
    const url = 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json?' + new URLSearchParams({ brandId, page: number, query: 'Python' })
    page.emit('response', { url: () => url, status: () => 200, request: () => ({ url: () => url }),
      json: async () => ({ code: 0, zpData: { jobList: [{ encryptJobId: id }] } }) })
  }
  emit(brand, 1, 'first-brand'); await monitor.assertHealthy()
  emit(other, 2, 'second-brand'); await monitor.assertHealthy()
  assert.equal(monitor.getListSnapshot().ids, null)
})
