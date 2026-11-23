<script setup lang="ts">
function reload() {
  window.location.reload()
}
</script>

<template>
  <section class="state-panel full-state" role="alert">
    <h1>页面暂时无法加载</h1>
    <p>可能是连接中断或页面刚刚更新，请刷新后重试。</p>
    <button class="button primary" @click="reload">刷新重试</button>
    <RouterLink to="/" class="text-link">返回总览</RouterLink>
  </section>
</template>
