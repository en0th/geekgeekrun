import createDbWorker from './worker/index?nodeWorker&url'
import { type Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import type {
  RunDataDeleteReq,
  RunDataDistinctReq,
  RunDataImportReq,
  RunDataPageQuery,
  RunDataQuery,
  RunDataStatsReq
} from '../../../../../common/run-data'

let worker: Worker | null = null
let workerExitCode: number | null = null
export const initDbWorker = () => {
  if (!worker || typeof workerExitCode === 'number') {
    worker = createDbWorker()
    workerExitCode = null
    return new Promise((resolve, reject) => {
      worker!.once('exit', (exitCode) => {
        workerExitCode = exitCode
        worker = null
      })
      worker!.on('message', function handler(data) {
        if (data.type === 'DB_INIT_SUCCESS') {
          resolve(worker)
          // attach more event
          worker?.off('message', handler)
        } else if (data.type === 'DB_INIT_FAIL') {
          reject(data.error)
          worker?.terminate()
          worker?.off('message', handler)
          worker = null
        }
      })
    })
  } else {
    return worker
  }
}

const createWorkerPromise = async (data) => {
  await initDbWorker()
  const uuid = randomUUID()
  worker!.postMessage({
    _uuid: uuid,
    ...data
  })
  return new Promise((resolve) => {
    worker!.on('message', function handler(data) {
      const { _uuid, ...payload } = data ?? {}
      if (_uuid === uuid) {
        resolve(payload)
        worker?.off('message', handler)
      }
    })
  })
}

export const getJobHistoryByEncryptId = async (encryptJobId) => {
  const res = await createWorkerPromise({
    type: 'getJobHistoryByEncryptId',
    encryptJobId
  })
  return res
}

export const saveAndGetCurrentRunRecord = async () => {
  const res = await createWorkerPromise({
    type: 'saveAndGetCurrentRunRecord'
  })
  return res
}

// run-data handlers reject when the worker reports an error, so ipcRenderer.invoke rejects too
const runDataWorkerCall = async (type: string, payload: object) => {
  const res = (await createWorkerPromise({ ...payload, type })) as {
    data?: unknown
    error?: string
  }
  if (res.error) {
    throw new Error(res.error)
  }
  return res
}

export const queryRunData = (payload: RunDataPageQuery) =>
  runDataWorkerCall('queryRunData', payload)

export const queryAllRunData = (payload: RunDataQuery) =>
  runDataWorkerCall('queryAllRunData', payload)

export const getRunDataDistinctValues = (payload: RunDataDistinctReq) =>
  runDataWorkerCall('getRunDataDistinctValues', payload)

export const getRunDataStats = (payload: RunDataStatsReq) =>
  runDataWorkerCall('getRunDataStats', payload)

export const deleteRunData = (payload: RunDataDeleteReq) =>
  runDataWorkerCall('deleteRunData', payload)

export const importRunData = (payload: RunDataImportReq) =>
  runDataWorkerCall('importRunData', payload)
