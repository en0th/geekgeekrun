<template>
  <div class="page-wrap favorite-jobs">
    <aside class="favorite-jobs__folders" aria-label="收藏夹">
      <div class="favorite-jobs__folders-head">
        <span>收藏夹</span>
        <ElButton link type="primary" size="small" :icon="Plus" @click="createFolder"
          >新建</ElButton
        >
      </div>
      <button
        type="button"
        class="favorite-jobs__folder"
        :class="{ 'is-active': selectedFolderId === null }"
        @click="selectedFolderId = null"
      >
        <span class="favorite-jobs__folder-name">全部收藏</span>
        <span class="favorite-jobs__folder-count">{{ totals.jobCount }}</span>
      </button>
      <div
        v-for="folder in folders"
        :key="folder.id"
        class="favorite-jobs__folder"
        :class="{ 'is-active': selectedFolderId === folder.id }"
        role="button"
        tabindex="0"
        @click="selectedFolderId = folder.id"
        @keydown.enter="selectedFolderId = folder.id"
      >
        <span class="favorite-jobs__folder-name" :title="folder.name">{{ folder.name }}</span>
        <span class="favorite-jobs__folder-count">
          {{ folder.jobCount }}
          <ElTag
            v-if="folder.closedCount"
            size="small"
            type="danger"
            effect="plain"
            :title="`${folder.closedCount} 个职位已关闭或删除`"
            >{{ folder.closedCount }} 关闭</ElTag
          >
        </span>
        <!-- the menu must not also select the folder -->
        <span @click.stop @keydown.enter.stop>
          <ElDropdown trigger="click" @command="(cmd) => handleFolderCommand(cmd, folder)">
            <ElButton link size="small" :icon="MoreFilled" aria-label="收藏夹操作" />
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem command="rename">重命名</ElDropdownItem>
                <ElDropdownItem command="delete" divided>删除收藏夹</ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </span>
      </div>
      <p v-if="!folders.length" class="favorite-jobs__empty">
        在职位库或求职记录中选中职位，点击“收藏到…”即可收藏。
      </p>

      <section class="favorite-jobs__poll" aria-label="职位状态检查">
        <div class="favorite-jobs__poll-head">
          <span>定时检查职位状态</span>
          <ElSwitch
            :model-value="pollSettings.enabled"
            size="small"
            :loading="savingPoll"
            aria-label="定时检查职位状态"
            @update:model-value="(v) => savePollSettings({ enabled: Boolean(v) })"
          />
        </div>
        <ElSelect
          :model-value="pollSettings.intervalHours"
          size="small"
          :disabled="!pollSettings.enabled || savingPoll"
          aria-label="检查间隔"
          @update:model-value="(v) => savePollSettings({ intervalHours: v })"
        >
          <ElOption
            v-for="hours in intervalOptions"
            :key="hours"
            :value="hours"
            :label="`每 ${hours} 小时检查一次`"
          />
        </ElSelect>
        <ElButton
          size="small"
          type="primary"
          plain
          :loading="startingPoll"
          :disabled="pollState !== 'idle'"
          @click="runPollNow"
          >{{
            pollState === 'running'
              ? '正在检查…'
              : pollState === 'queued'
                ? '排队等待中…'
                : '立即检查'
          }}</ElButton
        >
        <p class="favorite-jobs__poll-hint">{{ lastRunText }}</p>
        <p class="favorite-jobs__poll-hint">
          只检查收藏夹中仍在招聘或尚未检查过的职位。检查会打开浏览器逐个访问职位页，与其他任务排队执行。
        </p>
      </section>
    </aside>

    <RunDataTable
      :key="tableKey"
      dataset="favoriteJobs"
      :columns="columns"
      :stats-preset="runDataStatsPresets.favoriteJobs"
      :base-filters="baseFilters"
      gtag-prefix="favorite_jobs"
      :actions-width="100"
      class="favorite-jobs__table"
      @changed="loadFolders"
    >
      <template #cell-hireStatus="{ row }">
        <ElTag size="small" :type="hireStatusTag(row.hireStatus)" effect="plain">{{
          hireStatusText(row.hireStatus)
        }}</ElTag>
      </template>
      <template #actions="{ row }">
        <ElButton link type="primary" size="small" @click="openOnline(row.encryptJobId)"
          >在BOSS查看</ElButton
        >
      </template>
    </RunDataTable>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElSelect,
  ElSwitch,
  ElTag
} from 'element-plus'
import { MoreFilled, Plus } from '@element-plus/icons-vue'
import RunDataTable from '../../features/RunDataTable/index.vue'
import { runDataStatsPresets } from '../../features/RunDataTable/stats-presets'
import dayjs from 'dayjs'
import { formatSalary, ipcErrorMessage } from '../../features/RunDataTable/format'
import type { RunDataColumn } from '../../features/RunDataTable/types'
import { hireStatusOptions, type RunDataFilter } from '../../../../common/run-data'
import { useTaskManagerStore } from '../../store'

const JOB_STATUS_POLL_MODE = 'jobStatusPollMain'

interface FavoriteFolder {
  id: number
  name: string
  jobCount: number
  closedCount: number
  uncheckedCount: number
  lastCheckedAt: string | null
}
interface PollSettings {
  enabled: boolean
  intervalHours: number
}
interface PollLastRun {
  finishedAt: number
  total: number
  checked: number
  closed: number
  changed: number
  unknown: number
}

const columns: RunDataColumn[] = [
  { key: 'hireStatus', width: 90 },
  { key: 'companyName' },
  { key: 'jobName' },
  {
    key: 'salary',
    label: '薪资',
    field: 'salaryLow',
    formatter: formatSalary,
    headerFilter: false
  },
  { key: 'folderName' },
  { key: 'bossName' },
  { key: 'hireStatusCheckedAt' },
  { key: 'closedAt' },
  { key: 'favoritedAt' }
]

const hireStatusText = (v: number | null) =>
  hireStatusOptions.find((o) => o.value === (v ?? null))?.label ?? '未检查'
const hireStatusTag = (v: number | null) =>
  v === 1 ? 'success' : v === 2 || v === 3 ? 'danger' : 'info'

// ---------- folders ----------
const folders = ref<FavoriteFolder[]>([])
const selectedFolderId = ref<number | null>(null)
const tableKey = ref(0)
const totals = computed(() => ({
  jobCount: folders.value.reduce((n, f) => n + f.jobCount, 0)
}))
const baseFilters = computed<RunDataFilter[]>(() =>
  selectedFolderId.value === null
    ? []
    : [{ field: 'folderId', op: 'eq', value: selectedFolderId.value }]
)

async function loadFolders() {
  try {
    const { data } = (await electron.ipcRenderer.invoke('favorite-folders')) as {
      data: FavoriteFolder[]
    }
    folders.value = data
    if (selectedFolderId.value !== null && !data.some((f) => f.id === selectedFolderId.value))
      selectedFolderId.value = null
  } catch (err) {
    ElMessage.error(`读取收藏夹失败：${ipcErrorMessage(err)}`)
  }
}

async function askFolderName(title: string, initial = '') {
  try {
    const { value } = await ElMessageBox.prompt('收藏夹名称（最多 30 个字）', title, {
      inputValue: initial,
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValidator: (v) => (v?.trim() && v.trim().length <= 30) || '请填写 1–30 个字的名称'
    })
    return value.trim()
  } catch {
    return null
  }
}

async function createFolder() {
  const name = await askFolderName('新建收藏夹')
  if (!name) return
  try {
    const { data } = (await electron.ipcRenderer.invoke('favorite-folder-create', { name })) as {
      data: { id: number }
    }
    await loadFolders()
    selectedFolderId.value = data.id
  } catch (err) {
    ElMessage.error(ipcErrorMessage(err))
  }
}

async function handleFolderCommand(command: string, folder: FavoriteFolder) {
  if (command === 'rename') {
    const name = await askFolderName('重命名收藏夹', folder.name)
    if (!name || name === folder.name) return
    try {
      await electron.ipcRenderer.invoke('favorite-folder-rename', { id: folder.id, name })
      await loadFolders()
      tableKey.value++
    } catch (err) {
      ElMessage.error(ipcErrorMessage(err))
    }
    return
  }
  try {
    await ElMessageBox.confirm(
      `删除收藏夹“${folder.name}”后，其中的 ${folder.jobCount} 个收藏会一并移除，职位本身仍保留在职位库中。`,
      '删除收藏夹',
      {
        type: 'warning',
        confirmButtonText: '删除',
        confirmButtonClass: 'el-button--danger',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  try {
    await electron.ipcRenderer.invoke('favorite-folder-delete', { id: folder.id })
    if (selectedFolderId.value === folder.id) selectedFolderId.value = null
    await loadFolders()
    tableKey.value++
  } catch (err) {
    ElMessage.error(ipcErrorMessage(err))
  }
}

async function openOnline(encryptJobId: string) {
  return await electron.ipcRenderer.invoke('open-site-with-boss-cookie', {
    url: `https://www.zhipin.com/job_detail/${encryptJobId}.html`
  })
}

// ---------- status polling ----------
const pollSettings = ref<PollSettings>({ enabled: true, intervalHours: 6 })
const intervalOptions = ref<number[]>([])
const lastRun = ref<PollLastRun | null>(null)
const savingPoll = ref(false)
const startingPoll = ref(false)

async function loadPollInfo() {
  try {
    const info = (await electron.ipcRenderer.invoke('job-status-poll-info')) as {
      settings: PollSettings
      intervalOptions: number[]
      lastRun: PollLastRun | null
    }
    pollSettings.value = info.settings
    intervalOptions.value = info.intervalOptions
    lastRun.value = info.lastRun
  } catch (err) {
    ElMessage.error(`读取检查设置失败：${ipcErrorMessage(err)}`)
  }
}

async function savePollSettings(patch: Partial<PollSettings>) {
  savingPoll.value = true
  try {
    pollSettings.value = (await electron.ipcRenderer.invoke('job-status-poll-save-settings', {
      ...pollSettings.value,
      ...patch
    })) as PollSettings
  } catch (err) {
    ElMessage.error(`保存失败：${ipcErrorMessage(err)}`)
  } finally {
    savingPoll.value = false
  }
}

const taskStore = useTaskManagerStore()
const pollState = computed<'idle' | 'running' | 'queued'>(() =>
  (taskStore.runningTasks as { workerId: string }[]).some(
    (t) => t.workerId === JOB_STATUS_POLL_MODE
  )
    ? 'running'
    : taskStore.taskQueue.some((t) => t.workerId === JOB_STATUS_POLL_MODE)
      ? 'queued'
      : 'idle'
)
// a finished round changes statuses and counts: reload what is shown
watch(pollState, (state, previous) => {
  if (state === 'idle' && previous !== 'idle') {
    loadFolders()
    loadPollInfo()
    tableKey.value++
  }
})

async function runPollNow() {
  startingPoll.value = true
  try {
    const result = (await electron.ipcRenderer.invoke('run-job-status-poll')) as {
      queued?: boolean
      queuePosition?: number
      isAlreadyRunning?: boolean
    }
    ElMessage.success(
      result.isAlreadyRunning
        ? '检查任务已在运行或排队中'
        : result.queued
          ? `其他任务运行中，检查已排队（第 ${result.queuePosition} 位），会优先执行`
          : '已开始检查收藏的职位'
    )
    await taskStore.getRunningTasks()
  } catch (err) {
    ElMessage.error(`启动检查失败：${ipcErrorMessage(err)}`)
  } finally {
    startingPoll.value = false
  }
}

const lastRunText = computed(() => {
  const run = lastRun.value
  if (!run) return '尚未检查过。'
  const when = dayjs(run.finishedAt).format('YYYY-MM-DD HH:mm')
  if (!run.total) return `上次检查：${when}，没有需要检查的职位。`
  return (
    `上次检查：${when}，检查 ${run.checked} 个，${run.closed} 个已关闭或删除` +
    (run.unknown ? `，${run.unknown} 个无法确认` : '') +
    '。'
  )
})

loadFolders()
loadPollInfo()
const refreshTimer = setInterval(loadPollInfo, 60 * 1000)
onBeforeUnmount(() => clearInterval(refreshTimer))
</script>

<style scoped lang="scss">
.page-wrap {
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
  padding: 20px 20px 0;
}
.favorite-jobs {
  display: flex;
  gap: 16px;
}
.favorite-jobs__folders {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
  padding-bottom: 12px;
}
.favorite-jobs__folders-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  padding: 0 4px 6px;
}
.favorite-jobs__folder {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  &:hover,
  &:focus-visible {
    background: var(--el-fill-color-light);
  }
  &.is-active {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-weight: 600;
  }
}
.favorite-jobs__folder-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.favorite-jobs__folder-count {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
.favorite-jobs__empty,
.favorite-jobs__poll-hint {
  margin: 4px 4px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.favorite-jobs__poll {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding: 12px 4px 0;
  border-top: 1px solid var(--el-border-color-lighter);
  .el-button {
    margin-left: 0;
  }
}
.favorite-jobs__poll-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
}
.favorite-jobs__table {
  flex: 1;
  min-width: 0;
}
</style>
