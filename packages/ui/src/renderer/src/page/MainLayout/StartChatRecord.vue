<template>
  <div class="page-wrap flex flex-col of-hidden">
    <RunDataTable
      dataset="chatStartupLog"
      :columns="columns"
      :stats-preset="runDataStatsPresets.chatStartupLog"
      gtag-prefix="start_chat_record"
      :actions-width="180"
      class="flex-1"
    >
      <template #actions="{ row }">
        <ElButton link type="primary" size="small" @click="handleViewJobSnapshotButtonClick(row)"
          >当时详情</ElButton
        >
        <ElButton
          link
          type="primary"
          size="small"
          @click="handleViewJobOnlineButtonClick(row.encryptJobId)"
          >在BOSS查看</ElButton
        >
      </template>
    </RunDataTable>
    <ElDrawer v-model="drawVisibleModelValue" title="当时详情" size="400px">
      <JobInfoSnapshot
        v-if="selectedJobInfoForViewSnapshot"
        :job-info="selectedJobInfoForViewSnapshot"
        scene="startChatRecord"
        @closed="
          () => {
            gtagRenderer('start_chat_record_closed')
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
import { type VChatStartupLog } from '@geekgeekrun/sqlite-plugin/src/entity/VChatStartupLog'
import JobInfoSnapshot from '../../features/JobInfoSnapshot/index.vue'
import RunDataTable from '../../features/RunDataTable/index.vue'
import { runDataStatsPresets } from '../../features/RunDataTable/stats-presets'
import { formatSalary } from '../../features/RunDataTable/format'
import type { RunDataColumn } from '../../features/RunDataTable/types'
import { gtagRenderer } from '@renderer/utils/gtag'

const columns: RunDataColumn[] = [
  { key: 'companyName' },
  { key: 'jobName' },
  { key: 'positionName' },
  { key: 'date' },
  { key: 'experienceName' },
  {
    key: 'salary',
    label: '薪资',
    field: 'salaryLow',
    formatter: formatSalary,
    headerFilter: false
  },
  { key: 'bossName' },
  { key: 'bossTitle' }
]

async function handleViewJobOnlineButtonClick(encryptJobId: string) {
  return await electron.ipcRenderer.invoke('open-site-with-boss-cookie', {
    url: `https://www.zhipin.com/job_detail/${encryptJobId}.html`
  })
}

const drawVisibleModelValue = ref(false)
const selectedJobInfoForViewSnapshot = ref<VChatStartupLog | null>(null)

function handleViewJobSnapshotButtonClick(record: VChatStartupLog) {
  selectedJobInfoForViewSnapshot.value = record
  drawVisibleModelValue.value = true
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
