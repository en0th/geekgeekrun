<template>
  <div class="page-wrap flex flex-col of-hidden">
    <RunDataTable
      dataset="bossLibrary"
      :columns="columns"
      :stats-preset="runDataStatsPresets.bossLibrary"
      gtag-prefix="boss_library"
      class="flex-1"
    />
  </div>
</template>

<script setup lang="ts">
import RunDataTable from '../../features/RunDataTable/index.vue'
import { runDataStatsPresets } from '../../features/RunDataTable/stats-presets'
import type { RunDataColumn } from '../../features/RunDataTable/types'

const columns: RunDataColumn[] = [{ key: 'companyName' }, { key: 'name' }, { key: 'title' }]
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
</style>
