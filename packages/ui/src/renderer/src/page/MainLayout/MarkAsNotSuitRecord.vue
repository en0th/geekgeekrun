<template>
  <div class="page-wrap flex flex-col of-hidden">
    <RunDataTable
      dataset="markAsNotSuitLog"
      :columns="columns"
      :stats-preset="runDataStatsPresets.markAsNotSuitLog"
      gtag-prefix="mansr"
      class="flex-1"
    >
      <template #cell-markReason="{ row }">
        <strong>{{ markReasonLabel(row) }}</strong>
        <pre v-if="formatMarkReason(row)" class="m-0 of-auto">{{ formatMarkReason(row) }}</pre>
      </template>
      <template #actions="{ row }">
        <ElButton link type="primary" size="small" @click="handleViewJobSnapshotButtonClick(row)"
          >快照</ElButton
        >
        <ElButton
          link
          type="primary"
          size="small"
          @click="handleViewJobOnlineButtonClick(row.encryptJobId)"
          >线上</ElButton
        >
      </template>
    </RunDataTable>
    <ElDrawer v-model="drawVisibleModelValue" size="400px">
      <JobInfoSnapshot
        v-if="selectedJobInfoForViewSnapshot"
        :job-info="selectedJobInfoForViewSnapshot"
        scene="markAsNotSuitRecord"
        @closed="
          () => {
            gtagRenderer('mansr_closed')
            selectedJobInfoForViewSnapshot = null
          }
        "
      />
    </ElDrawer>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElButton, ElDrawer } from 'element-plus'
import { type VMarkAsNotSuitLog } from '@geekgeekrun/sqlite-plugin/src/entity/VMarkAsNotSuitLog'
import JobInfoSnapshot from '../../features/JobInfoSnapshot/index.vue'
import RunDataTable from '../../features/RunDataTable/index.vue'
import { runDataStatsPresets } from '../../features/RunDataTable/stats-presets'
import { enumLabel, formatSalary } from '../../features/RunDataTable/format'
import type { RunDataColumn } from '../../features/RunDataTable/types'
import { MarkAsNotSuitReason } from '@geekgeekrun/sqlite-plugin/src/enums'
import { getRunDataField } from '../../../../common/run-data'
import { gtagRenderer } from '@renderer/utils/gtag'

const markReasonField = getRunDataField('markAsNotSuitLog', 'markReason')!
const markReasonLabel = (row: VMarkAsNotSuitLog) => enumLabel(markReasonField, row.markReason)

const columns: RunDataColumn[] = [
  { key: 'companyName' },
  { key: 'jobName' },
  { key: 'positionName' },
  { key: 'date' },
  { key: 'bossName', minWidth: 100 },
  {
    key: 'markReason',
    minWidth: 250,
    // plain text for copy-to-clipboard; the cell itself uses the slot above
    formatter: (row) =>
      [markReasonLabel(row as VMarkAsNotSuitLog), formatMarkReason(row as VMarkAsNotSuitLog)]
        .filter(Boolean)
        .join(' ')
  },
  { key: 'experienceName' },
  { key: 'salary', label: '薪资', field: 'salaryLow', formatter: formatSalary, headerFilter: false }
]

async function handleViewJobOnlineButtonClick(encryptJobId: string) {
  gtagRenderer('view_job_online_button_clicked')
  return await electron.ipcRenderer.invoke('open-site-with-boss-cookie', {
    url: `https://www.zhipin.com/job_detail/${encryptJobId}.html`
  })
}

const drawVisibleModelValue = ref(false)
const selectedJobInfoForViewSnapshot = ref<VMarkAsNotSuitLog | null>(null)

function handleViewJobSnapshotButtonClick(record: VMarkAsNotSuitLog) {
  gtagRenderer('view_job_snapshot_button_clicked')
  selectedJobInfoForViewSnapshot.value = record
  drawVisibleModelValue.value = true
}

function parseExtInfo(row: VMarkAsNotSuitLog) {
  try {
    return JSON.parse(row.extInfo)
  } catch {
    return null
  }
}

function formatMarkReason(row: VMarkAsNotSuitLog) {
  const extInfo = parseExtInfo(row)
  const chosenReason =
    extInfo?.chosenReasonInUi?.text && `BOSS选项内容：${extInfo.chosenReasonInUi.text}`
  switch (row.markReason) {
    case MarkAsNotSuitReason.BOSS_INACTIVE:
      return [
        extInfo?.bossActiveTimeDesc && `BOSS活跃情况：${extInfo.bossActiveTimeDesc}`,
        chosenReason
      ]
        .filter(Boolean)
        .join('\n')
    case MarkAsNotSuitReason.JOB_SALARY_NOT_SUIT:
      return [extInfo?.salaryDesc && `薪资：${extInfo.salaryDesc}`, chosenReason]
        .filter(Boolean)
        .join('\n')
    case MarkAsNotSuitReason.USER_MANUAL_OPERATION_WITH_UNKNOWN_REASON:
    case MarkAsNotSuitReason.JOB_WORK_EXP_NOT_SUIT:
    case MarkAsNotSuitReason.JOB_CITY_NOT_SUIT:
    case MarkAsNotSuitReason.COMPANY_NAME_NOT_SUIT:
      return chosenReason || ''
    case MarkAsNotSuitReason.POSTER_TITLE_NOT_SUIT:
      return [
        extInfo?.posterTitle && `BOSS身份：${extInfo.posterTitle}`,
        extInfo?.posterHrTitleRegExpStr && `匹配规则：${extInfo.posterHrTitleRegExpStr}`,
        chosenReason
      ]
        .filter(Boolean)
        .join('\n')
    default:
      return ''
  }
}
</script>

<style scoped lang="scss">
.page-wrap {
  margin: 0 auto;
  max-width: 1400px;
  // let the table scroll horizontally instead of widening the page
  min-width: 0;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
  padding-left: 20px;
  padding-right: 20px;
  padding-top: 20px;
  :deep(.el-drawer) {
    .el-drawer__header {
      padding: 16px 20px;
      margin-bottom: 0;
    }
    .el-drawer__body {
      padding: 0;
      margin: 0 0 20px 20px;
      padding-right: 20px;
    }
  }
}
</style>
