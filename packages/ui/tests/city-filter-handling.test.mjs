import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../run-core-of-geek-auto-start-chat-with-boss/enums.mjs'

test('city verification failures stop each worker once and preserve the run for recovery', async () => {
  for (const file of ['../src/main/flow/GEEK_AUTO_START_CHAT_WITH_BOSS_MAIN/index.ts', '../../run-core-of-geek-auto-start-chat-with-boss/main.mjs']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    const start = source.indexOf("        if (err.message.includes('AUTO_CHAT_CITY_FILTER_NOT_APPLIED'))")
    const end = source.indexOf('        if (/LOGIN_STATUS_', start)
    const body = source.slice(start, end).replace('(err as Error & { detail?: string }).detail', 'err.detail')
    const calls = []
    const ctx = vm.createContext({ AUTO_CHAT_ERROR_EXIT_CODE, console: { error: detail => calls.push(['error', detail]) },
      taskProgress: { update: (count, detail, status) => calls.push(['progress', detail, status]) },
      closeBrowserWindow: async () => calls.push(['close']), process: { exit: code => calls.push(['exit', code]) },
      err: Object.assign(new Error('AUTO_CHAT_CITY_FILTER_NOT_APPLIED'), { detail: '城市筛选未确认' }) })
    await vm.runInContext('(async function () {' + body + '})()', ctx)
    assert.equal(calls.filter(call => call[0] === 'close').length, 1)
    assert.deepEqual(calls.at(-1), ['exit', 95])
    assert.ok(calls.some(call => call.includes('城市筛选未确认')))
  }
})

test('CLI ends after the last source instead of restarting a fresh combination budget', async () => {
  const source = fs.readFileSync(new URL('../../run-core-of-geek-auto-start-chat-with-boss/main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("        if (err.message.includes('AUTO_CHAT_ALL_SOURCES_ROTATED'))")
  const end = source.indexOf("        if (err.message.includes('AUTO_CHAT_CITY_FILTER_NOT_APPLIED'))", start)
  const calls = []
  const ctx = vm.createContext({ AUTO_CHAT_ERROR_EXIT_CODE, console: { log() {} },
    closeBrowserWindow: async () => calls.push('close'), process: { exit: code => calls.push(code) },
    err: new Error('AUTO_CHAT_ALL_SOURCES_ROTATED') })
  await vm.runInContext('(async function () {' + source.slice(start, end) + '})()', ctx)
  assert.deepEqual(calls, ['close', 92])
})
