<template>
  <div class="page-wrap flex flex-col of-hidden">
    <RunDataTable
      dataset="bossLibrary"
      :columns="columns"
      :stats-preset="runDataStatsPresets.bossLibrary"
      :actions-width="220"
      class="flex-1"
    >
      <template #cell-bossUrl="{ row }">
        <a
          v-if="row.bossUrl"
          class="boss-link"
          :href="row.bossUrl"
          :title="`在BOSS中打开：${row.latestJobName ?? row.bossUrl}`"
          @click.prevent="openOnline(row)"
          >{{ row.bossUrl }}</a
        >
        <span v-else class="boss-link--empty">没有已保存的职位</span>
      </template>
      <template #actions="{ row }">
        <ElButton link type="primary" size="small" :disabled="!row.bossUrl" @click="openOnline(row)"
          >在BOSS查看</ElButton
        >
        <ElButton link type="primary" size="small" :disabled="!row.bossUrl" @click="copyLink(row)"
          >复制链接</ElButton
        >
        <ElButton link type="primary" size="small" :disabled="!row.jobCount" @click="showJobs(row)"
          >全部职位</ElButton
        >
      </template>
    </RunDataTable>
  </div>
</template>

<script setup lang="ts">
import { ElButton } from 'element-plus'
import { toast } from '@renderer/features/Toast'
import RunDataTable from '../../features/RunDataTable/index.vue'
import { runDataStatsPresets } from '../../features/RunDataTable/stats-presets'
import type { RunDataColumn, RunDataRow } from '../../features/RunDataTable/types'
import { useRunDataJumpStore } from '../../store'

const columns: RunDataColumn[] = [
  { key: 'companyName' },
  { key: 'name' },
  { key: 'title' },
  { key: 'latestJobName', minWidth: 160 },
  { key: 'jobCount', width: 80 },
  { key: 'lastActiveStatus', width: 100 },
  { key: 'lastChatAt', minWidth: 150 },
  { key: 'bossUrl', minWidth: 220, headerFilter: false }
]

// BOSS has no recruiter profile page for job seekers: the access link is the recruiter's most
// recently saved job, where 立即沟通 reaches them
function openOnline(row: RunDataRow) {
  return electron.ipcRenderer.invoke('open-site-with-boss-cookie', { url: row.bossUrl })
}
async function copyLink(row: RunDataRow) {
  try {
    await navigator.clipboard.writeText(row.bossUrl)
    toast.success(`已复制${row.name ?? '招聘者'}的访问链接`)
  } catch (err) {
    toast.error(`复制失败：${(err as Error)?.message ?? err}`)
  }
}
const jumpStore = useRunDataJumpStore()
function showJobs(row: RunDataRow) {
  jumpStore.jump({
    dataset: 'jobLibrary',
    rows: [{ field: 'encryptBossId', op: 'eq', value: row.encryptBossId }],
    label: `${row.name ?? '招聘者'}${row.companyName ? `（${row.companyName}）` : ''}的职位`
  })
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
}
.boss-link {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-color-primary);
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
}
.boss-link--empty {
  color: var(--el-text-color-placeholder);
}
</style>
