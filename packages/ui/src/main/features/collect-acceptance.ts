// Opt-in local acceptance evidence. No credentials, headers or messaging are captured.
import fs from 'node:fs'
import path from 'node:path'

interface AcceptanceObservation {
  observation: string
  jobInfo: Record<string, unknown>
  brandComInfo: Record<string, unknown>
  row: Record<string, unknown>
  scope: unknown
  visibleDetail: string
  typeOptions: unknown
  windowState: string | null
  documentVisibility: string
  source: string
  pageNumber: number | null
  loggedIn: boolean | null
}

export function attachCollectAcceptance({ hooks, events, runMode, runRecordId,
  folder = process.env.GEEKGEEKRUN_COLLECT_AUDIT_DIR }) {
  if (!folder) return
  if (runMode !== 'collect') throw new Error('Collect acceptance requires collect mode')
  if (!path.isAbsolute(folder)) throw new Error('Collect acceptance folder must be absolute')
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
  const file = path.join(folder, `run-${Number(runRecordId)}.jsonl`)
  const record = (data) => fs.appendFileSync(file,
    JSON.stringify({ at: Date.now(), pid: process.pid, runRecordId: Number(runRecordId), ...data }) + '\n', { mode: 0o600 })
  const pick = (data, keys) => Object.fromEntries(keys.filter(key => data?.[key] !== undefined).map(key => [key, data[key]]))
  let page: any, current: AcceptanceObservation | null = null, sequence = 0
  record({ kind: 'start', runMode })
  events.on('PAGE_FILTERS_APPLIED', data => record({ kind: 'filters-applied', ...data }))
  events.on('PAGE_FILTER_NOT_APPLIED', data => record({ kind: 'filter-not-applied', ...data }))
  events.on('BOSS_LIST_RESPONSE', data => record({ kind: 'list-response', ...data }))
  events.on('JOB_LIST_READY', data => record({ kind: 'list-ready', ...data }))
  hooks.pageGotten.tap('CollectAcceptance', (value) => {
    page = value
    page.on('response', async response => {
      let url: URL
      try { url = new URL(response.url()) } catch { return }
      if (!/(^|\.)zhipin\.com$/.test(url.hostname)) return
      const kind = ['/wapi/zpgeek/search/joblist.json', '/wapi/zpgeek/pc/recommend/job/list.json',
        '/wapi/zpgeek/brand/job/querylist.json'].includes(url.pathname) ? 'list'
        : url.pathname === '/wapi/zpgeek/job/detail.json' ? 'detail' : null
      if (!kind) return
      let body: any, format = 'json'
      try { body = await response.json() } catch { format = 'unreadable' }
      const code = Number(body?.code)
      // Record only shape and fixed metadata, including failures before the first review.
      record({ kind: 'job-response', endpoint: kind, httpStatus: response.status(), format,
        code: ['number', 'string'].includes(typeof body?.code) && String(body.code).trim() &&
          Number.isSafeInteger(code) && Math.abs(code) < 100000 ? code : null,
        dataObject: !!body?.zpData && typeof body.zpData === 'object' && !Array.isArray(body.zpData),
        listArray: Array.isArray(body?.zpData?.jobList),
        count: Array.isArray(body?.zpData?.jobList) ? body.zpData.jobList.length : null })
    })
    page.on('request', request => {
      let url: URL
      try { url = new URL(request.url()) } catch { return }
      if (!/(^|\.)zhipin\.com$/.test(url.hostname)) return
      const operation = /^\/wapi\/(?:zpchat\/|zpgeek\/friend\/)/.test(url.pathname) ? 'communication'
        : /^\/wapi\/zpgeek\/(?:job\/notmatch|negativefeedback\/)/.test(url.pathname) ? 'mark' : null
      if (operation) {
        // Unread counts share the communication namespace. Keep those reads working
        // and distinguish them from attempts to communicate or mark a job.
        const writing = (operation === 'mark' && !/\/negativefeedback\/reasons\.json$/.test(url.pathname))
          || /\/friend\/(?:add|apply|greet|send)(?:\.|\/|$)/i.test(url.pathname)
          || /\/zpchat\/(?:[^/]+\/)*(?:send[^/]*|addMsg|pushMsg)(?:\.|\/|$)/i.test(url.pathname)
        record({ kind: writing ? 'side-effect-request' : 'protected-request', operation, method: request.method() })
      }
    })
  })
  // Install the extra acceptance boundary before the task restores cookies or navigates.
  // Normal runs do not enable this recorder or alter the browser's network policy.
  hooks.cookieWillSet.tapPromise('CollectAcceptance', async () => {
    const session = await page.createCDPSession()
    try {
      await session.send('Network.enable')
      await session.send('Network.setBlockedURLs', { urls: ['zhipin.com', '*.zhipin.com'].flatMap(host =>
        ['zpchat/*/send*', 'zpchat/*/addMsg*', 'zpchat/*/pushMsg*',
          'zpgeek/friend/add*', 'zpgeek/friend/apply*', 'zpgeek/friend/greet*', 'zpgeek/friend/send*',
          'zpgeek/job/notmatch*', 'zpgeek/negativefeedback/*']
          .map(endpoint => `*://${host}/wapi/${endpoint}`)) })
      record({ kind: 'side-effects-blocked' })
      // A detached CDP agent can discard its policy; retain it for this task page.
      page.once('close', () => { void session.detach().catch(() => {}) })
    } catch (error) {
      await session.detach().catch(() => {})
      throw error
    }
  })
  hooks.jobDetailIsGetFromRecommendList.tapPromise('CollectAcceptance', async (detail) => {
    let windowState: string | null = null
    const session = await page.createCDPSession()
    try { windowState = (await session.send('Browser.getWindowForTarget')).bounds.windowState }
    finally { await session.detach() }
    const evidence = await page.evaluate(() => {
      const doc = (globalThis as any).document
      const companyRoot = doc.querySelector('.page-company-position')?.__vue__
      const company = Array.isArray(companyRoot?.jobList) ? companyRoot
        : companyRoot?.$children?.find(child => Array.isArray(child.jobList))
      const root = company || doc.querySelector('.page-jobs-main')?.__vue__
      const view = doc.querySelector('.job-detail-box')
      const filters = doc.querySelector('.filter-condition-inner')
      const typeControl = filters?.__vue__?.$children?.find(child => child.placeholder === '求职类型')?.$el
      return {
        documentVisibility: doc.visibilityState,
        row: root?.currentJob || {},
        source: company ? 'company' : 'jobs', pageNumber: company?.currentPage ?? null,
        loggedIn: company ? company.$store?.getters?.isLogin === true : null,
        scope: company ? { brandId: company.encryptBrandId, query: String(company.queryParams?.query || '').trim(),
          city: String(company.city || ''), positionLv1: company.position || '', salary: company.queryParams?.salary || '',
          experience: company.queryParams?.experience || '', degree: company.queryParams?.degree || '' }
          : Object.fromEntries(['query', 'city', 'jobType', 'experience', 'salary', 'degree', 'industry', 'scale']
            .filter(key => root?.formData?.[key] !== undefined).map(key => [key, root.formData[key]])),
        visibleDetail: view?.innerText?.slice(0, 18000) || '',
        typeOptions: [...(typeControl?.querySelectorAll('li, a') || [])].map(el => ({
          text: el.textContent.trim(), ka: el.getAttribute('ka'), active: el.classList.contains('active')
        })),
      }
    })
    current = {
      observation: `${process.pid}:${++sequence}`,
      jobInfo: pick(detail.jobInfo, ['encryptId', 'jobName', 'positionName', 'experienceName', 'degreeName',
        'jobType', 'jobTypeName', 'jobNature', 'jobNatureName', 'salaryDesc', 'payTypeDesc']),
      brandComInfo: pick(detail.brandComInfo, ['encryptBrandId', 'brandName', 'scaleName', 'industryName', 'stageName']),
      row: pick(evidence.row, ['encryptJobId', 'jobName', 'cityName', 'jobExperience', 'jobDegree', 'salaryDesc',
        'jobType', 'jobTypeName', 'jobNature', 'jobNatureName', 'brandName', 'encryptBrandId']),
      scope: evidence.scope, visibleDetail: evidence.visibleDetail, typeOptions: evidence.typeOptions,
      windowState, documentVisibility: evidence.documentVisibility,
      source: evidence.source, pageNumber: evidence.pageNumber, loggedIn: evidence.loggedIn,
    }
    record({ kind: 'review', ...current })
  })
  events.on('TASK_PROGRESS', ({ kind, detail }) => {
    if (['collected', 'skipped'].includes(kind) && current)
      record({ kind: 'decision', observation: current.observation,
        jobId: current.jobInfo.encryptId, accepted: kind === 'collected', reason: detail })
    if (kind === 'sent' || kind === 'marked') {
      record({ kind: kind === 'sent' ? 'unexpected-send' : 'unexpected-mark' })
      throw new Error('Collect acceptance must not send messages or mark jobs')
    }
  })
  process.once('exit', () => record({ kind: 'exit' }))
}

// Own-window focus events for opt-in desktop acceptance; never inspect other applications.
export function attachCollectFocusEvidence(window: import('electron').BrowserWindow) {
  const folder = process.env.GEEKGEEKRUN_COLLECT_AUDIT_DIR
  if (!folder || !path.isAbsolute(folder)) return
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
  const record = (event: string) => {
    if (window.isDestroyed()) return
    fs.appendFileSync(path.join(folder, 'ui-focus.jsonl'), JSON.stringify({
      at: Date.now(), event, focused: window.isFocused(), minimized: window.isMinimized(),
    }) + '\n', { mode: 0o600 })
  }
  record('created')
  window.on('focus', () => record('focus'))
  window.on('blur', () => record('blur'))
}
