<template>
  <div class="flex flex-col of-hidden" :class="embedded ? 'embedded-wrap' : 'page-wrap'">
    <RunDataTable
      ref="tableRef"
      dataset="jobLibrary"
      :columns="shownColumns"
      :base-filters="baseFilters"
      :memory-key="memoryKey"
      :ignore-jumps="ignoreJumps"
      :stats-preset="runDataStatsPresets.jobLibrary"
      :actions-width="300"
      :empty-text="embedded ? undefined : '运行找岗位后，查看过的岗位会收集在这里'"
      :empty-action="embedded ? undefined : { label: '去配置找岗位', page: 'auto' }"
      class="flex-1"
    >
      <template #actions="{ row }">
        <ElButton
          link
          :type="row.chattedAt ? 'info' : 'success'"
          size="small"
          :loading="greetingJobId === row.encryptJobId"
          :disabled="!!greetingJobId && greetingJobId !== row.encryptJobId"
          :title="row.chattedAt ? '已开聊，可再次打开继续沟通' : '在BOSS中向这个职位的招聘者打招呼'"
          @click="handleGreetButtonClick(row)"
          >{{ row.chattedAt ? '已开聊' : '打招呼' }}</ElButton
        >
        <ElButton link type="primary" size="small" @click="handleViewJobSnapshotButtonClick(row)"
          >已保存详情</ElButton
        >
        <ElButton link type="primary" size="small" @click="handleViewJobHistoryButtonClick(row)"
          >历史变化</ElButton
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
    <ElDrawer v-model="drawVisibleModelValue" title="已保存详情" size="400px" append-to-body>
      <JobInfoSnapshot
        v-if="selectedJobInfoForViewSnapshot"
        :job-info="selectedJobInfoForViewSnapshot"
        scene="jobLibrary"
        @closed="
          () => {
            selectedJobInfoForViewSnapshot = null
          }
        "
      />
    </ElDrawer>
    <ElDialog
      v-model="historyDialogVisibleModelValue"
      append-to-body
      title="历史变化"
      width="100%"
      :style="{
        margin: 0,
        height: 'fit-content',
        minHeight: '100%'
      }"
    >
      <JobInfoHistoryList
        v-if="selectedJobInfoForViewHistory"
        :job-info="selectedJobInfoForViewHistory"
        :job-info-history-list="selectedJobHistory ?? []"
        @closed="
          () => {
            selectedJobInfoForViewHistory = null
            selectedJobHistory = null
          }
        "
      />
    </ElDialog>
  </div>
</template>

<script setup lang="ts">
import { toast } from '@renderer/features/Toast'
import { computed, ref } from 'vue'
import { ElButton, ElDrawer, ElDialog } from 'element-plus'
import { type VChatStartupLog } from '@geekgeekrun/sqlite-plugin/src/entity/VChatStartupLog'
import { type JobInfoChangeLog } from '@geekgeekrun/sqlite-plugin/src/entity/JobInfoChangeLog'
import JobInfoSnapshot from '../../features/JobInfoSnapshot/index.vue'
import JobInfoHistoryList from '../../features/JobInfoHistoryList/index.vue'
import RunDataTable from '../../features/RunDataTable/index.vue'
import { runDataStatsPresets } from '../../features/RunDataTable/stats-presets'
import { formatSalary } from '../../features/RunDataTable/format'
import type { RunDataColumn } from '../../features/RunDataTable/types'
import type { RunDataFilter } from '../../../../common/run-data'
import { greetJobManually, type GreetableJob } from '../../features/greet-job'

// shown inside another view (任务详情 → 本次数据): limited to some rows, with its own
// remembered conditions, not reacting to 资料库 jumps, and without the page frame
const props = defineProps<{
  baseFilters?: RunDataFilter[]
  memoryKey?: string
  ignoreJumps?: boolean
  embedded?: boolean
  // extra columns to show, e.g. the time the rows were limited by
  extraColumns?: RunDataColumn[]
}>()
const columns: RunDataColumn[] = [
  { key: 'companyName' },
  { key: 'jobName' },
  { key: 'positionName' },
  { key: 'experienceName' },
  {
    key: 'salary',
    label: '薪资',
    field: 'salaryLow',
    formatter: formatSalary,
    headerFilter: false
  },
  { key: 'bossName' },
  { key: 'bossTitle' },
  { key: 'chattedAt', minWidth: 150 }
]
const shownColumns = computed(() => [...columns, ...(props.extraColumns ?? [])])

const tableRef = ref<{ refresh: () => void }>()
const greetingJobId = ref<string | null>(null)
async function handleGreetButtonClick(row: GreetableJob) {
  if (greetingJobId.value) return
  greetingJobId.value = row.encryptJobId
  try {
    if (await greetJobManually(row)) tableRef.value?.refresh()
  } finally {
    greetingJobId.value = null
  }
}

const drawVisibleModelValue = ref(false)
const selectedJobInfoForViewSnapshot = ref<VChatStartupLog | null>(null)

function handleViewJobSnapshotButtonClick(record: VChatStartupLog) {
  selectedJobInfoForViewSnapshot.value = record
  drawVisibleModelValue.value = true
}
async function handleViewJobOnlineButtonClick(encryptJobId: string) {
  return await electron.ipcRenderer.invoke('open-site-with-boss-cookie', {
    url: `https://www.zhipin.com/job_detail/${encryptJobId}.html`
  })
}

const historyDialogVisibleModelValue = ref(false)
const selectedJobInfoForViewHistory = ref<VChatStartupLog | null>(null)
const selectedJobHistory = ref<null | JobInfoChangeLog[]>(null)
async function handleViewJobHistoryButtonClick(record: VChatStartupLog) {
  let historyResponse
  try {
    historyResponse = await electron.ipcRenderer.invoke(
      'get-job-history-by-encrypt-id',
      record.encryptJobId
    )
  } catch {
    toast.error('读取历史变化失败，请稍后重试。')
    return
  }
  let { data: historyList } = historyResponse

  historyList = historyList.map((it) => ({
    ...it,
    ...(() => {
      try {
        return JSON.parse(it.dataAsJson)
      } catch {
        return {}
      }
    })(),
    __ggr_updateTime: it.updateTime
  }))

  // const { data: historyList } = await Promise.resolve({
  //   data: [
  //     {
  //       id: 569,
  //       encryptJobId: 'f0bf76bbd1d8dcf71Hxz2du8EFFY',
  //       updateTime: '2024-10-04T00:12:20.941Z',
  //       dataAsJson:
  //         '{"encryptId":"f0bf76bbd1d8dcf71Hxz2du8EFFY","encryptUserId":"cf615f0b2a5db54a1Xxz2N26Fls~","invalidStatus":false,"jobName":"前端工程师","position":100901,"positionName":"前端开发工程师","location":101010100,"locationName":"工人体育场","experienceName":"1-3年","degreeName":"本科","jobType":0,"proxyJob":0,"proxyType":0,"salaryDesc":"25-40K","payTypeDesc":null,"postDescription":"熟练使用HTML,CSS，JAVASCRIPT;\\n熟练使用NPM或Yarn包管理工具；\\n掌握Sass，PostCss，Less，Stylus进行CSS预处理；\\n熟练使用VITE或Webpack打包工具；\\n精通使用Vue 3.0 、element-PLUS等主流前端框架，熟练使用Vue状态管理，路由配置，vue-loader预处理，组件自定义；\\n熟练使用axios网络组件，掌握使用Cookies，以及网络请求前端加解密技术；\\n熟练掌握前端组件化开发，前端开发框架搭建；\\n掌握前端缓存技术；\\n了解前端优化技巧，并且根据实际情况进行前端框架优化；\\n了解常见前端攻击方式以及预防方法；\\n熟练掌握echarts图表组件，能够对大数据量多图表页面进行性能优化；","encryptAddressId":"6914d969b01eafe21nd409S7FVFSxIm9Wfqf","address":"北京海淀区中软大厦.","longitude":116.334251,"latitude":39.958087,"staticMapUrl":"https://img.bosszhipin.com/beijin/upload/amap_proxy/20230428/48ba41acc9cef1bf3f3c8ba446b40b7757c453bede60b22f6bb61e3b7bce0931da574d19d1d82c88.jpg","pcStaticMapUrl":"https://img.bosszhipin.com/beijin/upload/amap_proxy/20230608/48ba41acc9cef1bf03ae3ae84352bc0cfa3e4b77ee71ca986bb61e3b7bce0931da574d19d1d82c88.jpg","overseasAddressList":[],"overseasInfo":null,"showSkills":["JavaScript","Vue"],"anonymous":0,"jobStatusDesc":"最新"}'
  //     },
  //     {
  //       id: 570,
  //       encryptJobId: 'f0bf76bbd1d8dcf71Hxz2du8EFFY',
  //       updateTime: '2024-10-04T00:12:21.941Z',
  //       dataAsJson:
  //         '{"encryptId":"f0bf76bbd1d8dcf71Hxz2du8EFFY","encryptUserId":"cf615f0b2a5db54a1Xxz2N26Fls~","invalidStatus":false,"jobName":"前端工程师","position":100901,"positionName":"前端开发工程师","location":101010100,"locationName":"肖家河桥","experienceName":"3-5年","degreeName":"本科","jobType":0,"proxyJob":0,"proxyType":0,"salaryDesc":"25-40K","payTypeDesc":null,"postDescription":"熟练使用VITE或Webpack打包工具；\\n精通使用Vue 3.0 、element-PLUS等主流前端框架，熟练使用Vue状态管理，路由配置，vue-loader预处理，组件自定义；\\n熟练使用axios网络组件，掌握使用Cookies，以及网络请求前端加解密技术；\\n熟练掌握前端组件化开发，前端开发框架搭建；\\n掌握前端缓存技术；\\n了解前端优化技巧，并且根据实际情况进行前端框架优化；\\n了解常见前端攻击方式以及预防方法；\\n熟练掌握echarts图表组件，能够对大数据量多图表页面进行性能优化；","encryptAddressId":"6914d969b01eafe21nd409S7FVFSxIm9Wfqf","address":"北京海淀区中软大厦.","longitude":116.334251,"latitude":39.958087,"staticMapUrl":"https://img.bosszhipin.com/beijin/upload/amap_proxy/20230428/48ba41acc9cef1bf3f3c8ba446b40b7757c453bede60b22f6bb61e3b7bce0931da574d19d1d82c88.jpg","pcStaticMapUrl":"https://img.bosszhipin.com/beijin/upload/amap_proxy/20230608/48ba41acc9cef1bf03ae3ae84352bc0cfa3e4b77ee71ca986bb61e3b7bce0931da574d19d1d82c88.jpg","overseasAddressList":[],"overseasInfo":null,"showSkills":["JavaScript","Vue"],"anonymous":0,"jobStatusDesc":"最新"}'
  //     },
  //     {
  //       id: 571,
  //       encryptJobId: 'f0bf76bbd1d8dcf71Hxz2du8EFFY',
  //       updateTime: '2024-10-04T00:12:22.941Z',
  //       dataAsJson:
  //         '{"encryptId":"f0bf76bbd1d8dcf71Hxz2du8EFFY","encryptUserId":"cf615f0b2a5db54a1Xxz2N26Fls~","invalidStatus":false,"jobName":"前端工程师","position":100901,"positionName":"前端开发工程师","location":101010100,"locationName":"惠新西街南口","experienceName":"3-5年","degreeName":"本科","jobType":0,"proxyJob":0,"proxyType":0,"salaryDesc":"20-30K","payTypeDesc":null,"postDescription":"熟练使用HTML,CSS，JAVASCRIPT;\\n熟练使用NPM或Yarn包管理工具；\\n掌握Sass，PostCss，Less，Stylus进行CSS预处理；\\n熟练使用VITE或Webpack打包工具；\\n精通使用Vue 3.0 、element-PLUS等主流前端框架，熟练使用Vue状态管理，路由配置，vue-loader预处理，组件自定义；\\n熟练使用axios网络组件，掌握使用Cookies，以及网络请求前端加解密技术；\\n熟练掌握前端组件化开发，前端开发框架搭建；\\n掌握前端缓存技术；\\n了解前端优化技巧，并且根据实际情况进行前端框架优化；\\n了解常见前端攻击方式以及预防方法；\\n熟练掌握echarts图表组件，能够对大数据量多图表页面进行性能优化；","encryptAddressId":"6914d969b01eafe21nd409S7FVFSxIm9Wfqf","address":"北京海淀区中软大厦.","longitude":116.334251,"latitude":39.958087,"staticMapUrl":"https://img.bosszhipin.com/beijin/upload/amap_proxy/20230428/48ba41acc9cef1bf3f3c8ba446b40b7757c453bede60b22f6bb61e3b7bce0931da574d19d1d82c88.jpg","pcStaticMapUrl":"https://img.bosszhipin.com/beijin/upload/amap_proxy/20230608/48ba41acc9cef1bf03ae3ae84352bc0cfa3e4b77ee71ca986bb61e3b7bce0931da574d19d1d82c88.jpg","overseasAddressList":[],"overseasInfo":null,"showSkills":["JavaScript","Vue"],"anonymous":0,"jobStatusDesc":"最新"}'
  //     }
  //   ].map((it) => ({
  //     ...it,
  //     ...(() => {
  //       try {
  //         return JSON.parse(it.dataAsJson)
  //       } catch {
  //         return {}
  //       }
  //     })(),
  //     __ggr_updateTime: it.updateTime
  //   }))
  // })

  if (!historyList.length) {
    toast.warning({
      message: '此职位暂无已保存的历史变化。'
    })
    return
  }
  historyDialogVisibleModelValue.value = true
  selectedJobInfoForViewHistory.value = record
  selectedJobHistory.value = historyList
}
</script>

<style scoped lang="scss">
.embedded-wrap {
  width: 100%;
  height: 100%;
  min-height: 0;
}
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
