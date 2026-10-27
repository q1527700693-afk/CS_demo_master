import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getMe, login, register } from '@/features/auth/api'
import { mockModules, TOKEN_KEY } from '@/app/config'
import type { AuthResult, LoginInput, RegisterInput, User } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const initialized = ref(false)
  function syncMockIdentity() {
    if (!mockModules.auth && user.value)
      sessionStorage.setItem('csdm.mock.identity', JSON.stringify(user.value))
  }
  function accept(result: AuthResult) {
    localStorage.setItem(TOKEN_KEY, result.token)
    user.value = result.user
    syncMockIdentity()
  }
  function clear() {
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem('csdm.mock.identity')
    user.value = null
  }
  async function restore() {
    if (initialized.value) return
    if (localStorage.getItem(TOKEN_KEY)) {
      try {
        user.value = await getMe()
        syncMockIdentity()
      } catch {
        clear()
      }
    }
    initialized.value = true
  }
  async function signIn(input: LoginInput) {
    accept(await login(input))
  }
  async function signUp(input: RegisterInput) {
    accept(await register(input))
  }
  async function signOut() {
    // Backend JWTs are stateless and there is no logout endpoint yet.
    clear()
  }
  function setAvatar(avatar: string | null) {
    if (user.value) {
      user.value = { ...user.value, avatar }
      syncMockIdentity()
    }
  }
  return { user, initialized, restore, signIn, signUp, signOut, clear, setAvatar }
})
