<template>
  <ElDialog
    :model-value="visible"
    title="过滤条件"
    width="720px"
    append-to-body
    @update:model-value="emit('update:visible', $event)"
    @open="draft = cloneRows(modelValue)"
  >
    <div class="text-12px color-#909399 mb10px">所有条件同时满足（且）的记录会被显示。</div>
    <div v-for="(row, index) in draft" :key="index" class="flex items-center gap-8px mb8px">
      <ElSelect
        v-model="row.field"
        filterable
        placeholder="字段"
        size="small"
        class="w150px flex-none"
        @change="handleFieldChange(row)"
      >
        <ElOption v-for="f in fields" :key="f.key" :label="f.label" :value="f.key" />
      </ElSelect>
      <ElSelect
        v-model="row.op"
        size="small"
        class="w100px flex-none"
        :disabled="!row.field"
        @change="handleOpChange(row)"
      >
        <ElOption
          v-for="op in opsOf(row)"
          :key="op"
          :label="opLabel(fieldOf(row)!.type, op)"
          :value="op"
        />
      </ElSelect>
      <div class="flex-1 min-w-0 flex items-center gap-6px">
        <template v-if="fieldOf(row) && needsValue(row.op)">
          <!-- enum -->
          <ElSelect
            v-if="fieldOf(row)!.type === 'enum'"
            v-model="row.value"
            multiple
            collapse-tags
            collapse-tags-tooltip
            size="small"
            class="w-full"
            placeholder="选择值"
          >
            <ElOption
              v-for="opt in fieldOf(row)!.enumOptions"
              :key="enumKey(opt.value)"
              :label="opt.label"
              :value="enumKey(opt.value)"
            />
          </ElSelect>
          <!-- date -->
          <ElDatePicker
            v-else-if="fieldOf(row)!.type === 'date' && row.op === 'between'"
            v-model="row.value"
            type="datetimerange"
            size="small"
            range-separator="至"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            :shortcuts="dateRangeShortcuts"
            :default-time="[new Date(2000, 0, 1, 0, 0, 0), new Date(2000, 0, 1, 23, 59, 59)]"
            class="!w-full"
          />
          <ElDatePicker
            v-else-if="fieldOf(row)!.type === 'date'"
            v-model="row.value"
            type="datetime"
            size="small"
            placeholder="选择时间"
            class="!w-full"
          />
          <!-- number -->
          <template v-else-if="fieldOf(row)!.type === 'number' && row.op === 'between'">
            <ElInputNumber
              v-model="row.value[0]"
              size="small"
              controls-position="right"
              placeholder="最小值"
              class="flex-1"
            />
            <span>~</span>
            <ElInputNumber
              v-model="row.value[1]"
              size="small"
              controls-position="right"
              placeholder="最大值"
              class="flex-1"
            />
          </template>
          <ElInputNumber
            v-else-if="fieldOf(row)!.type === 'number'"
            v-model="row.value"
            size="small"
            controls-position="right"
            class="!w-full"
          />
          <!-- string -->
          <ElInput v-else v-model="row.value" size="small" placeholder="输入值" clearable />
        </template>
      </div>
      <ElButton size="small" link type="danger" :icon="Delete" @click="draft.splice(index, 1)" />
    </div>
    <ElButton size="small" :icon="Plus" @click="addRow">添加条件</ElButton>
    <template #footer>
      <ElButton @click="draft = []">清空</ElButton>
      <ElButton @click="emit('update:visible', false)">取消</ElButton>
      <ElButton type="primary" @click="handleApply">应用</ElButton>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  ElButton,
  ElDatePicker,
  ElDialog,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect
} from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import type { RunDataField } from '../../../../common/run-data'
import {
  type FilterRow,
  enumKey,
  isFilterRowComplete,
  needsValue,
  opLabel,
  opsForType
} from './filters'

const props = defineProps<{
  visible: boolean
  fields: RunDataField[]
  modelValue: FilterRow[]
}>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:modelValue': [value: FilterRow[]]
}>()

const cloneRows = (rows: FilterRow[]) =>
  rows.map((r) => ({ ...r, value: Array.isArray(r.value) ? [...r.value] : r.value }))

const draft = ref<FilterRow[]>([])

const fieldOf = (row: FilterRow) => props.fields.find((f) => f.key === row.field)
const opsOf = (row: FilterRow) => {
  const f = fieldOf(row)
  return f ? opsForType[f.type] : []
}

const initialValue = (row: FilterRow) => {
  const f = fieldOf(row)
  if (!f || !needsValue(row.op)) return undefined
  if (f.type === 'enum') return []
  if (row.op === 'between') return f.type === 'number' ? [undefined, undefined] : []
  return undefined
}

function handleFieldChange(row: FilterRow) {
  row.op = opsOf(row)[0]
  row.value = initialValue(row)
}
function handleOpChange(row: FilterRow) {
  row.value = initialValue(row)
}

function addRow() {
  draft.value.push({ field: '', op: 'contains', value: undefined })
}

function handleApply() {
  emit('update:modelValue', cloneRows(draft.value.filter(isFilterRowComplete)))
  emit('update:visible', false)
}

const dateRangeShortcuts = [
  { text: '今天', value: () => [dayjs().startOf('day').toDate(), dayjs().endOf('day').toDate()] },
  {
    text: '最近7天',
    value: () => [dayjs().subtract(6, 'day').startOf('day').toDate(), dayjs().endOf('day').toDate()]
  },
  {
    text: '最近30天',
    value: () => [
      dayjs().subtract(29, 'day').startOf('day').toDate(),
      dayjs().endOf('day').toDate()
    ]
  },
  {
    text: '本月',
    value: () => [dayjs().startOf('month').toDate(), dayjs().endOf('day').toDate()]
  }
]
</script>
