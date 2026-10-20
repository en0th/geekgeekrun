import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { isJsonStorageError } from '../../utils/atomic-json.mjs'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../run-core-of-geek-auto-start-chat-with-boss/enums.mjs'

test('follow-up login recovery preserves storage errors for the terminal handler', async () => {
  const source = fs.readFileSync(new URL('../src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts', import.meta.url), 'utf8')
  const cookieStart = source.indexOf("  let bossCookies = readStorageFile('boss-cookies.json')")
  const expiredStart = source.indexOf("  if (currentPageUrl.startsWith('https://www.zhipin.com/web/user/'))")
  const branches = [
    source.slice(cookieStart, source.indexOf('  const canNotConfirmIfHasReadMsgTemplateList', cookieStart)),
    source.slice(expiredStart, source.indexOf('\n  if (', expiredStart + 1))
  ]
  for (const [index, branch] of branches.entries()) {
    for (const code of ['GGR_FILE_READ_FAILED', 'GGR_FILE_WRITE_FAILED']) {
      const error = Object.assign(Error('fixture storage failure'), { code })
      const calls = []
      let reads = 0
      const context = vm.createContext({ isJsonStorageError,
        currentPageUrl: 'https://www.zhipin.com/web/user/', browser: null, runRecordId: 1,
        checkCookieListFormat: () => false,
        readStorageFile: () => { if (reads++) throw error; return [] },
        writeStorageFile: async () => calls.push('write'),
        loginWithCookieAssistant: async () => { calls.push('login'); if (index === 1) throw error },
        app: {}, sendToDaemon: () => calls.push('rejected'), console })
      await assert.rejects(vm.runInContext('(async()=>{' + branch + '})()', context), actual => actual === error)
      assert.equal(calls.filter(call => call === 'login').length, 1)
      assert.equal(calls.includes('rejected'), false)
    }
  }
})

test('GUI, CLI and follow-up tasks stop on storage failures without entering automatic retry', async () => {
  for (const file of ['../src/main/flow/GEEK_AUTO_START_CHAT_WITH_BOSS_MAIN/index.ts', '../../run-core-of-geek-auto-start-chat-with-boss/main.mjs', '../src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    const gui = file.includes('GEEK_AUTO_START_CHAT_WITH_BOSS_MAIN'), follow = file.includes('READ_NO_REPLY')
    const start = follow ? source.lastIndexOf('if (isJsonStorageError(err))')
      : source.indexOf(gui ? '  async function stopForStorage(' : 'if (isJsonStorageError(err))')
    const end = source.indexOf(gui ? '  async function stopForBudget(' : follow ? '      const shouldExit' : '        if (/AUTO_CHAT_RUN_BUDGET_', start)
    const body = source.slice(start, end) + (gui ? '\n await stopForStorage(err)' : '')
    const { code } = await transform('(async()=>{' + body + '})()', { loader: 'ts' })
    for (const errorCode of ['GGR_JSON_INVALID', 'GGR_FILE_READ_FAILED', 'GGR_FILE_WRITE_FAILED', 'GGR_DATA_LOCATION_INVALID']) {
      const calls = []
      const context = vm.createContext({ isJsonStorageError, AUTO_CHAT_ERROR_EXIT_CODE,
        err: Object.assign(Error('原文件已保留'), { code: errorCode }),
        taskProgress: { update: () => calls.push('progress') }, saveResume: () => calls.push('save'),
        closeBrowserWindow: async () => calls.push('close'), console: { error: () => calls.push('log') },
        app: { exit: code => calls.push(code) },
        process: { exit: code => calls.push(code) } })
      await vm.runInContext(code, context)
      assert.equal(calls.at(-1), 98)
      if (!follow) assert.deepEqual(calls.slice(-2), ['close', 98])
      if (gui) assert.ok(calls.indexOf('save') < calls.indexOf('close'))
    }
  }
  assert.equal(isJsonStorageError(Error('unrelated')), false)
  const core = fs.readFileSync(new URL('../../geek-auto-start-chat-with-boss/index.mjs', import.meta.url), 'utf8')
  const capture = core.slice(core.lastIndexOf('async function storeStorage (page)'))
  for (const fatal of [true, false]) {
    const warnings = []
    const context = vm.createContext({ isJsonStorageError,
      page: { cookies: async () => [{ name: 'n', value: 'v' }], evaluate: async () => '{"k":"v"}' },
      writeBossSession: async () => { throw Object.assign(Error('fixture failure'), { code: fatal ? 'GGR_FILE_WRITE_FAILED' : 'PAGE_CAPTURE_TEMPORARY' }) },
      console: { warn: message => warnings.push(message) } })
    const saving = vm.runInContext('(async()=>{' + capture + '; await storeStorage(page)})()', context)
    if (fatal) await assert.rejects(saving, error => error.code === 'GGR_FILE_WRITE_FAILED')
    else { await saving; assert.equal(warnings.length, 1) }
  }
})
