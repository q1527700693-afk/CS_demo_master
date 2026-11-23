<script setup lang="ts">
import { ref, watch } from 'vue'
import { assetUrl } from '@/api/assets'
const props = withDefaults(
  defineProps<{ src?: string | null; name: string; size?: 'small' | 'large' }>(),
  { size: 'small' },
)
const failed = ref(false)
watch(
  () => props.src,
  () => {
    failed.value = false
  },
)
</script>
<template>
  <span class="avatar" :class="size"
    ><img
      v-if="src && !failed"
      :src="assetUrl(src)"
      :alt="`${name}的头像`"
      @error="failed = true"
    /><span v-else aria-hidden="true">{{ name.slice(0, 1).toUpperCase() || '?' }}</span></span
  >
</template>
<style scoped>
img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}
</style>
