import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(new URL('../../package.json', import.meta.url))
const puppeteer = require('puppeteer')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function verifyInstalledGui({ executable, runtime, version, jobs, logFile }) {
  const env = { ...process.env, GEEKGEEKRUN_RUNTIME_DIR: runtime }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.GEEKGEEKRUN_TASK_CONFIG_FILE
  const log = fs.createWriteStream(logFile)
  const child = spawn(executable, ['--remote-debugging-port=0', '--no-sandbox', '--disable-gpu',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let endpoint, tail = '', failure
  const capture = data => {
    log.write(data)
    tail = (tail + data.toString()).slice(-12000)
    endpoint ||= /DevTools listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(tail)?.[1]
  }
  child.stdout.on('data', capture); child.stderr.on('data', capture)
  child.on('error', error => { failure = error })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  let browser
  const errors = [], fileFailures = [], result = { bossRequests: 0, sent: 0, marked: 0 }
  try {
    const deadline = Date.now() + 60000
    while (!endpoint && Date.now() < deadline && child.exitCode === null && !failure) await delay(100)
    assert.ok(endpoint, 'Installed GUI did not expose DevTools: ' + (failure?.message || tail))
    browser = await puppeteer.connect({ browserWSEndpoint: endpoint })
    let page
    while (Date.now() < deadline) {
      page = (await browser.pages()).find(item => item.url().startsWith('file:') && item.url().includes('/renderer/index.html'))
      if (page) break
      await delay(100)
    }
    assert.ok(page, 'Installed renderer did not load')
    page.on('pageerror', error => errors.push(error.message))
    page.on('requestfailed', request => { if (request.url().startsWith('file:')) fileFailures.push(request.url()) })
    await page.setRequestInterception(true)
    page.on('request', request => {
      const url = new URL(request.url())
      if (/(^|\.)zhipin\.com$/.test(url.hostname)) result.bossRequests++
      void (/^https?:$/.test(url.protocol) ? request.abort() : request.continue()).catch(() => {})
    })
    await page.waitForSelector('.ux-shell', { timeout: 60000 })
    assert.equal(await page.$eval('.ux-version-link', el => el.textContent.trim()), '版本：' + version)
    const data = await page.evaluate(async () => ({
      settings: await window.electron.ipcRenderer.invoke('get-update-settings'),
      rows: await window.electron.ipcRenderer.invoke('run-data-query-all', { dataset: 'jobLibrary' }),
      config: await window.electron.ipcRenderer.invoke('fetch-config-file-content')
    }))
    assert.equal(data.settings.autoCheck, false)
    assert.deepEqual(data.settings.ignoredVersions, ['0.22.1'])
    assert.equal(data.rows.error, undefined)
    assert.equal(data.rows.data.length, jobs)
    assert.ok(data.config.config['boss.json'])
    // Exercise a lazy-loaded data page and then a settings page through real navigation.
    await page.click('a[href="#/ux/library"]')
    await page.waitForSelector('.ux-main .el-table', { timeout: 30000 })
    await page.click('a[href="#/ux/settings"]')
    await page.waitForFunction(() => document.querySelector('.ux-main')?.textContent.includes('软件更新'), { timeout: 30000 })
    assert.deepEqual(errors, [], 'Renderer exceptions')
    assert.deepEqual(fileFailures, [], 'Packaged asset failures')
    assert.equal(result.bossRequests, 0)
    await page.close()
    const stopped = await Promise.race([exited, delay(20000).then(() => { throw Error('Installed GUI did not exit normally') })])
    assert.equal(stopped.code, 0); assert.equal(stopped.signal, null)
    return { ...result, success: true, version, jobs, rendererLoaded: true, lazyPages: true, normalExit: true }
  } finally {
    browser?.disconnect()
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
    await new Promise(resolve => log.end(resolve))
  }
}
