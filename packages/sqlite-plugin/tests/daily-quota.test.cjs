const test = require('node:test')
const assert = require('node:assert/strict')
let Database
try { Database = require('better-sqlite3'); new Database(':memory:').close() } catch { Database = null }

test('daily calibration counts only automatic chats by account within the Beijing day', {
  skip: !Database && 'Run with the project Electron runtime for native SQLite'
}, async () => {
  const { default: SqlitePlugin } = require('../dist/index.js')
  const callbacks = {}
  const hook = name => ({ tap(_name, fn) { callbacks[name] = fn }, tapPromise(_name, fn) { callbacks[name] = fn } })
  const hooks = new Proxy({}, { get: (_target, name) => hook(name) })
  const plugin = new SqlitePlugin(':memory:')
  const ds = await plugin.initPromise; ds.setOptions({ logging: false })
  try {
    plugin.apply(hooks)
    for (const [job, account, date, manual] of [
      ['before', 'a', '2026-10-25 15:59:59.999', null], ['edge', 'a', '2026-10-25 16:00:00.000', null],
      ['last', 'a', '2026-10-26 15:59:59.999', null], ['after', 'a', '2026-10-26 16:00:00.000', null],
      ['other', 'b', '2026-10-26 10:00:00.000', null], ['manual', 'a', '2026-10-26 10:00:00.000', 1]
    ]) await ds.query('INSERT INTO chat_startup_log(encryptJobId,encryptCurrentUserId,date,chatStartupFrom) VALUES(?,?,?,?)', [job, account, date, manual])
    assert.equal(await callbacks.dailyQuotaSeed(0, { accountId: 'a', day: '2026-10-26' }), 2)
    assert.equal(await callbacks.dailyQuotaSeed(5, { accountId: 'a', day: '2026-10-26' }), 5)
    assert.equal(await callbacks.dailyQuotaSeed(0, { accountId: 'b', day: '2026-10-26' }), 1)
  } finally { await ds.destroy() }
})
