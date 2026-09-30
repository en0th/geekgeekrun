import 'reflect-metadata'
import { parentPort } from 'node:worker_threads'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { type DataSource } from 'typeorm'
import { getPublicDbFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { measureExecutionTime } from '../../../../../../common/utils/performance'
import { JobInfoChangeLog } from '@geekgeekrun/sqlite-plugin/dist/entity/JobInfoChangeLog'
import { AutoStartChatRunRecord } from '@geekgeekrun/sqlite-plugin/dist/entity/AutoStartChatRunRecord'
import * as runData from './run-data'

const dbInitPromise = initDb(getPublicDbFilePath())
let dataSource: DataSource | null = null

dbInitPromise.then(
  (_dataSource) => {
    dataSource = _dataSource
    attachMessageHandler()
    parentPort?.postMessage({
      type: 'DB_INIT_SUCCESS'
    })
  },
  (error) => {
    parentPort?.postMessage({
      type: 'DB_INIT_FAIL',
      error
    })
    process.exit(1)
  }
)

const payloadHandler = {
  async getJobHistoryByEncryptId({ encryptJobId }): Promise<JobInfoChangeLog[]> {
    const jobInfoChangeLogRepository = dataSource!.getRepository(JobInfoChangeLog)!
    const data = await measureExecutionTime(
      jobInfoChangeLogRepository.find({
        where: {
          encryptJobId
        }
      })
    )
    return data
  },
  async saveAndGetCurrentRunRecord() {
    const autoStartChatRunRecord = new AutoStartChatRunRecord()
    autoStartChatRunRecord.date = new Date()
    const autoStartChatRunRecordRepository = dataSource!.getRepository(AutoStartChatRunRecord)
    const result = await autoStartChatRunRecordRepository.save(autoStartChatRunRecord)
    return result
  },
  queryRunData: (payload) => runData.queryRunData(getRawDb(), payload),
  queryAllRunData: (payload) => runData.queryAllRunData(getRawDb(), payload),
  getRunDataDistinctValues: (payload) => runData.getRunDataDistinctValues(getRawDb(), payload),
  getRunDataStats: (payload) => runData.getRunDataStats(getRawDb(), payload),
  deleteRunData: (payload) => runData.deleteRunData(getRawDb(), payload),
  importRunData: (payload) => runData.importRunData(getRawDb(), payload)
}

function getRawDb(): runData.Db {
  // better-sqlite3 Database instance behind TypeORM
  return (dataSource!.driver as unknown as { databaseConnection: runData.Db }).databaseConnection
}

async function attachMessageHandler() {
  parentPort?.on('message', async (event) => {
    const { _uuid, ...restObj } = event
    const { type } = event

    if (!dataSource) {
      await dbInitPromise
    }
    try {
      const result = await payloadHandler[type](restObj)
      parentPort?.postMessage({
        _uuid,
        data: result
      })
    } catch (err) {
      parentPort?.postMessage({
        _uuid,
        error: (err as Error)?.message ?? String(err)
      })
    }
  })
}
