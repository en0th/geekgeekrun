import 'reflect-metadata'
import { parentPort } from 'node:worker_threads'
import { initDb } from '@geekgeekrun/sqlite-plugin'
import { type DataSource } from 'typeorm'
import { getPublicDbFilePath } from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { measureExecutionTime } from '../../../../../../common/utils/performance'
import { JobInfoChangeLog } from '@geekgeekrun/sqlite-plugin/dist/entity/JobInfoChangeLog'
import { AutoStartChatRunRecord } from '@geekgeekrun/sqlite-plugin/dist/entity/AutoStartChatRunRecord'
import * as runData from './run-data'
import * as favorites from './favorites'
import * as backup from './backup'
import { refreshTaskRuns } from './task-runs'
import { refreshClientRows } from './client-rows'
import { runDataDatasets } from '../../../../../../common/run-data'

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
  queryRunData: (payload) => runData.queryRunData(withTaskRuns(payload), payload),
  queryAllRunData: (payload) => runData.queryAllRunData(withTaskRuns(payload), payload),
  getRunDataDistinctValues: (payload) =>
    runData.getRunDataDistinctValues(withTaskRuns(payload), payload),
  getRunDataStats: (payload) => runData.getRunDataStats(withTaskRuns(payload), payload),
  deleteRunData: (payload) => runData.deleteRunData(getRawDb(), payload),
  importRunData: (payload) => runData.importRunData(getRawDb(), payload),
  listFavoriteFolders: () => favorites.listFavoriteFolders(getRawDb()),
  createFavoriteFolder: (payload) => favorites.createFavoriteFolder(getRawDb(), payload),
  renameFavoriteFolder: (payload) => favorites.renameFavoriteFolder(getRawDb(), payload),
  deleteFavoriteFolder: (payload) => favorites.deleteFavoriteFolder(getRawDb(), payload),
  addFavoriteJobs: (payload) => favorites.addFavoriteJobs(getRawDb(), payload),
  countJobStatusPollTargets: () => favorites.countJobStatusPollTargets(getRawDb()),
  backupDatabase: (payload) =>
    backup.backupDatabase(getRawDb() as unknown as backup.BackupDb, payload),
  copyDatabase: (payload) => backup.copyDatabase(getRawDb() as unknown as backup.BackupDb, payload)
}

// 任务列表 rows come from the daemon's state that the main process sends along
function withTaskRuns(payload): runData.Db {
  const db = getRawDb()
  if (payload?.dataset === 'taskRuns') refreshTaskRuns(db, payload.context)
  const def = runDataDatasets[payload?.dataset]
  if (def?.clientRows) refreshClientRows(db, def, payload.context?.rows)
  return db
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
