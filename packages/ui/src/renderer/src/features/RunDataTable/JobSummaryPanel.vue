<template>
  <ElDrawer :model-value="visible" title="岗位摘要" size="min(850px, 94vw)" append-to-body
    destroy-on-close @update:model-value="emit('update:visible', $event)" @opened="load">
    <div v-loading="loading" class="job-summary">
      <p class="job-summary__hint">基于打开摘要时的搜索与过滤结果，在本地分析已保存的 JD；同一岗位只计一次，不受表格分页影响。</p>
      <ElAlert v-if="error" :title="error" type="error" :closable="false" />
      <template v-if="summary">
        <div class="job-summary__cards">
          <div><span>筛选岗位</span><strong>{{ summary.totalJobs }}</strong></div>
          <div><span>分析样本</span><strong>{{ summary.sampledJobs }}</strong></div>
          <div><span>有 JD</span><strong>{{ summary.withDescription }}</strong></div>
          <div><span>缺少 JD</span><strong>{{ summary.missingDescription }}</strong></div>
        </div>
        <ElAlert v-if="summary.totalJobs > summary.sampledJobs" type="warning" :closable="false"
          :title="`结果超过 ${summary.sampleLimit} 个岗位，仅分析首次入库时间最近的 ${summary.sampledJobs} 个（日期未知的排后）；以下占比仅代表该样本。`" />
        <p class="job-summary__hint">
          样本来源：采集 {{ summary.origins.capture }} · 导入 {{ summary.origins.import }} · 历史存量 {{ summary.origins.legacy }}。<br />
          首次入库：{{ summary.firstSeenFrom ? `${formatDbDate(summary.firstSeenFrom)} 至 ${formatDbDate(summary.firstSeenTo)}` : '暂无已知日期' }}；
          {{ summary.unknownFirstSeen }} 个岗位日期未知。此日期表示进入本地资料库的时间。
          <span v-if="summary.truncatedDescriptions">{{ summary.truncatedDescriptions }} 份 JD 仅分析前 50,000 字。</span>
        </p>
        <ElEmpty v-if="!summary.sampledJobs" description="当前条件下没有岗位，可调整筛选后重新打开摘要" />
        <template v-else>
          <section v-for="section in sections" :key="section.key" class="job-summary__section">
            <h3>{{ section.title }}</h3>
            <p class="job-summary__hint">{{ section.hint }}</p>
            <div v-if="summary[section.key].length" class="job-summary__terms">
              <div v-for="item in summary[section.key]" :key="item.term" class="job-summary__term">
                <span>{{ item.term }}</span><b>{{ item.jobs }} 岗位 · {{ item.percent }}%</b>
                <div class="job-summary__bar"><i :style="{ width: `${item.percent}%` }" /></div>
              </div>
            </div>
            <p v-else class="job-summary__hint">暂无可识别的词语</p>
          </section>
          <p class="job-summary__hint">占比的分母为 {{ summary.withDescription }} 个有 JD 的岗位。词语出现多次仍只计一个岗位；提及某技能不代表必需或熟练程度。摘要仅反映保存的样本。</p>
        </template>
      </template>
    </div>
  </ElDrawer>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElAlert, ElDrawer, ElEmpty } from 'element-plus'
import type { RunDataQuery } from '../../../../common/run-data'
import type { JobSummary } from '../../../../common/job-summary'
import { formatDbDate, ipcErrorMessage, toPlain } from './format'

const props = defineProps<{ visible: boolean; query: RunDataQuery }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()
const loading = ref(false), error = ref(''), summary = ref<JobSummary | null>(null)
const sections = [
  { key: 'skills' as const, title: '技能提及 Top 20', hint: '按内置技能词表匹配 JD，合并常见别名。词表覆盖有限，未命中不代表岗位没有技能要求。' },
  { key: 'terms' as const, title: 'JD 高频词 Top 20', hint: '中文分词与英文词语统计，去除常见招聘套话和已识别的技能名称。' }
]
let request = 0
watch(() => props.visible, () => {
  request++
  summary.value = null
  error.value = ''
  loading.value = false
})
async function load() {
  const id = ++request
  loading.value = true
  error.value = ''
  summary.value = null
  try {
    const result = await electron.ipcRenderer.invoke('run-data-job-summary', toPlain(props.query))
    if (id === request) summary.value = result.data
  } catch (err) {
    if (id === request) error.value = `摘要生成失败：${ipcErrorMessage(err)}`
  } finally {
    if (id === request) loading.value = false
  }
}
</script>

<style scoped>
.job-summary { min-height: 180px; }
.job-summary__hint { font-size: 12px; line-height: 1.8; color: var(--el-text-color-secondary); }
.job-summary__cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
.job-summary__cards > div { padding: 14px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.job-summary__cards span { display: block; font-size: 12px; color: var(--el-text-color-secondary); }
.job-summary__cards strong { display: block; margin-top: 4px; font-size: 24px; }
.job-summary__section { margin: 24px 0; }
.job-summary__section h3 { font-size: 16px; margin-bottom: 4px; }
.job-summary__terms { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; }
.job-summary__term { display: grid; grid-template-columns: 1fr auto; gap: 6px; font-size: 13px; }
.job-summary__term > span { overflow-wrap: anywhere; }
.job-summary__term b { font-weight: normal; color: var(--el-text-color-secondary); }
.job-summary__bar { grid-column: 1 / -1; height: 4px; background: var(--el-fill-color); border-radius: 4px; overflow: hidden; }
.job-summary__bar i { display: block; height: 100%; background: var(--el-color-primary); }
@media (max-width: 600px) {
  .job-summary__cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .job-summary__terms { grid-template-columns: 1fr; }
}
</style>
