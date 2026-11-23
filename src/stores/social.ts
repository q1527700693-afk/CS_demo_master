import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from './auth'
import { mockModules } from '@/app/config'
import { getFriends, getFriendRequests } from '@/features/social/api'
import { communityError } from '@/features/social/errors'
import type { Friend, FriendRequest, Relationship } from '@/features/social/types'

export const useSocialStore = defineStore('social', () => {
  const auth = useAuthStore()
  const friends = ref<Friend[]>([])
  const incoming = ref<FriendRequest[]>([])
  const outgoing = ref<FriendRequest[]>([])
  const loading = ref(false)
  const ready = ref(false)
  const error = ref('')
  const busy = ref<number | null>(null)
  const available = computed(() => Boolean(auth.user) && !mockModules.auth)
  let generation = 0
  let pending: Promise<void> | undefined
  function reset() {
    generation++
    pending = undefined
    friends.value = []
    incoming.value = []
    outgoing.value = []
    ready.value = false
    loading.value = false
    busy.value = null
    error.value = ''
  }
  watch(() => auth.user?.id, reset, { flush: 'sync' })
  async function refresh() {
    if (!available.value) return
    if (pending) return pending
    const version = generation
    loading.value = true
    error.value = ''
    pending = (async () => {
      try {
        const [first, requests] = await Promise.all([getFriends(), getFriendRequests()])
        const all = [...first.items]
        for (let page = 2; (page - 1) * first.pageSize < first.total; page++) {
          if (generation !== version) return
          all.push(...(await getFriends(page)).items)
        }
        if (generation !== version) return
        friends.value = all
        incoming.value = requests.incoming
        outgoing.value = requests.outgoing
        ready.value = true
      } catch (cause) {
        if (generation === version) {
          error.value = communityError(cause)
          ready.value = false
        }
      } finally {
        if (generation === version) {
          loading.value = false
          pending = undefined
        }
      }
    })()
    return pending
  }
  function relationship(id: number): Relationship {
    if (friends.value.some((x) => x.user.user_id === id)) return 'friend'
    if (incoming.value.some((x) => x.user.user_id === id)) return 'incoming_request'
    if (outgoing.value.some((x) => x.user.user_id === id)) return 'outgoing_request'
    return 'none'
  }
  async function mutate(id: number, action: () => Promise<unknown>) {
    if (busy.value !== null) return false
    const version = generation
    busy.value = id
    try {
      await action()
      if (version !== generation) return false
      if (pending) await pending
      if (version !== generation) return false
      await refresh()
      return true
    } catch (cause) {
      if (version === generation) {
        if (pending) await pending
        await refresh()
      }
      throw cause
    } finally {
      if (version === generation) busy.value = null
    }
  }
  return {
    friends,
    incoming,
    outgoing,
    loading,
    ready,
    error,
    busy,
    available,
    refresh,
    relationship,
    mutate,
  }
})
