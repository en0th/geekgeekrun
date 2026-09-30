<template>
  <ElDrawer
    :model-value="visible"
    :title="`${datasetDef.label} · 统计分析`"
    size="80%"
    append-to-body
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
    @opened="loadStats"
  >
    <div v-loading="loading" class="stats-panel">
      <div class="text-12px color-#909399 mb12px">
        统计范围为当前搜索与过滤条件下的全部记录（不受分页影响）。
      </div>
      <div class="stats-panel__cards">
        <div class="stats-panel__card">
          <div class="stats-panel__card-label">记录数</div>
          <div class="stats-panel__card-value">{{ stats?.total ?? '-' }}</div>
        </div>
        <div v-for="d in preset.distinctFields ?? []" :key="d.field" class="stats-panel__card">
          <div class="stats-panel__card-label">{{ d.label }}</div>
          <div class="stats-panel__card-value">{{ stats?.distinct[d.field] ?? '-' }}</div>
        </div>
        <div v-for="n in preset.numericFields ?? []" :key="n.field" class="stats-panel__card">
          <div class="stats-panel__card-label">{{ n.label }}</div>
          <div class="stats-panel__card-value">
            {{ formatNumber(stats?.numeric[n.field]?.avg) }}<small>{{ n.unit }}</small>
          </div>
          <div class="stats-panel__card-sub">
            {{ formatNumber(stats?.numeric[n.field]?.min) }} ~
            {{ formatNumber(stats?.numeric[n.field]?.max) }}{{ n.unit }}
          </div>
        </div>
      </div>

      <div class="stats-panel__grid">
        <div
          v-for="chart in preset.charts"
          :key="chart.id"
          class="stats-panel__chart"
          :class="{ 'is-wide': chart.wide }"
        >
          <div class="stats-panel__chart-title">{{ chart.title }}</div>
          <div class="stats-panel__chart-body">
            <EChart v-if="stats?.groups[chart.id]?.length" :option="presetOptions[chart.id]" />
            <div v-else-if="stats" class="stats-panel__empty">暂无数据</div>
          </div>
        </div>
      </div>

      <div class="stats-panel__chart is-wide mt16px">
        <div class="stats-panel__chart-title flex flex-wrap items-center gap-8px">
          <span>自定义统计</span>
          <ElSelect
            v-model="custom.field"
            size="small"
            class="w150px"
            filterable
            placeholder="字段"
          >
            <ElOption v-for="f in datasetDef.fields" :key="f.key" :label="f.label" :value="f.key" />
          </ElSelect>
          <ElSelect
            v-if="customField?.type === 'date'"
            v-model="custom.bucket"
            size="small"
            class="w110px"
          >
            <ElOption label="按天" value="day" />
            <ElOption label="按周" value="week" />
            <ElOption label="按月" value="month" />
            <ElOption label="按小时" value="hour" />
            <ElOption label="按星期" value="weekday" />
          </ElSelect>
          <ElSelect v-model="custom.type" size="small" class="w110px">
            <ElOption label="柱状图" value="bar" />
            <ElOption label="条形图" value="hbar" />
            <ElOption label="折线图" value="line" />
            <ElOption label="饼图" value="pie" />
          </ElSelect>
          <span class="text-12px">前</span>
          <ElInputNumber
            v-model="custom.limit"
            size="small"
            :min="1"
            :max="200"
            controls-position="right"
            class="w90px"
          />
          <span class="text-12px">项</span>
          <ElButton
            size="small"
            type="primary"
            :disabled="!custom.field"
            :loading="customLoading"
            @click="loadCustom"
            >生成</ElButton
          >
        </div>
        <div class="stats-panel__chart-body">
          <EChart v-if="customOption" :option="customOption" />
          <div v-else class="stats-panel__empty">
            {{ customChart ? '暂无数据' : '选择字段后点击“生成”' }}
          </div>
        </div>
      </div>
    </div>
  </ElDrawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElButton, ElDrawer, ElInputNumber, ElMessage, ElOption, ElSelect } from 'element-plus'
import EChart from './EChart.vue'
import {
  runDataDatasets,
  type RunDataDatasetKey,
  type RunDataQuery,
  type RunDataStatsBucket,
  type RunDataStatsRes
} from '../../../../common/run-data'
import type { RunDataChart, RunDataStatsPreset } from './types'
import { enumLabel, toPlain } from './format'

const props = defineProps<{
  visible: boolean
  dataset: RunDataDatasetKey
  query: RunDataQuery
  preset: RunDataStatsPreset
}>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const datasetDef = computed(() => runDataDatasets[props.dataset])
const loading = ref(false)
const stats = ref<RunDataStatsRes | null>(null)

async function fetchStats(charts: RunDataChart[], withSummary: boolean) {
  const { data } = (await electron.ipcRenderer.invoke(
    'run-data-stats',
    toPlain({
      ...props.query,
      groups: charts.map((c) => ({ id: c.id, ...c.group })),
      numericFields: withSummary ? props.preset.numericFields?.map((n) => n.field) : [],
      distinctFields: withSummary ? props.preset.distinctFields?.map((d) => d.field) : []
    })
  )) as { data: RunDataStatsRes }
  return data
}

async function loadStats() {
  loading.value = true
  try {
    stats.value = await fetchStats(props.preset.charts, true)
  } catch (err) {
    ElMessage.error(`统计失败：${(err as Error)?.message ?? err}`)
  } finally {
    loading.value = false
  }
}

const custom = reactive<{
  field: string
  bucket: RunDataStatsBucket
  type: RunDataChart['type']
  limit: number
}>({ field: '', bucket: 'day', type: 'bar', limit: 20 })
const customField = computed(() => datasetDef.value.fields.find((f) => f.key === custom.field))
const customChart = ref<RunDataChart | null>(null)
const customData = ref<{ name: string; value: number }[]>([])
const customLoading = ref(false)

async function loadCustom() {
  const chart: RunDataChart = {
    id: 'custom',
    title: '',
    type: custom.type,
    group: {
      field: custom.field,
      bucket: customField.value?.type === 'date' ? custom.bucket : undefined,
      limit: custom.limit
    }
  }
  customLoading.value = true
  try {
    const data = await fetchStats([chart], false)
    customChart.value = chart
    customData.value = data.groups.custom ?? []
  } catch (err) {
    ElMessage.error(`统计失败：${(err as Error)?.message ?? err}`)
  } finally {
    customLoading.value = false
  }
}

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function displayName(chart: RunDataChart, name: unknown) {
  const field = datasetDef.value.fields.find((f) => f.key === chart.group.field)
  if (chart.group.bucket === 'weekday') return weekdays[Number(name)] ?? String(name)
  if (chart.group.bucket === 'hour') return `${name}时`
  if (field?.type === 'enum') return enumLabel(field, name) || '(空)'
  if (chart.group.bucket === 'numberRange' && field?.key.startsWith('salary')) return `${name}k`
  return name === null || name === '' ? '(空)' : String(name)
}

const formatNumber = (n: number | null | undefined) =>
  n === null || n === undefined ? '-' : Number.isInteger(n) ? String(n) : n.toFixed(1)

function buildOption(chart: RunDataChart, rawData = stats.value?.groups[chart.id] ?? []) {
  const data = rawData.map((it) => ({ name: displayName(chart, it.name), value: it.value }))
  const names = data.map((d) => d.name)
  const values = data.map((d) => d.value)
  const tooltip = { trigger: chart.type === 'pie' ? 'item' : 'axis', confine: true }
  switch (chart.type) {
    case 'pie':
      return {
        tooltip: { ...tooltip, formatter: '{b}: {c} ({d}%)' },
        legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle' },
        series: [
          {
            type: 'pie',
            radius: ['40%', '70%'],
            center: ['38%', '50%'],
            label: { formatter: '{d}%' },
            data
          }
        ]
      }
    case 'hbar':
      return {
        tooltip,
        grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
        xAxis: { type: 'value', minInterval: 1 },
        yAxis: {
          type: 'category',
          data: [...names].reverse(),
          axisLabel: { width: 120, overflow: 'truncate' }
        },
        series: [{ type: 'bar', data: [...values].reverse(), barMaxWidth: 18 }]
      }
    default:
      return {
        tooltip,
        grid: {
          left: 8,
          right: 16,
          top: 16,
          bottom: names.length > 31 ? 40 : 8,
          containLabel: true
        },
        xAxis: { type: 'category', data: names, axisLabel: { hideOverlap: true } },
        yAxis: { type: 'value', minInterval: 1 },
        dataZoom: names.length > 31 ? [{ type: 'slider', height: 16, bottom: 8 }] : undefined,
        series: [
          chart.type === 'line'
            ? { type: 'line', data: values, smooth: true, areaStyle: { opacity: 0.12 } }
            : { type: 'bar', data: values, barMaxWidth: 24 }
        ]
      }
  }
}

// memoised so unrelated re-renders don't reset the charts
const presetOptions = computed(() =>
  Object.fromEntries(props.preset.charts.map((c) => [c.id, buildOption(c)]))
)
const customOption = computed(() =>
  customChart.value && customData.value.length
    ? buildOption(customChart.value, customData.value)
    : null
)
</script>

<style scoped lang="scss">
.stats-panel {
  min-height: 200px;
  &__cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }
  &__card {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    padding: 10px 12px;
  }
  &__card-label {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  &__card-value {
    font-size: 22px;
    font-weight: 600;
    margin-top: 4px;
    small {
      font-size: 12px;
      font-weight: normal;
      margin-left: 2px;
    }
  }
  &__card-sub {
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  &__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  &__chart {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    padding: 10px 12px;
    &.is-wide {
      grid-column: 1 / -1;
    }
  }
  &__chart-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  &__chart-body {
    height: 280px;
  }
  &__empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }
}
</style>
