import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../run-core-of-geek-auto-start-chat-with-boss/enums.mjs'

test('GUI and CLI stop once on access or search-scope failures without entering their restart loops', async () => {
  for (const file of ['../src/main/flow/GEEK_AUTO_START_CHAT_WITH_BOSS_MAIN/index.ts', '../../run-core-of-geek-auto-start-chat-with-boss/main.mjs']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    const start = source.indexOf('        if (/LOGIN_STATUS_')
    const end = source.indexOf('\n        if (err.message', start)
    const handler = source.slice(start, end).replace('(err as Error & { detail?: string }).detail', 'err.detail')
    for (const message of ['LOGIN_STATUS_RESTRICTED', 'LOGIN_STATUS_UNKNOWN', 'AUTO_CHAT_SEARCH_FILTER_NOT_APPLIED', 'AUTO_CHAT_JOB_PAGE_CLOSED']) {
      const calls = []
      const context = vm.createContext({ AUTO_CHAT_ERROR_EXIT_CODE,
        console: { error: detail => calls.push(['detail', detail]) },
        taskProgress: { update: (_, detail, state) => calls.push(['progress', detail, state]) },
        closeBrowserWindow: async () => calls.push(['close']),
        process: { exit: code => calls.push(['exit', code]) },
        err: Object.assign(Error(message), { detail: '已暂停，请检查搜索类目或BOSS访问状态后恢复' })
      })
      await vm.runInContext('(async () => {' + handler + '})()', context)
      assert.equal(calls.filter(call => call[0] === 'close').length, 1)
      assert.deepEqual(calls.at(-1), ['exit', 93])
      assert.ok(calls.some(call => call.includes('已暂停，请检查搜索类目或BOSS访问状态后恢复')))
    }
  }
})
