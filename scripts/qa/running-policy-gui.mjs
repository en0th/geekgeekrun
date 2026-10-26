// Offline acceptance of the built renderer with real local IPC and synthetic task data.
// No cookies, account login, browser worker, send, or platform requests are permitted.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../../', import.meta.url)), require = createRequire(path.join(root, 'package.json'))
const puppeteer = require('puppeteer'), wait = ms => new Promise(r => setTimeout(r, ms))
const output = path.resolve(process.argv[2] || path.join(root, '.ci-reports/gui-running-policy'))
const runtime = path.join(output, 'isolated-runtime')
if (fs.existsSync(runtime)) throw Error('Use a new output directory; existing runtime is preserved.')
for (const p of [output, path.join(runtime, 'config'), path.join(runtime, 'storage')]) fs.mkdirSync(p, { recursive: true })
const write = (folder, file, data) => fs.writeFileSync(path.join(runtime, folder, file), JSON.stringify(data, null, 2))
write('config', 'update.json', { autoCheck: false, ignoredVersions: [] })
write('config', 'job-status-poll-settings.json', { enabled: false })
write('config', 'run-policy.json', { version: 1, profile: 'safe', dailyLimit: 100, rest: { enabled: true, workMinutes: 30, restMinutes: 10 } })
write('config', 'llm.json', [{ model: 'offline-fixture', providerCompleteApiUrl: 'http://127.0.0.1:1/v1', providerApiSecret: 'offline-test-only', enabled: true, requestTimeoutSeconds: 120, maxRetries: 3, thinkingEnabled: false }])
write('storage', 'boss-cookies.json', [])
write('storage', 'boss-local-storage.json', {})
fs.writeFileSync(path.join(runtime, 'storage/ui-first-launch-notice-flag'), JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/package.json'), 'utf8')).version)
const initialBoss = JSON.parse(fs.readFileSync(path.join(root, 'packages/geek-auto-start-chat-with-boss/default-config-file/boss.json'), 'utf8'))
Object.assign(initialBoss, { autoChatPerSourceSuccessLimit: 1001, autoChatNoMatchStreakLimit: 1000,
  expectJobRegExpStr: '', expectJobNameRegExpStr: '产品', expectJobTypeRegExpStr: '', expectJobDescRegExpStr: '',
  fieldsForUseCommonConfig: {}, expectSalaryLow: null, expectSalaryHigh: null, expectWorkExpList: [], isPosterHrFilterEnabled: false,
  jobSourceList: [{ type: 'expect', enabled: true }, { type: 'recommend', enabled: true }] })
write('config', 'boss.json', initialBoss)
const at = Date.now()
const policy = { version: 1, profile: 'safe', dailyLimit: 100, rest: { enabled: true, workMinutes: 30, restMinutes: 10 } }
const frozen = { 'boss.json': { autoChatRunMode: 'chat', expectJobNameRegExpStr: '产品', autoChatRunPolicy: policy, autoChatTimedRest: policy.rest } }
write('storage', 'auto-chat-resume.json', { runRecordId: 900001, runMode: 'chat', savedAt: at, exitCode: 102, messageSendPending: false,
  runState: { accountId: 'offline-fixture' }, progress: { startedAt: at - 600000, viewed: 120, sent: 100, collected: 120, skipped: 3,
    state: 'blocked', detail: '本软件今日自动打招呼目标已达到，进度已保留。',
    dailyQuota: { confirmed: 100, limit: 100, pendingCount: 0 }, budget: { usage: { activeMs: 600000, requests: 240, detailRequests: 120 } } } })
write('storage', 'scheduled-job-runs.json', { version: 1, items: [{ id: 'offline-booking', at: at + 86400000, accountId: 'offline-fixture', createdAt: at,
  state: 'pending', detail: '隔离验收合成预约，不连接BOSS', config: frozen }] })
const executable = process.env.QA_EXECUTABLE || require('electron')
function seedSyntheticTaskConfig(config) {
  const dbFile = path.join(runtime, 'storage/public.db')
  assert(dbFile.startsWith(output + path.sep))
  const code = `const DB=require(${JSON.stringify(require.resolve('better-sqlite3'))});const db=new DB(process.argv[1],{fileMustExist:true});db.prepare('INSERT INTO auto_start_chat_run_record(id,date,configSnapshot) VALUES(900001,?,?) ON CONFLICT(id) DO UPDATE SET configSnapshot=excluded.configSnapshot').run(new Date().toISOString(),process.argv[2]);db.close()`
  const result = spawnSync(require('electron'), ['-e', code, dbFile, JSON.stringify({ actualConfig: config })], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}
const args = process.env.QA_EXECUTABLE ? [] : [path.join(root, 'packages/ui')]
const env = { ...process.env, GEEKGEEKRUN_RUNTIME_DIR: runtime }
delete env.ELECTRON_RUN_AS_NODE; delete env.GEEKGEEKRUN_TASK_CONFIG_FILE
const child = spawn(executable, [...args, '--remote-debugging-port=0', '--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let endpoint, log = '', browser, testingPage, failure = ''
const errors = [], files = [], checks = [], screenshots = [], consoleErrors = [], typography = [], typographyIssues = []
let bossRequests = 0
const capture = d => { log += d; endpoint ||= /DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(log)?.[1] }
child.stdout.on('data', capture); child.stderr.on('data', capture)
try {
  const deadline = Date.now() + 60000
  while (!endpoint && Date.now() < deadline && child.exitCode === null) await wait(100)
  assert(endpoint, log.slice(-4000))
  browser = await puppeteer.connect({ browserWSEndpoint: endpoint })
  let page
  while (Date.now() < deadline) {
    page = (await browser.pages()).find(p => p.url().includes('/renderer/index.html'))
    if (page) break
    await wait(100)
  }
  assert(page, 'Renderer missing')
  testingPage = page
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('requestfailed', r => { if (r.url().startsWith('file:')) files.push(r.url()) })
  await page.setRequestInterception(true)
  page.on('request', r => { const u = new URL(r.url()); if (/(^|\.)zhipin\.com$/.test(u.hostname)) bossRequests++; void (/^https?:$/.test(u.protocol) ? r.abort() : r.continue()).catch(() => {}) })
  await page.waitForSelector('.ux-shell', { timeout: 45000 })
  assert.equal(await page.$eval('.ux-version-link', e => e.textContent.trim()), '版本：' + JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/package.json'), 'utf8')).version)
  async function button(text) {
    const handle = await page.waitForFunction(t => [...document.querySelectorAll('button,[role="tab"]')].find(e => e.textContent.trim() === t && e.getBoundingClientRect().width > 0), {}, text)
    await handle.asElement().click()
  }
  async function capturePage(name, width = 1600, height = 1000) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 }); await wait(350)
    await page.evaluate(() => {
      if (document.querySelector('#qa-isolation-label')) return
      const el = document.createElement('span'); el.id = 'qa-isolation-label'; el.textContent = '隔离验收 · 合成任务数据'
      Object.assign(el.style, { position: 'fixed', bottom: '4px', left: '240px', zIndex: 99999, background: '#fff', color: '#475467', fontSize: '11px', padding: '3px 8px' }); document.body.append(el)
    })
    const file = path.join(output, name + '.png'); await page.screenshot({ path: file, fullPage: false }); screenshots.push(file)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), name + ': page overflow')
    // Keep pointer coordinates inside the real 1280px Electron window after wide captures.
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 }); await wait(300)
  }
  await page.evaluate(() => { location.hash = '#/ux/settings' })
  await button('任务运行'); await page.waitForSelector('.ux-run-policy')
  await page.waitForFunction(() => ![...document.querySelectorAll('.ux-main .el-loading-mask')].some(e => e.checkVisibility()))
  await capturePage('settings-safe')
  const tabs = await page.$$eval('.ux-main [role="tab"]', els => els.map(e => e.textContent.trim()))
  assert.deepEqual(tabs, ['账号与浏览器', '任务运行', 'AI助手', '通知提醒', '数据管理', '关于与更新'])
  checks.push('six settings categories')
  const dailySettings = await page.$eval('.ux-run-policy', e => ({ text: e.textContent, width: e.querySelector('.ux-daily-target').getBoundingClientRect().width }))
  assert(dailySettings.text.includes('每个账号每天最多'))
  assert(!/刷新用量|仅今天追加|今日用量|首次运行时同步/.test(dailySettings.text))
  assert.equal(dailySettings.width, 112)
  const dailyPolicy = () => page.evaluate(() => window.electron.ipcRenderer.invoke('run-policy-info'))
  async function typeDaily(value) {
    const control = await page.$('input[aria-label="每日自动打招呼人数"]')
    await control.click({ clickCount: 3 }); await control.press('Backspace')
    if (value !== '') await control.type(String(value))
    await control.press('Tab')
  }
  for (const value of ['0', '151', '300']) {
    await typeDaily(value)
    assert.equal(await page.$eval('input[aria-label="每日自动打招呼人数"]', e => e.value), value)
    await page.waitForSelector('#ux-daily-target-error')
    const reason = await page.$eval('#ux-daily-target-error', e => e.textContent)
    assert.match(reason, value === '0' ? /没有可用的自动打招呼数量/ : /单个账号.*150/)
    await button('保存设置')
    assert.equal((await dailyPolicy()).dailyLimit, 100)
    assert.equal(await page.$eval('input[aria-label="每日自动打招呼人数"]', e => e.value), value)
    assert.equal(await page.$eval('input[aria-label="每日自动打招呼人数"]', e => e.getAttribute('aria-invalid')), 'true')
    if (value === '151') await capturePage('daily-target-over-limit', 1280, 900)
  }
  for (const value of [1, 150, 100]) {
    await typeDaily(value)
    await page.waitForSelector('#ux-daily-target-error', { hidden: true })
    await button('保存设置')
    await page.waitForFunction(async expected => (await window.electron.ipcRenderer.invoke('run-policy-info')).dailyLimit === expected, {}, value)
    await page.waitForFunction(() => !document.querySelector('input[aria-label="每日自动打招呼人数"]').disabled)
  }
  checks.push('zero/over-limit daily targets retain raw input with an inline reason, cannot save, and valid 1/150 boundaries persist')
  const restLayout = await page.$eval('.ux-policy-section-head', e => {
    const label = e.querySelector('h3').getBoundingClientRect(), control = e.querySelector('.el-switch').getBoundingClientRect()
    return { gap: control.left - label.right, text: e.parentElement.textContent }
  })
  assert(restLayout.gap >= 8 && restLayout.gap <= 20); assert(restLayout.text.includes('每运行'))
  await page.click('.ux-policy-section-head .el-switch')
  await page.waitForSelector('input[aria-label="连续运行分钟"]', { hidden: true })
  await page.click('.ux-policy-section-head .el-switch')
  await page.waitForSelector('input[aria-label="连续运行分钟"]')
  checks.push('rest switch is adjacent to its label; account daily target is capped at 150 with no settings usage links')
  await page.click('button[aria-label="每日自动打招呼说明"]')
  await page.waitForFunction(() => [...document.querySelectorAll('.ux-settings-help')].some(e => e.textContent.includes('手机') && e.checkVisibility()))
  assert(await page.evaluate(() => [...document.querySelectorAll('.ux-settings-help')].some(e => e.checkVisibility() && e.textContent.includes('300'))))
  await page.click('button[aria-label="每日自动打招呼说明"]')
  await page.waitForFunction(() => ![...document.querySelectorAll('.ux-settings-help')].some(e => e.checkVisibility()))
  checks.push('long explanations open only on demand')
  const helpIcons = await page.$$eval('.ux-profile-option .ux-settings-help-trigger .el-icon', els => els.map(e => ({ size: getComputedStyle(e).fontSize, width: e.getBoundingClientRect().width })))
  assert.equal(helpIcons.length, 3); assert(helpIcons.every(icon => icon.size === '14px' && icon.width >= 14))
  for (const [index, label, requests, details, minutes] of [[0, '安全模式', 500, 200, 120], [1, '深度模式', 1000, 400, 240], [2, '极速模式', 500, 200, 120]]) {
    const selected = await page.$eval('.ux-profile-options .el-radio-button.is-active input', e => e.value)
    await page.click(`button[aria-label="${label}说明"]`)
    await page.waitForFunction(expected => [...document.querySelectorAll('.ux-profile-help')].some(e => e.checkVisibility() && e.textContent.includes(`读取${expected.requests}次`) && e.textContent.includes(`详情最多${expected.details}次`) && e.textContent.includes(`${expected.minutes}分钟`)), {}, { requests, details, minutes })
    assert.equal(await page.$eval('.ux-profile-options .el-radio-button.is-active input', e => e.value), selected)
    assert.equal((await dailyPolicy()).profile, 'safe')
    if (!index) await capturePage('safe-mode-parameters', 1280, 900)
    await page.click(`button[aria-label="${label}说明"]`)
    await page.waitForFunction(() => ![...document.querySelectorAll('.ux-profile-help')].some(e => e.checkVisibility()))
  }
  const helpButton = await page.$('button[aria-label="安全模式说明"]')
  await helpButton.focus(); await page.keyboard.press('Enter')
  await page.waitForFunction(() => [...document.querySelectorAll('.ux-profile-help')].some(e => e.checkVisibility()))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => ![...document.querySelectorAll('.ux-profile-help')].some(e => e.checkVisibility()))
  checks.push('all three mode help buttons show execution parameters, do not select or save a mode, and support keyboard open/close')
  await page.click('.ux-run-policy .ux-profile-option:last-child .el-radio-button')
  await page.waitForSelector('.ux-policy-risk'); assert(await page.$eval('.ux-policy-risk', e => e.textContent.includes('更容易触发平台风控')))
  assert.equal(await page.$('.ux-run-policy .el-alert--error'), null)
  await capturePage('settings-fast-risk', 1280, 900); checks.push('fast mode visible red warning')
  await page.click('.ux-run-policy .ux-profile-option:nth-child(2) .el-radio-button')
  const work = await page.$('input[aria-label="连续运行分钟"]'); await work.click({ clickCount: 3 }); await work.type('45'); await work.press('Tab')
  await button('保存设置'); await wait(500)
  const saved = await page.evaluate(() => window.electron.ipcRenderer.invoke('run-policy-info'))
  assert.equal(saved.profile, 'deep'); assert.equal(saved.rest.workMinutes, 45); assert.equal(saved.dailyLimit, 100)
  checks.push('real IPC saves profile and custom rest without changing daily target')
  for (const label of tabs) {
    await button(label); await wait(250)
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.ux-main .ux-card h2, .ux-main .ux-card h3, .ux-main .ux-card .ux-field > label, .ux-main .ux-card .el-input__inner, .ux-main .ux-card .el-button')]
      .filter(e => e.checkVisibility()).map(e => ({ role: e.tagName === 'H2' ? 'section' : 'body', label: e.textContent.trim().slice(0, 24), size: getComputedStyle(e).fontSize })))
    assert(sizes.length, label + ': settings not ready')
    for (const item of sizes) if (item.size !== (item.role === 'section' ? '18px' : '14px')) typographyIssues.push({ category: label, ...item })
    typography.push({ category: label, sizes })
  }
  checks.push('all six settings categories use the same title, label and control sizes')
  await button('AI助手'); await page.waitForSelector('#ai-model-settings .ux-settings-actions')
  assert.equal(await page.$('.ux-footer--ai'), null)
  const aiLayout = await page.$eval('#ai-model-settings .ux-settings-actions', e => ({ position: getComputedStyle(e).position, parent: e.closest('#ai-model-settings')?.id, left: e.getBoundingClientRect().left, cardLeft: e.closest('#ai-model-settings').getBoundingClientRect().left }))
  assert.equal(aiLayout.position, 'static'); assert.equal(aiLayout.parent, 'ai-model-settings'); assert(aiLayout.left - aiLayout.cardLeft < 50)
  const aiTimeout = await page.$('input[aria-label="AI请求超时秒数"]')
  await aiTimeout.click({ clickCount: 3 }); await aiTimeout.type('90'); await aiTimeout.press('Tab')
  const savedModels = () => page.evaluate(async () => (await window.electron.ipcRenderer.invoke('fetch-config-file-content')).config['llm.json'])
  assert.equal((await savedModels())[0].requestTimeoutSeconds, 120)
  assert(await page.$eval('.ux-save-status', e => e.textContent.includes('未保存')))
  await page.$eval('#ai-model-settings .ux-settings-actions', e => e.scrollIntoView({ block: 'center' }))
  await button('保存AI配置')
  await page.waitForFunction(() => document.querySelector('.ux-save-status')?.textContent === '已保存')
  assert.equal((await savedModels())[0].requestTimeoutSeconds, 90)
  await page.evaluate(() => document.querySelector('.ux-main').scrollTo(0, 0))
  await capturePage('ai-inline-save')
  checks.push('AI uses an inline left-aligned save action; editing is not applied before explicit real IPC save')
  await button('数据管理'); await page.waitForSelector('[role="switch"][aria-label="保存运行日志"]')
  const logBefore = await page.evaluate(async () => (await window.electron.ipcRenderer.invoke('log-settings-info')).settings.enabled)
  const logSwitch = await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="保存运行日志"]')?.closest('.el-switch'))
  await logSwitch.asElement().click()
  await page.waitForFunction(async before => (await window.electron.ipcRenderer.invoke('log-settings-info')).settings.enabled !== before, {}, logBefore)
  checks.push('ordinary log preference saves immediately without an extra confirmation button')
  await page.evaluate(() => { location.hash = '#/ux/auto' })
  await page.waitForSelector('.ux-el-steps .el-step:nth-child(2)')
  await page.click('.ux-el-steps .el-step:nth-child(2)')
  await page.waitForSelector('.ux-source-rotation')
  const bossConfig = () => page.evaluate(async () => (await window.electron.ipcRenderer.invoke('fetch-config-file-content')).config['boss.json'])
  await page.click('#source-order-toggle')
  await page.waitForSelector('.ux-source-drag-list')
  await page.$eval('.ux-source-drag-list', e => e.scrollIntoView({ block: 'center' }))
  assert(!await page.$eval('#source-order', e => /先查看|后查看/.test(e.textContent)))
  const grip = await page.$eval('.ux-source-drag-row', row => ({
    circles: row.querySelectorAll('.ux-source-drag-handle svg circle').length,
    right: row.querySelector('.ux-source-drag-handle').getBoundingClientRect().left > row.querySelector('.ux-source-order-label').getBoundingClientRect().right,
  }))
  assert.equal(grip.circles, 6); assert(grip.right)
  const fromHandle = await page.$('.ux-source-drag-row[data-source-type="expect"] .ux-source-drag-handle')
  const toRow = await page.$('.ux-source-drag-row[data-source-type="recommend"]')
  const fromBox = await fromHandle.boundingBox(), toBox = await toRow.boundingBox()
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2)
  await page.mouse.down(); await page.mouse.move(fromBox.x + 15, fromBox.y + 30, { steps: 4 }); await wait(150)
  await page.mouse.move(fromBox.x + 15, toBox.y + toBox.height - 5, { steps: 10 }); await wait(100)
  assert(await page.$('.ux-source-drag-chosen'))
  await page.mouse.up()
  await page.waitForFunction(async () => (await window.electron.ipcRenderer.invoke('fetch-config-file-content')).config['boss.json'].jobSourceList.filter(s => s.enabled).map(s => s.type).join(',') === 'recommend,expect')
  await capturePage('source-order-dragged', 1280, 900)
  const expectHandle = await page.$('.ux-source-drag-row[data-source-type="expect"] .ux-source-drag-handle')
  await expectHandle.focus(); await page.keyboard.down('Alt'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('Alt')
  await page.waitForFunction(async () => (await window.electron.ipcRenderer.invoke('fetch-config-file-content')).config['boss.json'].jobSourceList.filter(s => s.enabled).map(s => s.type).join(',') === 'expect,recommend')
  checks.push('source order supports pointer dragging with chosen/ghost feedback and animated sorting, real IPC persistence and keyboard reordering')
  assert.equal((await bossConfig()).autoChatPerSourceSuccessLimit, 1001)
  assert.equal(await page.$('.ux-source-mode-select'), null)
  assert.equal(await page.$eval('#source-switch-conditions-toggle', e => e.getAttribute('aria-expanded')), 'false')
  assert.equal(await page.$('input[aria-label="每个来源最多处理岗位数"]'), null)
  await page.$eval('.ux-source-rotation', e => e.scrollIntoView({ block: 'center' }))
  await capturePage('source-conditions-collapsed', 1280, 900)
  await page.click('#source-switch-conditions-toggle')
  await page.waitForSelector('#source-switch-conditions input')
  const rowTexts = await page.$$eval('.ux-source-switch-row', rows => rows.map(e => [...e.querySelectorAll(':scope > span:not(.ux-tip)')].map(s => s.textContent).join('X')))
  assert.deepEqual(rowTexts, ['每成功打招呼X个岗位后切换来源', '连续不符合条件X个岗位后切换来源'])
  assert.equal(await page.$eval('input[aria-label="每个来源最多处理岗位数"]', e => e.value), '1001')
  const widths = await page.$$eval('.ux-source-rotation .el-input-number', els => els.map(e => e.getBoundingClientRect().width))
  assert(widths.length === 2 && widths.every(w => w === 112))
  const lefts = await page.$$eval('.ux-source-rotation .el-input-number', els => els.map(e => e.getBoundingClientRect().left))
  assert.equal(lefts[0], lefts[1])
  async function sourceNumber(label, value, key) {
    await page.$eval('.ux-source-rotation', e => e.scrollIntoView({ block: 'center' }))
    const control = await page.$(`input[aria-label="${label}"]`)
    await control.click({ clickCount: 3 }); await control.type(String(value)); await control.press('Tab')
    await page.waitForFunction(async (field, expected) => (await window.electron.ipcRenderer.invoke('fetch-config-file-content')).config['boss.json'][field] === expected, {}, key, value)
  }
  await sourceNumber('每个来源最多处理岗位数', 0, 'autoChatPerSourceSuccessLimit')
  await sourceNumber('连续不合适岗位数', 0, 'autoChatNoMatchStreakLimit')
  await sourceNumber('每个来源最多处理岗位数', 20, 'autoChatPerSourceSuccessLimit')
  await sourceNumber('连续不合适岗位数', 30, 'autoChatNoMatchStreakLimit')
  checks.push('direct compact source counts preserve legacy values and autosave disabled/numeric thresholds without a mode selector')
  const previewStyle = await page.$eval('.ux-preview-actions', e => ({ top: parseFloat(getComputedStyle(e).marginTop), button: getComputedStyle(e.querySelector('button')).backgroundColor, text: e.textContent }))
  assert(previewStyle.top >= 24); assert.notEqual(previewStyle.button, 'rgb(255, 255, 255)')
  assert(!previewStyle.text.includes('不会开始'))
  await page.$eval('.ux-source-rotation', e => e.scrollIntoView({ block: 'center' }))
  await page.$eval('input[aria-label="连续不合适岗位数"]', e => e.blur()); await page.mouse.move(1100, 80)
  await capturePage('source-options-and-preview', 1280, 900)
  await page.click('#source-switch-conditions-toggle')
  await page.waitForSelector('#source-switch-conditions', { hidden: true })
  assert.equal((await bossConfig()).autoChatPerSourceSuccessLimit, 20)
  await page.click('#source-switch-conditions-toggle')
  await page.waitForSelector('#source-switch-conditions input')
  assert.equal(await page.$eval('input[aria-label="每个来源最多处理岗位数"]', e => e.value), '20')
  checks.push('source conditions default to a collapsed sibling panel, use the requested wording and retain numbers across toggles')
  await page.click('.ux-preview-button')
  await page.waitForFunction(() => [...document.querySelectorAll('.el-dialog')].some(e => e.checkVisibility() && e.textContent.includes('预览')))
  await page.click('.el-dialog__headerbtn')
  checks.push('separated blue preview button opens the actual preview dialog')
  await page.evaluate(() => { location.hash = '#/ux/tasks' })
  await page.waitForSelector('.ux-scheduled-runs .el-table')
  await capturePage('tasks-and-booking')
  await button('取消定时启动'); await page.waitForSelector('.el-message-box .el-button--primary'); await page.click('.el-message-box .el-button--primary')
  await page.waitForFunction(() => document.querySelector('.ux-scheduled-runs')?.textContent.includes('已取消'))
  await page.waitForSelector('.el-message-box__wrapper', { hidden: true }); await wait(400)
  checks.push('real IPC cancels future booking without starting a task')
  // Current task cards and/or rows expose the same local details drawer.
  // Element Plus also renders a column-measurement slot; target the real body row.
  await page.waitForSelector('.ux-main .el-table__body-wrapper .ux-task-actions button')
  await page.click('.ux-main .el-table__body-wrapper .ux-task-actions button'); await wait(500)
  await page.waitForSelector('.ux-running-expectation', { timeout: 5000 })
  const endStyle = await page.$eval('.ux-recovery .ux-task-end-button, .ux-task-end-button', e => ({ text: e.textContent.trim(), danger: e.classList.contains('el-button--danger'), plain: e.classList.contains('is-plain'), textOnly: e.classList.contains('is-text') || e.classList.contains('is-link') }))
  assert.equal(endStyle.text, '结束任务'); assert(endStyle.danger && endStyle.plain && !endStyle.textOnly)
  assert(await page.$eval('.ux-scheduled-runs', e => e.textContent.includes('定时启动') && !e.textContent.includes('预约启动')))
  checks.push('paused task end action uses the same red outline style and one-time scheduling is named timed start')
  assert(await page.evaluate(() => document.body.textContent.includes('追加今日数量')))
  assert(await page.$eval('.ux-running-expectation', e => e.textContent.includes('不代表BOSS剩余额度')))
  await capturePage('daily-goal-and-estimate', 1280, 900); checks.push('goal recovery and sampled estimate shown with honest scope')
  // Seed only the isolated synthetic database; render the saved snapshot through real read IPC.
  seedSyntheticTaskConfig(frozen)
  await button('任务配置')
  await page.waitForFunction(() => document.querySelector('.ux-template-facts')?.textContent.includes('未设置额外条件'))
  assert(!await page.$eval('.ux-template-facts', e => /companyScaleMin|jobNatures|\{/.test(e.textContent)))
  await capturePage('task-config-empty-conditions', 1280, 900)
  await button('运行概览')
  const fixtureBoss = { ...frozen['boss.json'], requiredJobConditions: { jobNatures: ['全职'], degrees: ['本科', '硕士'], industries: ['互联网'], financingStages: ['A轮'], excludedWords: ['外包'], companyScaleMin: 100, companyScaleMax: 500 } }
  seedSyntheticTaskConfig({ 'boss.json': fixtureBoss })
  await button('任务配置')
  await page.waitForFunction(() => document.querySelector('.ux-template-facts')?.textContent.includes('本科、硕士'))
  const factText = await page.$eval('.ux-template-facts', e => e.textContent)
  for (const text of ['全职', '100—500人', '互联网', 'A轮', '外包']) assert(factText.includes(text))
  assert(!/companyScaleMin|jobNatures|\{/.test(factText))
  await capturePage('task-config-readable-conditions', 1280, 900)
  checks.push('saved empty and populated hard-condition snapshots render readable fields through real database IPC without JSON')
  assert.deepEqual(typographyIssues, []); assert.deepEqual(errors, []); assert.deepEqual(files, []); assert.equal(bossRequests, 0)
  await page.evaluate(() => window.electron.ipcRenderer.send('app-quit'))
  // If app-quit is unsupported, Browser.close closes only this isolated application.
  await browser.close().catch(() => {})
} catch (error) {
  failure = error.message
  if (testingPage && !testingPage.isClosed()) {
    await testingPage.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    fs.writeFileSync(path.join(output, 'failure.txt'), await testingPage.evaluate(() => document.body.innerText).catch(() => 'Renderer closed'))
  }
  throw error
} finally {
  await browser?.disconnect().catch(() => {})
  if (child.exitCode === null) child.kill()
  fs.writeFileSync(path.join(output, 'electron.log'), log)
  fs.writeFileSync(path.join(output, 'gui-report.json'), JSON.stringify({ passed: !failure, failure, checks, typography, typographyIssues, errors, consoleErrors, files, bossRequests, screenshots,
    boundary: 'Offline isolated synthetic data. No live login, job browsing, outreach, or actual installer execution.' }, null, 2))
}
console.log(JSON.stringify({ checks, screenshots, output }))
