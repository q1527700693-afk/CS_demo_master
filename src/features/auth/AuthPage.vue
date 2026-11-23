<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { mockModules } from '@/app/config'
import { ApiError, errorMessage } from '@/api/http'
const auth = useAuthStore()
const toast = useToastStore()
const route = useRoute()
const router = useRouter()
const registering = ref(false)
const username = ref('')
const password = ref('')
const confirmation = ref('')
const pending = ref(false)
const error = ref('')
function selectTab(value: boolean) {
  registering.value = value
  error.value = ''
}
async function submit() {
  if (pending.value) return
  error.value = ''
  if (registering.value && password.value !== confirmation.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  pending.value = true
  try {
    if (registering.value)
      await auth.signUp({ username: username.value.trim(), password: password.value })
    else await auth.signIn({ username: username.value.trim(), password: password.value })
    toast.show(registering.value ? '注册成功，欢迎加入' : '欢迎回来')
    const target =
      typeof route.query.redirect === 'string' &&
      route.query.redirect.startsWith('/') &&
      !route.query.redirect.startsWith('//') &&
      !route.query.redirect.startsWith('/login')
        ? route.query.redirect
        : registering.value
          ? '/profile'
          : '/'
    await router.replace(target)
  } catch (e) {
    error.value =
      e instanceof ApiError && e.code === 40001
        ? '用户名或密码不正确'
        : e instanceof ApiError && e.code === 40900
          ? '该用户名已被注册'
          : errorMessage(e)
  } finally {
    pending.value = false
  }
}
function demo() {
  registering.value = false
  username.value = 'demo_player'
  password.value = 'Demo123456!'
  void submit()
}
</script>
<template>
  <div class="auth-layout">
    <div class="auth-intro">
      <div class="eyebrow">WELCOME TO THE SQUAD</div>
      <h1>下一次进步，<br />从这里<span class="orange">开始。</span></h1>
      <p>保存你的复盘、记录训练成绩，<br />与校园里的玩家一起变强。</p>
      <div class="auth-emblem" aria-hidden="true"><AppIcon name="crosshair" :size="120" /></div>
    </div>
    <section class="panel auth-panel">
      <div class="tab-bar">
        <button :class="{ selected: !registering }" @click="selectTab(false)">登录</button
        ><button :class="{ selected: registering }" @click="selectTab(true)">注册</button>
      </div>
      <h2>{{ registering ? '创建你的玩家账号' : '回到你的工作台' }}</h2>
      <p class="muted">
        {{ registering ? '创建账号后，继续完善你的玩家名片。' : '使用用户名和密码继续。' }}
      </p>
      <form class="form-stack" @submit.prevent="submit">
        <label
          >用户名<input
            v-model="username"
            autocomplete="username"
            minlength="3"
            maxlength="32"
            pattern="[A-Za-z0-9_]{3,32}"
            title="3–32 位英文字母、数字或下划线"
            required
            placeholder="3–32 位字母、数字或下划线" /></label
        ><label
          >密码<input
            v-model="password"
            type="password"
            :autocomplete="registering ? 'new-password' : 'current-password'"
            minlength="8"
            maxlength="128"
            required
            placeholder="至少 8 位字符"
        /></label>
        <label v-if="registering"
          >确认密码<input
            v-model="confirmation"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            required
            placeholder="再次输入密码"
        /></label>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
        <button class="button primary full-width" :disabled="pending">
          {{ pending ? '请稍候…' : registering ? '创建账号' : '登录'
          }}<AppIcon name="arrow" :size="18" />
        </button>
      </form>
      <template v-if="mockModules.auth"
        ><div class="auth-divider"><span>体验工作台</span></div>
        <button class="button secondary full-width" :disabled="pending" @click="demo">
          使用演示账号进入
        </button>
        <p class="small-text muted auth-note">
          演示注册仅用于本地体验，刷新后请使用演示账号重新登录。
        </p></template
      >
    </section>
  </div>
</template>
