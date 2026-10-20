const test = require('node:test')
const assert = require('node:assert/strict')
let Database
try { Database = require('better-sqlite3'); new Database(':memory:').close() } catch { Database = null }

test('history queries retain the UTC day boundary and use migrated account/date range indexes', {
  skip: !Database && 'Run with the project Electron runtime for native SQLite'
}, async () => {
  const { initDb } = require('../dist/index.js')
  const { getChatStartupRecordsInLastSomeDays, getNotSuitMarkRecordsInLastSomeDays } = require('../dist/handlers.js')
  const ds = await initDb(':memory:')
  ds.setOptions({ logging: false })
  try {
    const cutoff = new Date(Date.now() - 7 * 86400000); cutoff.setUTCHours(0, 0, 0, 0)
    const before = new Date(cutoff.getTime() - 1)
    const format = date => date.toISOString().replace('T', ' ').replace('Z', '')
    for (const table of ['chat_startup_log', 'mark_as_not_suit_log']) {
      for (const [job, account, date] of [['old', 'current', before], ['edge', 'current', cutoff],
        ['today', 'current', new Date()], ['other', 'other', new Date()]])
        await ds.query(`INSERT INTO ${table}(encryptJobId,encryptCurrentUserId,date) VALUES (?,?,?)`, [job, account, format(date)])
    }
    const queries = []
    ds.logger.logQuery = (sql, params) => queries.push({ sql, params })
    for (const query of [getChatStartupRecordsInLastSomeDays, getNotSuitMarkRecordsInLastSomeDays]) {
      assert.deepEqual((await query(ds, 7, 'current')).map(row => row.encryptJobId).sort(), ['edge', 'today'])
      assert.deepEqual(await query(ds, 7, ''), [])
    }
    assert.equal(queries.length, 2)
    const db = ds.driver.databaseConnection
    for (const { sql, params } of queries) {
      assert.doesNotMatch(sql, /DATE\(/i)
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params).map(row => row.detail).join('\n')
      assert.match(plan, /USING INDEX idx_(?:chat_startup|not_suit)_user_date/)
      assert.match(plan, /date>\?/)
    }
  } finally { await ds.destroy() }
})
