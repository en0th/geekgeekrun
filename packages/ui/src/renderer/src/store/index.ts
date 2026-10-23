import { defineStore } from 'pinia'
import type { NewReleaseInfo, UpdateSettings } from '../../../common/types/update'
import { onScopeDispose, ref } from 'vue'
import { normalizeUpdateVersion, readUpdateSettings, UPDATE_CHECK_INTERVAL_MS } from '../../../common/update-settings.mjs'
import throttle from 'lodash/throttle'
import type { RunningTask } from '../../../common/types/task'

export const useUpdateStore = defineStore('update', () => {
  const availableNewRelease = ref<NewReleaseInfo | null>(null)
  const settings = ref<UpdateSettings>(readUpdateSettings(null))
  const ready = ref(false), checking = ref(false), saving = ref(false), error = ref('')
  const lastCheckedAt = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined
  let generation = 0, pendingSaves = 0, queuedCheck = false, disposed = false
  const message = (err: unknown) => String((err as Error)?.message || err)
    .replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

  function applySettings(next: unknown) {
    if (disposed) return
    const parsed = readUpdateSettings(next)
    if (ready.value && JSON.stringify(parsed) === JSON.stringify(settings.value)) return
    const start = !ready.value || (!settings.value.autoCheck && parsed.autoCheck)
    generation++
    settings.value = parsed
    ready.value = true
    if (!parsed.autoCheck) queuedCheck = false
    if (!parsed.autoCheck || parsed.ignoredVersions.includes(availableNewRelease.value?.releaseVersion || ''))
      availableNewRelease.value = null
    clearInterval(timer)
    timer = parsed.autoCheck ? setInterval(() => void checkUpdate(), UPDATE_CHECK_INTERVAL_MS) : undefined
    if (start && parsed.autoCheck) void checkUpdate()
  }

  async function checkUpdate(manual = false): Promise<NewReleaseInfo | null | undefined> {
    if (disposed || !ready.value || (!manual && !settings.value.autoCheck)) return undefined
    if (checking.value) { if (!manual) queuedCheck = true; return undefined }
    const current = generation
    checking.value = true
    error.value = ''
    try {
      let result = await electron.ipcRenderer.invoke('check-update', { manual }) as NewReleaseInfo | null
      if (disposed || current !== generation) return undefined
      if (!manual && result && settings.value.ignoredVersions.includes(result.releaseVersion)) result = null
      availableNewRelease.value = result
      lastCheckedAt.value = Date.now()
      return result
    } catch (err) {
      if (!disposed && current === generation) error.value = message(err)
      if (manual) throw new Error(message(err))
      return undefined
    } finally {
      checking.value = false
      if (queuedCheck && !disposed && settings.value.autoCheck) {
        queuedCheck = false
        void checkUpdate()
      }
    }
  }

  async function loadSettings() {
    const current = generation
    try {
      const next = await electron.ipcRenderer.invoke('get-update-settings')
      if (!disposed && current === generation) {
        applySettings(next)
        error.value = ''
      }
    } catch (err) { if (!disposed && current === generation) error.value = message(err) }
  }

  async function save(channel: string, payload?: unknown) {
    const current = generation
    pendingSaves++
    saving.value = true
    try {
      const next = await electron.ipcRenderer.invoke(channel, payload)
      // The main process broadcasts committed settings before replying. A later
      // broadcast (possibly from another window) must win over this older reply.
      if (current === generation) applySettings(next)
      error.value = ''
    } catch (err) { error.value = message(err); throw new Error(error.value) }
    finally { saving.value = --pendingSaves > 0 }
  }
  async function setAutoCheck(enabled: boolean) {
    await save('set-update-auto-check', enabled)
  }
  async function ignoreVersion(version: string) {
    await save('ignore-update-version', version)
    const normalized = normalizeUpdateVersion(version)
    if (settings.value.ignoredVersions.includes(normalized)) {
      // A manual check may have surfaced a version already on the ignore list.
      generation++
      if (availableNewRelease.value?.releaseVersion === normalized) availableNewRelease.value = null
    }
  }
  async function restoreIgnoredVersions() {
    await save('restore-ignored-update-versions')
    if (settings.value.autoCheck) void checkUpdate()
  }
  const unlisten = electron.ipcRenderer.on('update-settings-changed', (_, next) => applySettings(next))
  onScopeDispose(() => { disposed = true; generation++; clearInterval(timer); unlisten() })
  void loadSettings()
  return { availableNewRelease, settings, ready, checking, saving, error, lastCheckedAt,
    checkUpdate, loadSettings, setAutoCheck, ignoreVersion, restoreIgnoredVersions }
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
  const ready = ref(false)
  const runningTasks = ref<RunningTask[]>([])
  // BOSS tasks run one at a time; the rest wait here in order
  const taskQueue = ref<QueuedTask[]>([])
  const taskHistory = ref<TaskHistoryEntry[]>([])
  async function getRunningTasks() {
    const { ipcRenderer } = electron
    try {
      const res = await ipcRenderer.invoke('get-task-manager-list')
      runningTasks.value = res.workers ?? []
      taskQueue.value = res.queue ?? []
      taskHistory.value = res.history ?? []
      ready.value = true
    } catch (error) {
      ready.value = false
      throw error
    }
  }
  const throttledGetRunningTasks = throttle(getRunningTasks, 2000)
  // Polling is throttled; start/stop guards must await a fresh daemon snapshot.
  setInterval(() => throttledGetRunningTasks()?.catch(() => {}), 2 * 1000)
  getRunningTasks().catch(() => {})
  return { ready, runningTasks, taskQueue, taskHistory, getRunningTasks }
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
