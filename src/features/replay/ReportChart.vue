<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { init, use, type EChartsType, type EChartsCoreOption } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  AriaComponent,
} from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  AriaComponent,
  SVGRenderer,
])
const props = defineProps<{ option: EChartsCoreOption; label: string }>()
const emit = defineEmits<{ select: [round: number] }>()
const container = ref<HTMLElement>()
let chart: EChartsType | undefined
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!container.value) return
  chart = init(container.value, undefined, { renderer: 'svg' })
  chart.setOption(props.option)
  chart.on('click', (event) => {
    const round = Number(event.name)
    if (Number.isFinite(round)) emit('select', round)
  })
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(container.value)
})
watch(
  () => props.option,
  (value) => chart?.setOption(value, true),
)
onUnmounted(() => {
  observer?.disconnect()
  chart?.dispose()
})
</script>
<template><div ref="container" class="report-chart" role="img" :aria-label="label" /></template>
<style scoped>
.report-chart {
  width: 100%;
  height: 300px;
  min-width: 0;
}
@media (max-width: 650px) {
  .report-chart {
    height: 250px;
  }
}
</style>
