// A selected filter is not proof that the asynchronously replaced list is current.
import { jobResponseKind } from './boss-job-responses.mjs'
import { searchPageMatches } from './search-source.mjs'

const fields = ['city', 'salary', 'experience', 'degree', 'industry', 'scale', 'jobType']
const normalize = value => [...new Set((Array.isArray(value) ? value : String(value ?? '').split(','))
  .map(String).map(value => value.trim()).filter(value => value && value !== '0'))].sort().join(',')

function readView() {
  const view = document.querySelector('.page-jobs-main')?.__vue__
  if (!view?.formData || !Array.isArray(view.jobList)) return null
  const url = new URL(location.href)
  const keys = ['query', 'position', 'city', 'salary', 'experience', 'degree', 'industry', 'scale', 'jobType']
  return {
    scope: Object.fromEntries(keys.map(key => [key, view.formData[key] ?? url.searchParams.get(key) ?? ''])),
    ids: view.jobList.map(row => String(row?.encryptJobId || row?.encryptId || '')),
    loading: !!document.querySelector('.page-jobs-main .job-rec-loading'),
  }
}

function scopeMatches(parameters, expected, source, path) {
  if (source.type === 'search') {
    if (path !== '/wapi/zpgeek/search/joblist.json' || !searchPageMatches(parameters, source)) return false
  } else if (path !== '/wapi/zpgeek/pc/recommend/job/list.json') return false
  return fields.every(key => normalize(parameters[key]) === normalize(expected[key]))
}

export function listRequestMatches(request, expected, source) {
  try {
    const url = new URL(request.url())
    if (jobResponseKind(url.href) !== 'list') return false
    const parameters = Object.fromEntries(url.searchParams)
    const posted = request.postData?.()
    if (posted) {
      try { Object.assign(parameters, JSON.parse(posted)) }
      catch { Object.assign(parameters, Object.fromEntries(new URLSearchParams(posted))) }
    }
    return scopeMatches(parameters, expected, source, url.pathname)
  } catch { return false }
}

export async function waitForCurrentJobList({ page, monitor, source, timeoutMs = 15000,
  checkResponses = () => monitor.assertHealthy(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, onReady = () => {}, onFailure = () => {} }) {
  const started = now(), deadline = started + timeoutMs
  const initial = await page.evaluate(readView)
  const expected = initial?.scope
  let observed = null
  while (true) {
    await checkResponses()
    const current = await page.evaluate(readView)
    const response = monitor.getListSnapshot()
    const path = response?.path
    const scopeUnchanged = expected && current &&
      String(current.scope.query ?? '').trim() === String(expected.query ?? '').trim() &&
      (source.type !== 'search' || searchPageMatches(expected, source)) && ['position', ...fields]
      .every(key => normalize(current.scope[key]) === normalize(expected[key]))
    const scopeConfirmed = scopeUnchanged && response && scopeMatches(response.parameters, expected, source, path)
    const rowsConfirmed = Array.isArray(response?.ids) && current &&
      current.ids.every(Boolean) && JSON.stringify(current.ids) === JSON.stringify(response.ids)
    observed = { sequence: response?.sequence ?? null, path: path ?? null, page: response?.page ?? null,
      scopeConfirmed: !!scopeConfirmed, rowsConfirmed: !!rowsConfirmed,
      loading: current?.loading ?? null, count: current?.ids.length ?? null }
    if (scopeConfirmed && rowsConfirmed && !current.loading) {
      // Keep checking late responses while reading details and loading further pages.
      monitor.expectList(request => listRequestMatches(request, expected, source))
      const result = { ...observed, scope: expected, elapsedMs: now() - started }
      try { onReady(result) } catch { /* Evidence delivery cannot affect readiness. */ }
      return result
    }
    if (!scopeUnchanged || now() >= deadline) {
      try { onFailure({ expected: expected ?? null, observed }) } catch {}
      throw Object.assign(new Error('AUTO_CHAT_PAGE_FILTER_NOT_APPLIED'), {
        field: 'list', detail: 'BOSS职位列表尚未与当前来源和筛选条件同步，任务已暂停并保留进度；请检查页面和网络后恢复',
      })
    }
    await pause(Math.min(100, Math.max(0, deadline - now())))
  }
}
