<script setup lang="ts">
import { ref } from 'vue'
import WorkflowUploadPage from './WorkflowUploadPage.vue'
import LocalExportPage from './LocalExportPage.vue'
import AutomaticUploadPage from './AutomaticUploadPage.vue'
import { useRoute } from 'vue-router'
import { mockModules } from '@/app/config'
const route = useRoute()
const view = ref<'local' | 'cloud'>(route.query.view === 'cloud' ? 'cloud' : 'local')
</script>
<template>
  <AutomaticUploadPage v-if="!mockModules.replay" />
  <template v-else>
    <div class="export-navigation">
      <button
        class="button"
        :class="view === 'local' ? 'primary' : 'secondary'"
        @click="view = 'local'"
      >
        本地解析并导出 ZIP</button
      ><button
        class="button"
        :class="view === 'cloud' ? 'primary' : 'secondary'"
        @click="view = 'cloud'"
      >
        {{ mockModules.replay ? '云端上传 / 演示' : '上传分析包并生成报告' }}
      </button>
    </div>
    <LocalExportPage v-if="view === 'local'" />
    <WorkflowUploadPage v-else />
  </template>
</template>
<style scoped>
.export-navigation {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}
</style>
