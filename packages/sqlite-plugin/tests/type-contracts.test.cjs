const test = require('node:test')
const assert = require('node:assert/strict')

let native = false
try {
  const Database = require('better-sqlite3')
  new Database(':memory:').close()
  native = true
} catch {}

test('nullable chat origins retain integer metadata and null/one values in both log tables', {
  skip: !native && 'Run with the project Electron runtime for native SQLite'
}, async () => {
  const Plugin = require('../dist/index.js').default
  const { ChatStartupFrom, ChatStartupLog } = require('../dist/entity/ChatStartupLog.js')
  const { MarkAsNotSuitLog } = require('../dist/entity/MarkAsNotSuitLog.js')
  assert.equal(ChatStartupFrom.AutoFromRecommendList, null)
  assert.equal(ChatStartupFrom.ManuallyFromRecommendList, 1)
  const plugin = new Plugin(':memory:')
  const ds = await plugin.initPromise
  ds.setOptions({ logging: false })
  try {
    for (const [Entity, field] of [[ChatStartupLog, 'chatStartupFrom'], [MarkAsNotSuitLog, 'markFrom']]) {
      assert.equal(ds.getMetadata(Entity).findColumnWithPropertyName(field).type, 'integer')
      const repository = ds.getRepository(Entity)
      for (const value of [ChatStartupFrom.AutoFromRecommendList, ChatStartupFrom.ManuallyFromRecommendList]) {
        const saved = await repository.save({ encryptJobId: 'fixture-' + value,
          encryptCurrentUserId: 'fixture-account', date: new Date(), [field]: value })
        assert.equal((await repository.findOneByOrFail({ id: saved.id }))[field], value)
      }
    }
  } finally { await ds.destroy() }
})
