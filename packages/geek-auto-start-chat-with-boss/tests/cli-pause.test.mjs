import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../run-core-of-geek-auto-start-chat-with-boss/enums.mjs'

test('the shipped CLI stops on verification and page/collection guards while leaving unknown errors to existing retry logic', async () => {
  const source = fs.readFileSync(new URL('../../run-core-of-geek-auto-start-chat-with-boss/main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('      if (err instanceof Error) {')
  const end = source.indexOf('      closeBrowserWindow?.()', start)
  assert.ok(start > 0 && end > start)
  for (const [message, expected] of [
    ['AUTO_CHAT_SECURITY_CHECK', 93], ['AUTO_CHAT_LIST_STALLED', 89], ['AUTO_CHAT_DETAIL_NOT_READY', 89],
    ['AUTO_CHAT_NO_USABLE_SOURCE', 89], ['AUTO_CHAT_NO_MATCH_BATCH_LIMIT', 88], ['AUTO_CHAT_COLLECT_MODE_CHAT_BLOCKED', 89],
    ['AUTO_CHAT_UNMATCHED_JOB_CHAT_BLOCKED', 89], ['AUTO_CHAT_REQUIRED_CONDITION_CHAT_BLOCKED', 89], ['unexpected internal error', null],
  ]) {
    const calls = [], context = { Error, err: Error(message), AUTO_CHAT_ERROR_EXIT_CODE, isJsonStorageError: () => false,
      console: { error() {} }, closeBrowserWindow: async () => calls.push('close'), process: { exit: value => calls.push(value) },
      retries: 0,
    }
    const code = '(async () => { while (true) {' + source.slice(start, end) + ' retries++; break } })()'
    await vm.runInNewContext(code, context)
    assert.equal(context.retries, expected === null ? 1 : 0)
    assert.deepEqual(calls, expected === null ? [] : ['close', expected])
  }
})
