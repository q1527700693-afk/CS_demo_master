<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSocialStore } from '@/stores/social'
import { useToastStore } from '@/stores/toast'
import { requestFriend, respondToFriend, cancelFriendRequest, removeFriend } from './api'
import { communityError } from './errors'
const props = defineProps<{ userId: number }>()
const route = useRoute()
const auth = useAuthStore()
const social = useSocialStore()
const toast = useToastStore()
const relation = computed(() => social.relationship(props.userId))
async function act(action: 'send' | 'accept' | 'reject' | 'cancel' | 'remove') {
  if (social.busy !== null || !social.ready) return
  if (action === 'remove' && !window.confirm('确定解除好友关系吗？之后可以重新发送申请。')) return
  const id = props.userId
  try {
    const success = await social.mutate(id, () => {
      if (action === 'send') return requestFriend(id)
      if (action === 'remove') return removeFriend(id)
      const item = (action === 'cancel' ? social.outgoing : social.incoming).find(
        (x) => x.user.user_id === id,
      )
      if (!item) throw new Error('申请已变化，请刷新后重试。')
      return action === 'cancel' ? cancelFriendRequest(item.id) : respondToFriend(item.id, action)
    })
    if (success)
      toast.show(
        {
          send: '好友申请已发送',
          accept: '已成为好友',
          reject: '已拒绝申请',
          cancel: '已撤回申请',
          remove: '已解除好友关系',
        }[action],
      )
  } catch (cause) {
    toast.show(communityError(cause), 'error')
  }
}
</script>
<template>
  <div v-if="String(userId) !== auth.user?.id" class="friend-actions">
    <RouterLink
      v-if="!auth.user"
      :to="{ name: 'login', query: { redirect: route.fullPath } }"
      class="button secondary compact"
      >登录后加好友</RouterLink
    >
    <span v-else-if="!social.available" class="muted small-text">请使用真实账号添加好友</span>
    <button
      v-else-if="!social.ready"
      class="button secondary compact"
      :disabled="social.loading"
      @click="social.refresh()"
    >
      {{ social.loading ? '读取关系…' : '重试好友状态' }}
    </button>
    <template v-else>
      <button
        v-if="relation === 'none'"
        class="button primary compact"
        :disabled="social.busy !== null"
        @click="act('send')"
      >
        添加好友
      </button>
      <template v-else-if="relation === 'incoming_request'">
        <button
          class="button primary compact"
          :disabled="social.busy !== null"
          @click="act('accept')"
        >
          接受申请
        </button>
        <button
          class="button secondary compact"
          :disabled="social.busy !== null"
          @click="act('reject')"
        >
          拒绝
        </button>
      </template>
      <template v-else-if="relation === 'outgoing_request'">
        <span class="muted small-text">等待对方回应</span>
        <button
          class="button secondary compact"
          :disabled="social.busy !== null"
          @click="act('cancel')"
        >
          撤回申请
        </button>
      </template>
      <template v-else>
        <span class="friend-status">已是好友</span>
        <button
          class="button secondary compact"
          :disabled="social.busy !== null"
          @click="act('remove')"
        >
          解除好友
        </button>
      </template>
    </template>
  </div>
</template>
<style scoped>
.friend-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.friend-status {
  color: var(--green);
  font-size: 12px;
}
</style>
