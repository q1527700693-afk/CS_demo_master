<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { init, use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { Report } from '@/types'
use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])
const props = defineProps<{ rounds: Report['rounds'] }>()
const container = ref<HTMLElement | null>(null)
let chart: EChartsType | undefined
let observer: ResizeObserver | undefined
function render() {
  chart?.setOption({
    backgroundColor: 'transparent',
    color: ['#ec995b', '#83b8a9'],
    tooltip: { trigger: 'axis' },
    legend: { top: 0, right: 0, textStyle: { color: '#989c9f' } },
    grid: { left: 44, right: 15, top: 40, bottom: 28 },
    xAxis: {
      type: 'category',
      data: props.rounds.map((x) => x.round),
      axisLine: { lineStyle: { color: '#383a3d' } },
      axisLabel: { color: '#989c9f' },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#989c9f', formatter: (v: number) => `${v / 1000}k` },
      splitLine: { lineStyle: { color: '#2b2d30' } },
    },
    series: [
      {
        name: '我方',
        type: 'line',
        data: props.rounds.map((x) => x.economy),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.06 },
      },
      {
        name: '对方',
        type: 'line',
        data: props.rounds.map((x) => x.enemyEconomy),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, type: 'dashed' },
      },
    ],
  })
}
onMounted(() => {
  if (container.value) {
    chart = init(container.value)
    render()
    observer = new ResizeObserver(() => chart?.resize())
    observer.observe(container.value)
  }
})
watch(() => props.rounds, render)
onUnmounted(() => {
  observer?.disconnect()
  chart?.dispose()
})
</script>
<template>
  <div ref="container" class="economy-chart" role="img" aria-label="双方每回合装备价值折线图" />
  <details class="chart-data">
    <summary>查看经济数据表</summary>
    <div class="table-scroll">
      <table class="replay-table">
        <thead>
          <tr>
            <th>回合</th>
            <th>我方装备价值</th>
            <th>对方装备价值</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="round in rounds" :key="round.round">
            <td>{{ round.round }}</td>
            <td>{{ round.economy }}</td>
            <td>{{ round.enemyEconomy }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </details>
</template>
