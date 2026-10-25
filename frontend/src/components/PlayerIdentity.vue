<script setup lang="ts">
import UserAvatar from './UserAvatar.vue'
import type { PlayerSummary } from '@/features/social/types'
defineProps<{ player: PlayerSummary; detail?: boolean }>()
</script>
<template>
  <div class="player-identity">
    <RouterLink
      :to="`/players/${player.user_id}`"
      class="identity-link"
      :aria-label="`查看 ${player.nickname || player.username} 的名片`"
    >
      <UserAvatar :src="player.avatar_url" :name="player.nickname || player.username" />
      <div>
        <strong>{{ player.nickname || player.username }}</strong
        ><small>@{{ player.username }} · ID {{ player.user_id }}</small>
      </div>
    </RouterLink>
    <span v-if="player.skill_level" class="rank-badge">{{ player.skill_level }}</span>
    <p v-if="detail && player.signature" class="identity-signature">{{ player.signature }}</p>
    <p v-if="detail && player.looking_for" class="muted small-text">
      想找的队友 · {{ player.looking_for }}
    </p>
  </div>
</template>
<style scoped>
.player-identity {
  min-width: 0;
  display: grid;
  justify-items: start;
  gap: 10px;
  overflow-wrap: anywhere;
}
.identity-link {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.identity-link .avatar {
  flex-shrink: 0;
}
.identity-link strong {
  display: block;
  font-size: 14px;
}
.identity-link:hover strong {
  color: var(--orange);
}
.identity-link small {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 11px;
}
.identity-signature {
  font-size: 13px;
  white-space: pre-wrap;
}
</style>
