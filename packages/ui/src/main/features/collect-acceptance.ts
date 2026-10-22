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
  hooks.pageGotten.tap('CollectAcceptance', (value) => { page = value })
  hooks.jobDetailIsGetFromRecommendList.tapPromise('CollectAcceptance', async (detail) => {
    let windowState: string | null = null
    const session = await page.createCDPSession()
    try { windowState = (await session.send('Browser.getWindowForTarget')).bounds.windowState }
    finally { await session.detach() }
    const evidence = await page.evaluate(() => {
      const doc = (globalThis as any).document
      const root = doc.querySelector('.page-jobs-main')?.__vue__
      const view = doc.querySelector('.job-detail-box')
      const filters = doc.querySelector('.filter-condition-inner')
      const typeControl = filters?.__vue__?.$children?.find(child => child.placeholder === '求职类型')?.$el
      return {
        documentVisibility: doc.visibilityState,
        row: root?.currentJob || {},
        scope: Object.fromEntries(['query', 'city', 'jobType', 'experience', 'salary', 'degree', 'industry', 'scale']
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
      brandComInfo: pick(detail.brandComInfo, ['brandName', 'scaleName', 'industryName', 'stageName']),
      row: pick(evidence.row, ['encryptJobId', 'jobName', 'cityName', 'jobExperience', 'jobDegree', 'salaryDesc',
        'jobType', 'jobTypeName', 'jobNature', 'jobNatureName', 'brandName']),
      scope: evidence.scope, visibleDetail: evidence.visibleDetail, typeOptions: evidence.typeOptions,
      windowState, documentVisibility: evidence.documentVisibility,
    }
    record({ kind: 'review', ...current })
  })
  events.on('TASK_PROGRESS', ({ kind, detail }) => {
    if (['collected', 'skipped'].includes(kind) && current)
      record({ kind: 'decision', observation: current.observation,
        jobId: current.jobInfo.encryptId, accepted: kind === 'collected', reason: detail })
    if (kind === 'sent') {
      record({ kind: 'unexpected-send' })
      throw new Error('Collect acceptance must not send messages')
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
