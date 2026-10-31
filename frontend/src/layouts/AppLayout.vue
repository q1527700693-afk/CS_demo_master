<script setup lang="ts">
import { isDesktopRuntime } from '@/app/runtime'
const desktop = isDesktopRuntime()
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import { useSocialStore } from '@/stores/social'
import { useToastStore } from '@/stores/toast'
import { errorMessage } from '@/api/http'
import { featureFlags, hasMocks, mockModules } from '@/app/config'
import { moduleNavigation } from '@/app/modules'
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const social = useSocialStore()
function refreshSocial() {
  if (featureFlags.social) void social.refresh()
}
watch(() => [auth.user?.id, route.fullPath], refreshSocial, { immediate: true })
onMounted(() => window.addEventListener('focus', refreshSocial))
onBeforeUnmount(() => window.removeEventListener('focus', refreshSocial))
const toast = useToastStore()
const mobileOpen = ref(false)
const nav = moduleNavigation
const active = (path: string) =>
  path === '/friends' && route.meta.featureId === 'social'
    ? true
    : path === '/'
      ? route.path === '/'
      : route.path.startsWith(path)
watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false
  },
)
async function signOut() {
  try {
    await auth.signOut()
    toast.show('已退出登录')
  } catch (error) {
    toast.show(errorMessage(error), 'error')
  } finally {
    void router.push('/')
  }
}
</script>
<template>
  <div class="workspace" :class="{ 'training-workspace': route.meta.featureId === 'training' }">
    <button
      v-if="mobileOpen"
      class="sidebar-backdrop"
      aria-label="关闭导航"
      @click="mobileOpen = false"
    />
    <aside class="sidebar" :class="{ open: mobileOpen }">
      <RouterLink to="/" class="brand"
        ><span class="brand-mark"><AppIcon name="crosshair" :size="25" /></span
        ><span>CS DEMO<span class="brand-sub">MASTER</span></span></RouterLink
      >
      <div class="workspace-caption">PLAYER WORKSPACE <span>v1.2.1</span></div>
      <nav aria-label="主导航">
        <RouterLink
          v-for="item in nav"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: active(item.path) }"
          ><AppIcon :name="item.icon" /><span>{{ item.label }}</span
          ><span
            v-if="item.path === '/friends' && social.incoming.length"
            class="tiny-tag"
            :aria-label="`${social.incoming.length} 条好友申请`"
            >{{ social.incoming.length }}</span
          ><span v-if="item.badge" class="tiny-tag">{{ item.badge }}</span></RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <div class="local-note">
          <AppIcon name="shield" /><strong>{{
            desktop ? '你的 Demo，留在本地。' : '上传 Demo，云端复盘。'
          }}</strong>
          <p>
            {{
              desktop ? '上传解析数据，开启下一次进步。' : '选择比赛中的玩家，回看每个关键回合。'
            }}
          </p>
        </div>
        <div class="team-credit"><span class="online-dot" /> SOFTWARE_CLAN <span>1.2.1</span></div>
      </div>
    </aside>
    <div class="workspace-main">
      <header class="topbar">
        <div class="breadcrumb">
          <button class="icon-button mobile-menu" aria-label="打开导航" @click="mobileOpen = true">
            <AppIcon name="menu" /></button
          ><span class="muted">工作台</span><span class="breadcrumb-divider">/</span
          ><strong>{{ route.meta.title }}</strong>
        </div>
        <div class="top-actions">
          <span v-if="hasMocks" class="demo-label">{{
            mockModules.auth && mockModules.profile ? '演示模式' : '部分功能演示'
          }}</span
          ><RouterLink v-if="auth.user && featureFlags.profile" to="/profile" class="user-pill"
            ><UserAvatar :src="auth.user.avatar" :name="auth.user.nickname" /><span>{{
              auth.user.nickname
            }}</span></RouterLink
          ><span v-else-if="auth.user" class="user-pill"
            ><UserAvatar :src="auth.user.avatar" :name="auth.user.nickname" /><span>{{
              auth.user.nickname
            }}</span></span
          ><RouterLink v-else to="/login" class="button secondary compact">登录 / 注册</RouterLink
          ><button
            v-if="auth.user"
            class="icon-button"
            aria-label="退出登录"
            title="退出登录"
            @click="signOut"
          >
            <AppIcon name="logout" :size="18" />
          </button>
        </div>
      </header>
      <main id="main-content" class="main-content"><slot /></main>
      <footer class="page-footer">
        <span>CS DEMO MASTER <span class="muted">/</span> 每一回合，都有答案。</span
        ><span>BUILT BY SOFTWARE_CLAN</span>
      </footer>
    </div>
  </div>
</template>
