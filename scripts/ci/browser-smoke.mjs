// Real headed Chrome, an isolated profile, offline cards and an in-memory DB.
// This checks the host runtime; it never authenticates to or contacts BOSS.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const load = name => import(pathToFileURL(path.join(root, 'packages/geek-auto-start-chat-with-boss', name)).href)
const { launchTaskBrowser, showTaskBrowser } = await load('task-browser.mjs')
const { watchTaskBrowser, beginChatConfirmation } = await load('browser-health.mjs')
const { closeOwnedBrowser } = await load('browser-cleanup.mjs')
const { openJobCardForReview, assertCanGreet } = await load('auto-chat-navigation.mjs')
const { assertCompanyPlatformFilters } = await load('company-page.mjs')
const { createJobDetailMatcher, requiredJobConditionReasons } = await load('job-filter-config.mjs')
const { createRunBudget } = await load('run-budget.mjs')
const { attachJobRequestBudget } = await load('job-request-budget.mjs')
const { SyncHook, AsyncSeriesHook } = require('tapable')
const Plugin = require(path.join(root, 'packages/sqlite-plugin/dist/index.js')).default
const candidates = process.platform === 'win32'
  ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)
    .map(folder => path.join(folder, 'Google/Chrome/Application/chrome.exe'))
  : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome']
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || candidates.find(candidate => fs.existsSync(candidate))
assert.ok(executablePath && fs.existsSync(executablePath), 'A real installed Chrome is required; browser verification cannot be skipped')
const puppeteer = require('puppeteer')
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-browser-ci-'))
const report = { platform: process.platform, scenarios: [], bossRequests: 0, collected: 0, skipped: 0, sent: 0, marked: 0 }
const reportPath = path.join(root, '.ci-reports/browser-smoke.json')
try {
  for (const pendingChat of [false, true]) {
    let browser, monitor, budgetMonitor, ds
    const budget = createRunBudget({ limits: { requests: 50, detailRequests: 20, activeMinutes: 0 } })
    try {
      const profile = fs.mkdtempSync(path.join(runtime, 'profile-'))
      const task = await launchTaskBrowser({ launch: options => puppeteer.launch({ ...options, executablePath, userDataDir: profile }) })
      browser = task.browser; const page = task.page
      report.browserVersion = await browser.version()
      monitor = watchTaskBrowser(browser, page, { onFailure: error => budget.fail(error) })
      budgetMonitor = await attachJobRequestBudget(page, budget, { onConnectionLost: () => monitor.connectionLost() })
      const session = await page.createCDPSession()
      await session.send('Network.enable')
      await session.send('Network.setBlockedURLs', { urls: ['*://*.zhipin.com/*', '*://zhipin.com/*'] })
      page.on('request', request => { if (/(^|\.)zhipin\.com$/.test(new URL(request.url()).hostname)) report.bossRequests++ })
      assert.equal((await session.send('Browser.getWindowForTarget')).bounds.windowState, 'minimized')
      await page.setContent('<div class="page-company-position"><ul class="position-job-list"><li class="job-card-box" style="height:80px">岗位一</li><li class="job-card-box" style="height:80px">岗位二</li></ul></div><div class="job-detail-box"></div>')
      if (!pendingChat) {
        const brand = '0123456789abcdef1nRz'
        await page.evaluate(brandId => {
          const rows = [1, 2].map(n => ({ encryptJobId: 'ci-job-' + n, encryptBrandId: brandId, city: 101280600 }))
          const detail = index => ({ jobInfo: { encryptId: rows[index].encryptJobId, encryptUserId: 'ci-boss', jobName: index ? '销售岗位' : '实习工程师',
            positionName: '软件开发', degreeName: index ? '大专' : '本科', experienceName: '在校生', postDescription: '离线示例岗位', salaryDesc: '200-250元/天', jobType: 4 },
          bossInfo: { name: 'CI', title: 'HR', activeTimeDesc: '今日活跃' }, brandComInfo: { encryptBrandId: brandId, brandName: 'CI示例公司',
            customerBrandName: 'CI示例公司', industry: 100020, industryName: '互联网', scale: 303, scaleName: '100-499人', stageName: 'A轮', labels: [] } })
          const v = { jobList: rows, currentJob: rows[0] }
          document.querySelector('.page-company-position').__vue__ = v
          const box = document.querySelector('.job-detail-box'); box.__vue__ = { data: detail(0) }
          document.querySelectorAll('li.job-card-box').forEach((card, index) => { card.onclick = () => { v.currentJob = rows[index]; box.__vue__.data = detail(index) } })
        }, brand)
        const plugin = new Plugin(':memory:', { collectOnlyMatched: true, captureNetworkDetails: false }); plugin.runRecordId = 1
        ds = await plugin.initPromise; ds.setOptions({ logging: false })
        const hooks = Object.fromEntries(['pageGotten', 'userInfoResponse', 'mainFlowWillLaunch', 'jobDetailIsGetFromRecommendList',
          'jobMatchedForCollection', 'newChatWillStartup', 'newChatStartup', 'jobMarkedAsNotSuit']
          .map(name => [name, name === 'pageGotten' ? new SyncHook(['data']) : new AsyncSeriesHook(['data', 'options'])]))
        plugin.apply(hooks); hooks.pageGotten.call(page)
        const list = await page.$('.position-job-list'), matcher = createJobDetailMatcher({ expectJobNameRegExpStr: '实习' })
        try {
          for (const index of [0, 1]) {
            budget.reserveRequest('detail') // Fixture reservations exercise disconnect accounting, not real site requests.
            await openJobCardForReview({ page, list, index, jobId: 'ci-job-' + (index + 1), checkResponses: () => monitor.assertHealthy() })
            const live = await page.evaluate(() => ({ row: document.querySelector('.page-company-position').__vue__.currentJob, detail: document.querySelector('.job-detail-box').__vue__.data }))
            assertCompanyPlatformFilters({ type: 'company', brandId: brand }, live.row, live.detail, { cityList: ['101280600'], industryList: [100020], scaleList: [303] })
            await hooks.jobDetailIsGetFromRecommendList.promise(live.detail)
            if (matcher(live.detail.jobInfo) && !requiredJobConditionReasons(live.detail, { degrees: ['本科'], jobNatures: ['实习'] }).length) {
              await hooks.jobMatchedForCollection.promise(live.detail); report.collected++
            } else report.skipped++
            assert.throws(() => assertCanGreet({ isCollectMode: true, targetJobIndex: index, matchedJobId: live.row.encryptJobId, targetJobId: live.row.encryptJobId }), /COLLECT_MODE_CHAT_BLOCKED/)
          }
        } finally { await list.dispose() }
        const db = ds.driver.databaseConnection
        assert.equal(db.prepare('SELECT count(*) AS n FROM job_info').get().n, 1)
        assert.equal(db.prepare('SELECT count(*) AS n FROM job_run_observation').get().n, 1)
        assert.equal(db.prepare('SELECT count(*) AS n FROM chat_startup_log').get().n, 0)
        assert.equal(db.prepare('SELECT count(*) AS n FROM mark_as_not_suit_log').get().n, 0)
        await showTaskBrowser(page)
        assert.equal((await session.send('Browser.getWindowForTarget')).bounds.windowState, 'normal')
      } else beginChatConfirmation(page) // No communication is actually sent by this offline fixture.
      await session.detach()
      await page.close()
      const expected = pendingChat ? 'AUTO_CHAT_MESSAGE_SEND_UNCONFIRMED' : 'AUTO_CHAT_BROWSER_UNAVAILABLE'
      await assert.rejects(budget.guard(() => assert.fail('cannot act after page close')), error => error.message === expected)
      report.scenarios.push({ pendingChat, pausedWith: expected, requestReservations: budget.snapshot().usage.requests })
    } finally {
      monitor?.dispose(); budgetMonitor?.dispose(); await ds?.destroy(); await closeOwnedBrowser(browser)
    }
  }
  assert.equal(report.bossRequests, 0); assert.equal(report.collected, 1); assert.equal(report.skipped, 1)
  report.success = true
} catch (error) { report.success = false; report.error = error.message; process.exitCode = 1 }
finally {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  fs.rmSync(runtime, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  console.log(JSON.stringify(report))
}
