<template>
  <div class="run-data-table" :class="{ 'is-fullscreen': isFullscreen }">
    <!-- toolbar -->
    <div class="run-data-table__toolbar">
      <ElInput
        v-model="keywordInput"
        size="small"
        clearable
        :prefix-icon="Search"
        :placeholder="`搜索${searchableLabels}`"
        class="run-data-table__search"
        @keydown.enter="applyKeyword"
        @clear="applyKeyword"
      />
      <ElBadge :value="advancedRows.length" :hidden="!advancedRows.length" type="primary">
        <ElButton size="small" :icon="Operation" @click="filterDialogVisible = true">过滤</ElButton>
      </ElBadge>
      <FilterPresets
        :saved="memory.saved.value"
        :recent="memory.recent.value"
        :can-save="hasConditions"
        :describe="describeSnapshot"
        @apply="applyStored"
        @save="saveFilter"
        @remove-saved="memory.removeSaved"
        @remove-recent="memory.removeRecent"
      />
      <div class="run-data-table__tools">
        <ElButton size="small" :icon="DataAnalysis" @click="openStats">统计</ElButton>
        <ElButton
          v-if="datasetDef.importable !== false"
          size="small"
          :icon="Upload"
          @click="openImport"
          >导入</ElButton
        >
        <ElDropdown trigger="click" @command="exportAll">
          <ElButton size="small" :icon="Download" :loading="exporting">导出</ElButton>
          <template #dropdown>
            <ElDropdownMenu>
              <ElDropdownItem disabled
                >导出当前结果（{{ pagination.totalItemCount }} 条）</ElDropdownItem
              >
              <ElDropdownItem v-for="f in exportFormatOptions" :key="f.value" :command="f.value">{{
                f.label
              }}</ElDropdownItem>
            </ElDropdownMenu>
          </template>
        </ElDropdown>
        <ColumnSettings
          :columns="orderedColumns"
          :hidden="hiddenKeys"
          @update:order="(order) => (prefs.order = order)"
          @update:hidden="(hidden) => (prefs.hidden = hidden)"
          @reset="resetPrefs"
        />
        <ElButton
          size="small"
          :icon="isFullscreen ? Close : FullScreen"
          @click="toggleFullscreen"
          >{{ isFullscreen ? '退出全屏' : '全屏' }}</ElButton
        >
        <ElButton size="small" :icon="Refresh" :loading="isTableLoading" @click="handleRefresh"
          >刷新</ElButton
        >
      </div>
    </div>

    <!-- active conditions -->
    <div v-if="hasConditions" class="run-data-table__conditions">
      <ElTag v-if="appliedKeyword" size="small" closable @close="clearKeyword"
        >搜索：{{ appliedKeyword }}</ElTag
      >
      <ElTag
        v-for="(row, index) in advancedRows"
        :key="`adv-${index}`"
        size="small"
        type="primary"
        closable
        @close="advancedRows = advancedRows.filter((_, i) => i !== index)"
        >{{ describeAdvanced(row) }}</ElTag
      >
      <ElTag
        v-for="item in activeColumnFilters"
        :key="`col-${item.field.key}`"
        size="small"
        type="success"
        closable
        @close="columnFilters[item.field.key] = null"
        >{{ item.text }}</ElTag
      >
      <ElButton link size="small" type="primary" @click="saveFilter()">保存条件</ElButton>
      <ElButton link size="small" type="primary" @click="clearAllConditions">清除全部</ElButton>
    </div>

    <!-- batch bar -->
    <div v-if="selection.length" class="run-data-table__batch">
      <span
        >已选 <strong>{{ selection.length }}</strong> 项</span
      >
      <ElDropdown trigger="click" @command="exportSelected">
        <ElButton size="small" link type="primary" :icon="Download">导出选中</ElButton>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem v-for="f in exportFormatOptions" :key="f.value" :command="f.value">{{
              f.label
            }}</ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
      <ElButton size="small" link type="primary" :icon="DocumentCopy" @click="copySelected"
        >复制</ElButton
      >
      <ElButton
        v-if="datasetDef.hasJob"
        size="small"
        link
        type="primary"
        :icon="Link"
        :loading="openingOnline"
        @click="openSelectedOnline"
        >在BOSS查看所选职位</ElButton
      >
      <ElButton
        v-if="datasetDef.hasJob"
        size="small"
        link
        type="primary"
        :icon="Star"
        @click="openFavoritePicker"
        >收藏到…</ElButton
      >
      <ElButton
        v-if="datasetDef.deletable !== false"
        size="small"
        link
        type="danger"
        :icon="Delete"
        @click="deleteSelected"
        >{{ dataset === 'favoriteJobs' ? '移出收藏夹' : '删除' }}</ElButton
      >
      <ElButton size="small" link @click="clearSelection">取消选择</ElButton>
    </div>

    <!-- table -->
    <div v-loading="isTableLoading" class="flex-1 of-hidden">
      <div ref="tableContainerEl" class="h-100% of-hidden">
        <ElTable
          ref="tableRef"
          :height="tableHeight"
          :data="tableData"
          :row-key="getRowKey"
          :default-sort="defaultSortForTable"
          size="small"
          border
          highlight-current-row
          :cell-class-name="cellClassName"
          @cell-click="handleCellClick"
          @sort-change="handleSortChange"
          @selection-change="(rows) => (selection = rows)"
          @header-dragend="handleTableHeaderDragend"
        >
          <template #empty>
            <div class="run-data-table__empty">
              <p>{{ emptyText || '暂无数据' }}</p>
              <ElButton
                v-if="emptyAction"
                size="small"
                type="primary"
                plain
                @click="jumpStore.jump({ dataset: '__page__', rows: [], label: emptyAction.label, page: emptyAction.page })"
              >
                {{ emptyAction.label }}
              </ElButton>
            </div>
          </template>
          <ElTableColumn type="selection" width="36" fixed="left" reserve-selection />
          <ElTableColumn
            v-for="col in displayedColumns"
            :key="col.key"
            :column-key="col.key"
            :prop="col.field?.key"
            :label="col.label"
            :width="prefs.widths[col.key] ?? col.width"
            :min-width="col.minWidth"
            :sortable="col.sortable ? 'custom' : false"
            :show-overflow-tooltip="!slots[`cell-${col.key}`]"
          >
            <template #header>
              <span>{{ col.label }}</span>
              <ColumnHeaderFilter
                v-if="col.headerFilter && col.field"
                :model-value="columnFilters[col.field.key] ?? null"
                @update:model-value="(v) => (columnFilters[col.field!.key] = v)"
                :field="col.field"
                :query="query"
              />
            </template>
            <template #default="{ row }">
              <slot :name="`cell-${col.key}`" :row="row">{{ cellText(col, row) }}</slot>
            </template>
          </ElTableColumn>
          <ElTableColumn
            v-if="slots.actions"
            label="操作"
            fixed="right"
            :width="actionsWidth ?? 120"
          >
            <template #default="{ row }">
              <slot name="actions" :row="row" />
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </div>

    <div class="run-data-table__footer">
      <ElPagination
        v-model:current-page="pagination.pageNo"
        v-model:page-size="pagination.pageSize"
        :page-sizes="pageSizeList"
        small
        :disabled="isTableLoading"
        layout="total, sizes, prev, pager, next, jumper"
        :total="pagination.totalItemCount"
        @size-change="handlePageSizeChange"
        @current-change="fetchData"
      />
    </div>

    <Teleport to="body">
      <div
        v-if="cellMenu"
        ref="cellMenuEl"
        class="run-data-cell-menu"
        role="menu"
        :style="{ left: `${cellMenu.x}px`, top: `${cellMenu.y}px` }"
      >
        <div class="run-data-cell-menu__title">加入过滤条件并重新检索</div>
        <div class="run-data-cell-menu__value" :title="cellMenu.title">{{ cellMenu.title }}</div>
        <button
          v-for="(option, index) in cellMenu.options"
          :key="index"
          type="button"
          role="menuitem"
          class="run-data-cell-menu__item"
          @click="applyCellFilter(option)"
        >
          {{ option.label }}
        </button>
      </div>
    </Teleport>
    <FilterBuilder
      v-model:visible="filterDialogVisible"
      v-model="advancedRows"
      :fields="datasetDef.fields"
    />
    <StatsPanel
      v-model:visible="statsVisible"
      :dataset="dataset"
      :query="query"
      :preset="statsPreset"
      @drill="handleDrill"
    />
    <ImportDialog v-model:visible="importVisible" :dataset="dataset" @imported="fetchData" />
    <FavoriteFolderPicker
      v-model:visible="favoritePickerVisible"
      :job-ids="favoriteJobIds"
      @saved="handleFavoritesSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { toast } from '@renderer/features/Toast'
import {
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  useSlots,
  watch
} from 'vue'
import {
  ElBadge,
  ElButton,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElMessageBox,
  ElPagination,
  ElTable,
  ElTableColumn,
  ElTag,
  type TableColumnCtx
} from 'element-plus'
import {
  Close,
  DataAnalysis,
  Delete,
  DocumentCopy,
  Download,
  FullScreen,
  Link,
  Operation,
  Refresh,
  Search,
  Star,
  Upload
} from '@element-plus/icons-vue'
import {
  runDataDatasets,
  type RunDataDatasetKey,
  type RunDataField,
  type RunDataFilter,
  type RunDataQuery,
  type RunDataSort
} from '../../../../common/run-data'
import type { PagedRes } from '../../../../common/types/pagination'
import type { RunDataColumn, RunDataRow, RunDataStatsPreset } from './types'
import { useRunDataTablePrefs } from './prefs'
import { enumLabel, formatFieldValue, toPlain } from './format'
import {
  type CellFilterOption,
  type FilterRow,
  cellFilterOptions,
  describeFilterRow,
  drillToFilter,
  isFilterRowComplete,
  toServerFilter
} from './filters'
import { exportFormatOptions, exportRows, rowsToTsv, type ExportFormat } from './io'
import ColumnHeaderFilter from './ColumnHeaderFilter.vue'
import ColumnSettings from './ColumnSettings.vue'
import FilterBuilder from './FilterBuilder.vue'
import FilterPresets from './FilterPresets.vue'
import { type FilterSnapshot, sessionFilters, useFilterMemory } from './filter-memory'
import StatsPanel from './StatsPanel.vue'
import ImportDialog from './ImportDialog.vue'
import FavoriteFolderPicker from './FavoriteFolderPicker.vue'
import { useRunDataJumpStore } from '../../store'

const OPEN_ONLINE_LIMIT = 20

const props = defineProps<{
  dataset: RunDataDatasetKey
  columns: RunDataColumn[]
  statsPreset: RunDataStatsPreset
  actionsWidth?: number
  // always applied and not shown as removable conditions, e.g. the selected favourite folder
  baseFilters?: RunDataFilter[]
  // remembered and saved conditions are kept under this key (default: the dataset), so a table
  // showing part of a dataset (e.g. one run's rows) doesn't share them with the full table
  memoryKey?: string
  // ignore "open with these filters" jumps meant for the dataset's own page
  // (a boolean prop left out is false, so this is opt-in)
  ignoreJumps?: boolean
  // sent with every query; a clientRows dataset takes its rows from context.rows
  context?: unknown
  // empty state: a line of guidance instead of the bare 暂无数据
  emptyText?: string
  // plus a button that jumps to another page (e.g. 去配置找岗位)
  emptyAction?: { label: string; page: string }
}>()

const emit = defineEmits<{
  // rows were deleted or favourited, so counts shown outside the table may be stale
  (e: 'changed'): void
}>()

const slots = useSlots()
const datasetDef = computed(() => runDataDatasets[props.dataset])
const searchableLabels = computed(() =>
  datasetDef.value.fields
    .filter((f) => f.searchable)
    .map((f) => f.label)
    .slice(0, 4)
    .join('/')
)

// ---------- columns ----------
interface ResolvedColumn extends Omit<RunDataColumn, 'field' | 'label'> {
  label: string
  field?: RunDataField
}

const defaultMinWidth = (field?: RunDataField) =>
  field?.type === 'date' ? 150 : field?.type === 'number' ? 90 : 110

const allColumns = computed<ResolvedColumn[]>(() => {
  const fieldOf = (key?: string) => datasetDef.value.fields.find((f) => f.key === key)
  const fromProps = props.columns.map((c) => {
    const field = fieldOf(c.field ?? c.key)
    return {
      ...c,
      field,
      label: c.label ?? field?.label ?? c.key,
      minWidth: c.minWidth ?? defaultMinWidth(field),
      sortable: c.sortable ?? !!field,
      headerFilter: c.headerFilter ?? (field?.type === 'string' || field?.type === 'enum')
    }
  })
  // every other dataset field is available from column settings, hidden by default
  const used = new Set(fromProps.map((c) => c.field?.key ?? c.key))
  const rest = datasetDef.value.fields
    .filter((f) => !used.has(f.key))
    .map((f) => ({
      key: f.key,
      label: f.label,
      field: f,
      minWidth: defaultMinWidth(f),
      sortable: true,
      headerFilter: f.type === 'string' || f.type === 'enum',
      defaultHidden: true
    }))
  return [...fromProps, ...rest]
})

const { prefs, reset: resetPrefs } = useRunDataTablePrefs(props.dataset)

const orderedColumns = computed(() => {
  const byKey = new Map(allColumns.value.map((c) => [c.key, c]))
  const ordered = prefs.value.order.map((k) => byKey.get(k)).filter(Boolean) as ResolvedColumn[]
  const rest = allColumns.value.filter((c) => !prefs.value.order.includes(c.key))
  return [...ordered, ...rest]
})
const hiddenKeys = computed(
  () => prefs.value.hidden ?? allColumns.value.filter((c) => c.defaultHidden).map((c) => c.key)
)
const displayedColumns = computed(() =>
  orderedColumns.value.filter((c) => !hiddenKeys.value.includes(c.key))
)

function handleHeaderDragend(newWidth: number, _old: number, column: TableColumnCtx<RunDataRow>) {
  if (column.columnKey) {
    prefs.value.widths = { ...prefs.value.widths, [column.columnKey]: Math.round(newWidth) }
  }
}

function cellText(col: ResolvedColumn, row: RunDataRow) {
  if (col.formatter) return col.formatter(row)
  return formatFieldValue(col.field, row[col.field?.key ?? col.key])
}

// ---------- query state ----------
const keywordInput = ref('')
const appliedKeyword = ref('')
const advancedRows = ref<FilterRow[]>([])
const columnFilters = reactive<Record<string, (string | number | null)[] | null>>({})
const sort = ref<RunDataSort | null>(null)

let keywordTimer: ReturnType<typeof setTimeout> | undefined
watch(keywordInput, () => {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(applyKeyword, 400)
})
function applyKeyword() {
  clearTimeout(keywordTimer)
  appliedKeyword.value = keywordInput.value.trim()
}
function clearKeyword() {
  keywordInput.value = ''
  applyKeyword()
}

const fieldByKey = (key: string) => datasetDef.value.fields.find((f) => f.key === key)

const query = computed<RunDataQuery>(() => ({
  dataset: props.dataset,
  keyword: appliedKeyword.value,
  filters: [
    ...(props.baseFilters ?? []),
    ...advancedRows.value
      .filter((r) => isFilterRowComplete(r) && fieldByKey(r.field))
      .map((r) => toServerFilter(r, fieldByKey(r.field)!)),
    ...Object.entries(columnFilters)
      .filter(([, values]) => values?.length)
      .map(([field, values]) => ({ field, op: 'in' as const, value: [...values!] }))
  ],
  sort: sort.value,
  // a change of the page's rows (clientRows) reloads the table like a filter change
  ...(props.context !== undefined ? { context: props.context } : {})
}))

const defaultSortForTable = computed(() => {
  const s = datasetDef.value.defaultSort
  return s
    ? ({ prop: s.field, order: s.order === 'asc' ? 'ascending' : 'descending' } as const)
    : undefined
})

function handleSortChange({ prop, order }: { prop: string; order: string | null }) {
  sort.value = order ? { field: prop, order: order === 'ascending' ? 'asc' : 'desc' } : null
}

const describeAdvanced = (row: FilterRow) => {
  const f = fieldByKey(row.field)
  return f ? describeFilterRow(row, f) : row.field
}
function describeColumn(key: string, values: (string | number | null)[]) {
  const field = fieldByKey(key)
  if (!field) return key
  const shown = values
    .slice(0, 3)
    .map((v) =>
      field.type === 'enum' ? enumLabel(field, v) || '(空)' : v === null || v === '' ? '(空)' : v
    )
  return `${field.label}：${shown.join('、')}${values.length > 3 ? ` 等${values.length}项` : ''}`
}
const activeColumnFilters = computed(() =>
  Object.entries(columnFilters)
    .filter(([, values]) => values?.length)
    .map(([key, values]) => ({ field: fieldByKey(key)!, text: describeColumn(key, values!) }))
)
const hasConditions = computed(
  () =>
    !!appliedKeyword.value || advancedRows.value.length > 0 || activeColumnFilters.value.length > 0
)
function clearAllConditions() {
  keywordInput.value = ''
  appliedKeyword.value = ''
  advancedRows.value = []
  Object.keys(columnFilters).forEach((k) => (columnFilters[k] = null))
}

// ---------- remembered conditions ----------
const memoryKey = props.memoryKey || props.dataset
const memory = useFilterMemory(memoryKey, () => datasetDef.value.fields)
function currentSnapshot(): FilterSnapshot {
  return {
    keyword: appliedKeyword.value,
    rows: advancedRows.value.filter(isFilterRowComplete),
    columns: Object.fromEntries(
      Object.entries(columnFilters)
        .filter(([, values]) => values?.length)
        .map(([key, values]) => [key, [...values!]])
    )
  }
}
function applySnapshot(snapshot: FilterSnapshot) {
  const s = memory.copy(snapshot)
  clearTimeout(keywordTimer)
  keywordInput.value = s.keyword
  appliedKeyword.value = s.keyword
  advancedRows.value = s.rows
  Object.keys(columnFilters).forEach((k) => (columnFilters[k] = null))
  Object.entries(s.columns).forEach(([k, values]) => (columnFilters[k] = values))
}
function describeSnapshot(s: FilterSnapshot) {
  return [
    s.keyword ? `搜索：${s.keyword}` : '',
    ...s.rows.map(describeAdvanced),
    ...Object.entries(s.columns).map(([k, values]) => describeColumn(k, values))
  ]
    .filter(Boolean)
    .join('；')
}
function applyStored(snapshot: FilterSnapshot) {
  applySnapshot(snapshot)
  toast.success(`已应用过滤条件：${describeSnapshot(snapshot)}`)
}
async function saveFilter(snapshot: FilterSnapshot = currentSnapshot()) {
  const text = describeSnapshot(snapshot)
  if (!text) return
  let name: string
  try {
    const { value } = (await ElMessageBox.prompt(`条件：${text}`, '保存过滤条件', {
      inputValue: text.length > 20 ? text.slice(0, 20) + '…' : text,
      inputPlaceholder: '给这组条件起个名字',
      inputValidator: (v) => !!v?.trim() || '请输入名称',
      confirmButtonText: '保存',
      cancelButtonText: '取消'
    })) as { value: string }
    name = value.trim()
  } catch {
    return
  }
  toast.success(
    memory.save(name, snapshot) ? `已保存过滤条件“${name}”` : `已更新同样条件的名称为“${name}”`
  )
}
// switching tabs or pages remounts the table: bring back this session's conditions
const restored = sessionFilters.get(memoryKey)
if (restored) applySnapshot(restored)
let rememberTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => JSON.stringify([appliedKeyword.value, advancedRows.value, columnFilters]),
  () => {
    const snapshot = currentSnapshot()
    sessionFilters.set(memoryKey, snapshot)
    // conditions kept for a moment count as used
    clearTimeout(rememberTimer)
    rememberTimer = setTimeout(() => memory.remember(snapshot), 1500)
  }
)

// ---------- click a cell to filter by its value ----------
const cellMenu = ref<{ x: number; y: number; title: string; options: CellFilterOption[] } | null>(
  null
)
const cellMenuEl = ref<HTMLElement>()
const filterableKeys = computed(
  () => new Set(displayedColumns.value.filter((c) => c.field).map((c) => c.key))
)
const cellClassName = ({ column }: { column: TableColumnCtx<RunDataRow> }) =>
  column.columnKey && filterableKeys.value.has(column.columnKey) ? 'is-filterable' : ''
function handleCellClick(
  row: RunDataRow,
  column: TableColumnCtx<RunDataRow>,
  _cell: HTMLElement,
  event: MouseEvent
) {
  // links, buttons and checkboxes in a cell keep their own click; so does selecting text
  const target = event.target as HTMLElement
  if (target.closest('a, button, input, textarea, label, .el-button, [role="button"]')) return
  if (window.getSelection()?.toString()) return
  const col = displayedColumns.value.find((c) => c.key === column.columnKey)
  if (!col?.field) return
  const options = cellFilterOptions(col.field, row[col.field.key])
  if (!options.length) return
  cellMenu.value = {
    x: Math.max(8, Math.min(event.clientX, innerWidth - 268)),
    y: Math.max(8, Math.min(event.clientY + 6, innerHeight - 64 - options.length * 34)),
    title: `${col.field.label}：${cellText(col, row) || '(空)'}`,
    options
  }
  nextTick(() => cellMenuEl.value?.querySelector<HTMLElement>('button')?.focus())
}
function closeCellMenu() {
  cellMenu.value = null
}
/**
 * Add 过滤条件 from a stats click or a cell. A row with the same field and operator is
 * replaced (picking another value changes the condition instead of piling up ones that can't
 * all match). Returns false when the very same condition is already there.
 */
function addConditionRows(rows: FilterRow[]) {
  const same = (a: FilterRow, b: FilterRow) => JSON.stringify(a) === JSON.stringify(b)
  if (rows.every((row) => advancedRows.value.some((r) => same(r, row)))) return false
  advancedRows.value = [
    ...advancedRows.value.filter(
      (r) => !rows.some((row) => row.field === r.field && row.op === r.op)
    ),
    ...rows
  ]
  return true
}
function applyCellFilter(option: CellFilterOption) {
  closeCellMenu()
  if (!addConditionRows([option.action.row])) {
    toast.info('这个过滤条件已经存在')
    return
  }
  toast.success(`已加入过滤条件：${option.label}`)
}
function handleOutsidePointer(e: MouseEvent) {
  if (cellMenu.value && !cellMenuEl.value?.contains(e.target as Node)) closeCellMenu()
}
onMounted(() => {
  document.addEventListener('mousedown', handleOutsidePointer, true)
  window.addEventListener('resize', closeCellMenu)
  document.addEventListener('scroll', closeCellMenu, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleOutsidePointer, true)
  window.removeEventListener('resize', closeCellMenu)
  document.removeEventListener('scroll', closeCellMenu, true)
  clearTimeout(rememberTimer)
})

// ---------- opened from elsewhere with filters (task history) ----------
const jumpStore = useRunDataJumpStore()
function applyJump() {
  if (props.ignoreJumps) return
  const target = jumpStore.take(props.dataset)
  if (!target) return
  clearAllConditions()
  advancedRows.value = target.rows as FilterRow[]
  toast.success(`已筛选：${target.label}`)
}
applyJump()
watch(() => jumpStore.pending, applyJump)

// ---------- data ----------
const pageSizeList = [10, 20, 50, 100, 200, 500]
const pagination = ref({
  pageNo: 1,
  pageSize: prefs.value.pageSize ?? datasetDef.value.defaultPageSize ?? 100,
  totalItemCount: 0
})
const tableData = ref<RunDataRow[]>([])
const tableRef = ref<InstanceType<typeof ElTable>>()
const isTableLoading = ref(false)
const getRowKey = (row: RunDataRow) => String(row[datasetDef.value.rowKey])

let requestSeq = 0
async function fetchData() {
  const seq = ++requestSeq
  isTableLoading.value = true
  try {
    const { data: res } = (await electron.ipcRenderer.invoke(
      'run-data-query',
      toPlain({
        ...query.value,
        pageNo: pagination.value.pageNo,
        pageSize: pagination.value.pageSize
      })
    )) as { data: PagedRes<RunDataRow> }
    if (seq !== requestSeq) return
    tableData.value = res.data
    pagination.value.totalItemCount = res.totalItemCount
    pagination.value.pageNo = res.pageNo
  } catch (err) {
    if (seq !== requestSeq) return
    console.log(err)
    toast.error(`加载数据失败：${(err as Error)?.message ?? err}`)
    tableData.value = []
  } finally {
    if (seq === requestSeq) {
      tableRef.value?.setScrollTop(0)
      isTableLoading.value = false
    }
  }
}

watch(
  () => JSON.stringify(query.value),
  () => {
    pagination.value.pageNo = 1
    fetchData()
  }
)
fetchData()

function handlePageSizeChange(size: number) {
  prefs.value.pageSize = size
  fetchData()
}
function handleRefresh() {
  fetchData()
}
// pages reload the rows after changing them elsewhere (e.g. 打招呼)
defineExpose({ refresh: fetchData })

// ---------- table height ----------
const tableHeight = ref<number | undefined>(undefined)
const tableContainerEl = ref<HTMLElement>()
onMounted(() => {
  const update = () => (tableHeight.value = tableContainerEl.value?.clientHeight || undefined)
  update()
  const ro = new ResizeObserver(update)
  ro.observe(tableContainerEl.value!)
  onBeforeUnmount(() => ro.disconnect())
})

// ---------- selection & batch operations ----------
const selection = ref<RunDataRow[]>([])
function clearSelection() {
  tableRef.value?.clearSelection()
  selection.value = []
}

async function exportSelected(format: ExportFormat) {
  try {
    const res = await exportRows(props.dataset, selection.value, format, '-选中')
    notifySaved(res)
  } catch (err) {
    toast.error(`导出失败：${(err as Error)?.message ?? err}`)
  }
}

async function copySelected() {
  const cols = displayedColumns.value
  const text = rowsToTsv(
    cols.map((c) => c.label),
    selection.value.map((row) => cols.map((c) => cellText(c, row)))
  )
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`已复制 ${selection.value.length} 行（可直接粘贴到 Excel）`)
  } catch (err) {
    toast.error(`复制失败：${(err as Error)?.message ?? err}`)
  }
}

const openingOnline = ref(false)
async function openSelectedOnline() {
  const ids = [...new Set(selection.value.map((r) => r.encryptJobId).filter(Boolean))] as string[]
  if (!ids.length) {
    toast.warning('选中的记录中没有可打开的职位')
    return
  }
  let toOpen = ids
  if (ids.length > OPEN_ONLINE_LIMIT) {
    try {
      await ElMessageBox.confirm(
        `一次最多打开 ${OPEN_ONLINE_LIMIT} 个职位，将只打开前 ${OPEN_ONLINE_LIMIT} 个。`,
        '在BOSS查看所选职位',
        { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
    toOpen = ids.slice(0, OPEN_ONLINE_LIMIT)
  }
  openingOnline.value = true
  try {
    // sequential: the first call starts the browser process, later calls reuse it
    for (const id of toOpen) {
      await electron.ipcRenderer.invoke('open-site-with-boss-cookie', {
        url: `https://www.zhipin.com/job_detail/${id}.html`
      })
    }
  } finally {
    openingOnline.value = false
  }
}

const deleteWarning: Record<RunDataDatasetKey, string> = {
  chatStartupLog: '删除开聊记录后，程序可能会再次向这些职位发起开聊。',
  markAsNotSuitLog: '删除标记记录后，这些职位可能会被再次处理。',
  jobLibrary: '引用这些职位的开聊 / 标记记录将无法再显示职位信息。',
  bossLibrary: '引用这些 BOSS 的职位将无法再显示 BOSS 信息。',
  companyLibrary: '引用这些公司的职位 / BOSS 将无法再显示公司信息。',
  favoriteJobs: '只从收藏夹中移除，职位本身仍保留在职位库中。',
  taskRuns: '',
  configTemplates: ''
}

async function deleteSelected() {
  const count = selection.value.length
  try {
    await ElMessageBox.confirm(
      h('div', [
        h(
          'p',
          { class: 'm-0' },
          props.dataset === 'favoriteJobs'
            ? `确定将选中的 ${count} 个职位移出收藏夹吗？`
            : `确定从数据库中永久删除选中的 ${count} 条${datasetDef.value.label}吗？此操作不可撤销。`
        ),
        h('p', { class: 'm-0 mt6px color-#e6a23c' }, deleteWarning[props.dataset])
      ]),
      props.dataset === 'favoriteJobs' ? '移出收藏夹' : '删除记录',
      {
        type: 'warning',
        confirmButtonText:
          props.dataset === 'favoriteJobs' ? `移出 ${count} 个` : `删除 ${count} 条`,
        confirmButtonClass: 'el-button--danger',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  try {
    const { data } = (await electron.ipcRenderer.invoke(
      'run-data-delete',
      toPlain({
        dataset: props.dataset,
        keys: selection.value.map((r) => r[datasetDef.value.rowKey])
      })
    )) as { data: { deleted: number } }
    toast.success(`已删除 ${data.deleted} 条记录`)
    clearSelection()
    fetchData()
    emit('changed')
  } catch (err) {
    toast.error(`删除失败：${(err as Error)?.message ?? err}`)
  }
}

// ---------- favourites ----------
const favoritePickerVisible = ref(false)
const favoriteJobIds = ref<string[]>([])
function openFavoritePicker() {
  const ids = [...new Set(selection.value.map((r) => r.encryptJobId).filter(Boolean))] as string[]
  if (!ids.length) {
    toast.warning('选中的记录中没有可收藏的职位')
    return
  }
  favoriteJobIds.value = ids
  favoritePickerVisible.value = true
}
function handleFavoritesSaved() {
  clearSelection()
  emit('changed')
  if (props.dataset === 'favoriteJobs') fetchData()
}

// ---------- export all ----------
const exporting = ref(false)
function notifySaved(res: { canceled: boolean; filePath?: string }) {
  if (res.canceled || !res.filePath) return
  toast({
    type: 'success',
    message: `已导出到 ${res.filePath}`,
    duration: 5000,
    showClose: true
  })
  electron.ipcRenderer.invoke('show-item-in-folder', res.filePath)
}
async function exportAll(format: ExportFormat) {
  exporting.value = true
  try {
    const { data: rows } = (await electron.ipcRenderer.invoke(
      'run-data-query-all',
      toPlain(query.value)
    )) as { data: RunDataRow[] }
    if (!rows.length) {
      toast.warning('没有可导出的数据')
      return
    }
    if (rows.length < pagination.value.totalItemCount) {
      toast.warning(`数据量过大，仅导出前 ${rows.length} 条`)
    }
    notifySaved(await exportRows(props.dataset, rows, format))
  } catch (err) {
    toast.error(`导出失败：${(err as Error)?.message ?? err}`)
  } finally {
    exporting.value = false
  }
}

// ---------- dialogs ----------
const filterDialogVisible = ref(false)
const statsVisible = ref(false)
const importVisible = ref(false)
function openStats() {
  statsVisible.value = true
}
function openImport() {
  importVisible.value = true
}

// ---------- stats drill-down ----------
function handleDrill({
  group,
  raw,
  label
}: {
  group: { field: string; bucket?: string }
  raw: unknown
  label: string
}) {
  const field = fieldByKey(group.field)
  if (!field) return
  const filter = drillToFilter(group, raw, field.type)
  if (filter.kind === 'unsupported') {
    toast.info('按小时、星期统计的项还不能加入过滤条件')
    return
  }
  // 过滤条件, not the header filter: header filters are only set from the column header
  const added = addConditionRows(filter.rows)
  statsVisible.value = false
  if (added) toast.success(`已加入过滤条件：${field.label} ${label}`)
  else toast.info('这个过滤条件已经存在')
}

// ---------- fullscreen ----------
const isFullscreen = ref(false)
function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}
function handleKeydown(e: KeyboardEvent) {
  // leave Esc to any open dialog / drawer / popper first
  const overlayOpen = [...document.querySelectorAll<HTMLElement>('.el-overlay, .el-popper')].some(
    (el) => el.offsetParent !== null || getComputedStyle(el).display !== 'none'
  )
  if (e.key === 'Escape' && cellMenu.value) {
    closeCellMenu()
    return
  }
  if (e.key === 'Escape' && isFullscreen.value && !overlayOpen) {
    isFullscreen.value = false
  }
}
onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  clearTimeout(keywordTimer)
})
</script>

<style scoped lang="scss">
.run-data-table {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--el-bg-color);
  &.is-fullscreen {
    position: fixed;
    inset: 0;
    // below element-plus overlays / poppers (z-index starts at 2000)
    z-index: 1000;
    padding: 16px 20px 0;
  }
  &__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    // room for the 过滤 count badge
    padding-top: 8px;
    padding-bottom: 8px;
    .el-button + .el-button {
      margin-left: 0;
    }
  }
  &__search {
    width: 280px;
  }
  // right-aligned group that wraps as a unit on narrow windows
  &__tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-left: auto;
    .el-button + .el-button {
      margin-left: 0;
    }
    // a divider separates the view tools from the filter group on wide windows
    @media (min-width: 900px) {
      padding-left: 16px;
      border-left: 1px solid var(--el-border-color-lighter);
    }
  }
  &__conditions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-bottom: 8px;
  }
  &__footer {
    display: flex;
    justify-content: flex-end;
    padding: 10px 0;
    // wrap instead of clipping on narrow windows
    :deep(.el-pagination) {
      flex-wrap: wrap;
      justify-content: flex-end;
      row-gap: 6px;
    }
  }
  :deep(td.is-filterable) {
    cursor: pointer;
  }
  &__batch {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    margin-bottom: 8px;
    border-radius: 4px;
    font-size: 13px;
    background: var(--el-color-primary-light-9);
    .el-button + .el-button {
      margin-left: 0;
    }
  }
}
</style>

<style lang="scss">
/* empty tables read as one centered, compact block */
.run-data-table .el-table__empty-block {
  padding: 32px 0;
}
.run-data-table .el-table__empty-text {
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
.run-data-table__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  p {
    margin: 0;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
  }
}
.run-data-cell-menu {
  position: fixed;
  z-index: 3000;
  width: 260px;
  box-sizing: border-box;
  padding: 6px;
  border-radius: 8px;
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
  border: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
  &__title {
    padding: 4px 8px 0;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  &__value {
    padding: 2px 8px 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    border-bottom: 1px solid var(--el-border-color-lighter);
    margin-bottom: 4px;
  }
  &__item {
    display: block;
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--el-text-color-regular);
    font: inherit;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    &:hover,
    &:focus-visible {
      background: var(--el-color-primary-light-9);
      color: var(--el-color-primary);
      outline: none;
    }
  }
}
</style>
