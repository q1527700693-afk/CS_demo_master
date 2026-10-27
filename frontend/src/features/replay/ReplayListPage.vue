<script setup lang="ts">
import LocalReplayLibrary from './LocalReplayLibrary.vue'
import LiveReplayList from './LiveReplayList.vue'
import { canUseLocalReplayLibrary } from './browser-capabilities'
</script>
<template>
  <LocalReplayLibrary v-if="canUseLocalReplayLibrary()" />
  <LiveReplayList v-else />
</template>
