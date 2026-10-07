import { defineStore } from 'pinia'
import { NewReleaseInfo } from '../../../common/types/update'
import { ref } from 'vue'
import { throttle } from 'lodash'

export const useUpdateStore = defineStore('update', () => {
  const availableNewRelease = ref<NewReleaseInfo | null>(null)

  async function checkUpdate() {
    let result: NewReleaseInfo | null = null
    try {
      result = (await electron.ipcRenderer.invoke('check-update')) as NewReleaseInfo | null
    } catch {
      //
    }
    availableNewRelease.value = result
  }
  checkUpdate()
  setInterval(checkUpdate, 30 * 30 * 1000)
  return { availableNewRelease }
})

export interface QueuedTask {
  workerId: string
  position: number
  queuedAt: number
  // 'yielded' when a long task handed its turn to another one and waits to continue
  reason?: string
}

export interface TaskHistoryEntry {
  id: string
  workerId: string
  startedAt: number
  endedAt: number
  outcome: string
  code: number | null
  runRecordId?: number | null
  // auto greeting only: 'chat' | 'collect'
  runMode?: string | null
}

export const useTaskManagerStore = defineStore('taskManager', () => {
  const runningTasks = ref<unknown[]>([])
  // BOSS tasks run one at a time; the rest wait here in order
  const taskQueue = ref<QueuedTask[]>([])
  const taskHistory = ref<TaskHistoryEntry[]>([])
  async function getRunningTasks() {
    const { ipcRenderer } = electron
    const res = await ipcRenderer.invoke('get-task-manager-list')
    runningTasks.value = res.workers ?? []
    taskQueue.value = res.queue ?? []
    taskHistory.value = res.history ?? []
  }
  const throttledGetRunningTasks = throttle(getRunningTasks, 2000)
  // Polling is throttled; start/stop guards must await a fresh daemon snapshot.
  setInterval(() => throttledGetRunningTasks()?.catch(() => {}), 2 * 1000)
  getRunningTasks().catch(() => {})
  return { runningTasks, taskQueue, taskHistory, getRunningTasks }
})

/** a request to open a data table with filters, e.g. from a task history row */
export interface RunDataJump {
  dataset: string
  // FilterRow shapes of the RunDataTable filter builder (dates as local Date objects)
  rows: { field: string; op: string; value?: unknown }[]
  label: string
  /** open a page instead of a dataset, e.g. the empty-state CTA "去配置找岗位" */
  page?: string
}

export const useRunDataJumpStore = defineStore('runDataJump', () => {
  const pending = ref<(RunDataJump & { at: number }) | null>(null)
  function jump(target: RunDataJump) {
    pending.value = { ...target, at: Date.now() }
  }
  /** the pending jump for this table, once */
  function take(dataset: string) {
    if (pending.value?.dataset !== dataset) return null
    const target = pending.value
    pending.value = null
    return target
  }
  return { pending, jump, take }
})
