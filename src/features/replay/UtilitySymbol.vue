<script setup lang="ts">
import { computed } from 'vue'
import { utilityStyle } from './map-presentation'
const props = defineProps<{ type?: string }>()
const style = computed(() => utilityStyle(props.type))
</script>
<template>
  <g :data-utility-kind="style.kind">
    <circle r="18" fill="#101b27" :stroke="style.color" stroke-width="2" />
    <path
      :d="style.path"
      :fill="style.kind === 'decoy' || style.kind === 'unknown' ? 'none' : style.color"
      :stroke="style.color"
      stroke-width="1.5"
      stroke-linejoin="round"
    />
  </g>
</template>
