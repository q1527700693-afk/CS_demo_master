<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import AppIcon from '@/components/AppIcon.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import CommunityNav from '@/components/CommunityNav.vue'
import FriendActions from '@/features/social/FriendActions.vue'
import { getPublicProfile } from '@/features/profile/api'
import { ApiError, errorMessage } from '@/api/http'
import { trackStartup } from '@/app/startup-tasks'
import { featureFlags } from '@/app/config'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { getTrainingBests, TRAINING_RECORDS_CHANGED } from '@/features/training/records'
import type { TrainingBest } from '@/features/training/records'
import type { UserProfile } from '@/types'
import TrainingBests from './TrainingBests.vue'
import DemoShowcase from './DemoShowcase.vue'

const route = useRoute()
const auth = useAuthStore()
const toast = useToastStore()
const player = ref<UserProfile | null>(null)
const loading = ref(true)
const error = ref('')
const records = ref<TrainingBest[]>([])
const own = computed(() => Boolean(player.value && auth.user?.id === String(player.value.user_id)))
const name = computed(() => player.value?.nickname || player.value?.username || '玩家')
const platforms = computed(() =>
  player.value
    ? [
        { label: 'Steam ID', value: player.value.steam_id },
        { label: 'Steam 好友码', value: player.value.steam_friend_code },
        { label: '完美世界', value: player.value.wanmei_id },
        { label: '5E', value: player.value['5E_id'] },
      ]
    : [],
)
let controller: AbortController | undefined
let revision = 0
function refreshRecords() {
  records.value = own.value && auth.user ? getTrainingBests(auth.user) : []
}
async function load() {
  const current = ++revision
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  player.value = null
  records.value = []
  const id = String(route.params.userId || '')
  try {
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
      throw new Error('玩家 ID 无效，请检查名片链接。')
    const result = await getPublicProfile(id, controller.signal)
    if (current !== revision) return
    if (String(result.user_id) !== id) throw new Error('返回的名片与玩家 ID 不一致，请稍后重试。')
    player.value = result
    refreshRecords()
  } catch (cause) {
    if (current !== revision) return
    error.value =
      cause instanceof ApiError && cause.status === 404
        ? '没有找到这位玩家，请检查玩家 ID 或名片链接。'
        : errorMessage(cause)
  } finally {
    if (current === revision) loading.value = false
  }
}
async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.show(`${label}已复制`)
  } catch {
    toast.show('复制失败，请手动选择并复制。', 'error')
  }
}
function copyLink() {
  void copy(window.location.href, '名片链接')
}
watch(
  () => route.params.userId,
  () => trackStartup(load()),
  { immediate: true },
)
watch(() => auth.user, refreshRecords)
onMounted(() => {
  window.addEventListener('storage', refreshRecords)
  window.addEventListener(TRAINING_RECORDS_CHANGED, refreshRecords)
})
onBeforeUnmount(() => {
  revision++
  controller?.abort()
  window.removeEventListener('storage', refreshRecords)
  window.removeEventListener(TRAINING_RECORDS_CHANGED, refreshRecords)
})
</script>
<template>
  <section class="page-heading card-page-heading">
    <div>
      <div class="eyebrow">PLAYER CARD</div>
      <h1>{{ own ? '我的玩家名片' : '玩家名片' }}<span class="orange">.</span></h1>
      <p>游戏风格、平台账号与每一次进步，都在这里。</p>
    </div>
    <RouterLink to="/friends" class="text-link"
      ><AppIcon name="users" :size="17" />玩家与好友</RouterLink
    >
  </section>
  <CommunityNav />
  <AsyncState :loading="loading" :error="error" @retry="load">
    <div v-if="player" :key="player.user_id" class="player-card-page">
      <section class="panel player-hero" aria-label="玩家资料">
        <div class="hero-identity">
          <UserAvatar :src="player.avatar_url" :name="name" size="large" />
          <div class="player-heading">
            <span class="player-id">PLAYER / {{ String(player.user_id).padStart(4, '0') }}</span>
            <h2>{{ name }}</h2>
            <p>@{{ player.username }}</p>
          </div>
        </div>
        <div class="hero-actions">
          <RouterLink
            v-if="own && featureFlags.profile"
            to="/profile"
            class="button primary compact"
            >编辑名片</RouterLink
          >
          <FriendActions v-else-if="!own" :user-id="player.user_id" />
          <button type="button" class="button secondary compact" @click="copyLink">
            <AppIcon name="link" :size="15" />复制名片链接
          </button>
        </div>
        <p class="player-signature">{{ player.signature || '这位玩家还没有留下签名。' }}</p>
        <div class="hero-tags">
          <span v-if="own" class="mine-tag">我的名片</span
          ><span>{{ player.skill_level || '游戏水平未填写' }}</span
          ><span>玩家 ID {{ player.user_id }}</span>
        </div>
      </section>
      <div class="player-details-grid">
        <section class="panel platforms-panel" aria-labelledby="platforms-title">
          <div class="section-top">
            <span class="eyebrow">FIND ME IN GAME</span>
            <h2 id="platforms-title">平台与游戏账号</h2>
          </div>
          <dl class="platform-list">
            <div v-for="platform in platforms" :key="platform.label">
              <dt>{{ platform.label }}</dt>
              <dd>
                <span :class="{ 'not-filled': !platform.value }">{{
                  platform.value || '未填写'
                }}</span
                ><button
                  v-if="platform.value"
                  type="button"
                  class="icon-button"
                  :aria-label="`复制${platform.label}`"
                  @click="copy(platform.value, platform.label)"
                >
                  <AppIcon name="copy" :size="15" />
                </button>
              </dd>
            </div>
          </dl>
          <div v-if="player.other_game_ids.length" class="other-platforms">
            <span v-for="(game, index) in player.other_game_ids" :key="index"
              ><strong>{{ game.game }}</strong
              >{{ game.account }}</span
            >
          </div>
        </section>
        <section class="panel squad-panel" aria-labelledby="squad-title">
          <div class="section-top">
            <span class="eyebrow">LOOKING FOR A SQUAD</span>
            <h2 id="squad-title">想找怎样的队友</h2>
          </div>
          <AppIcon name="users" :size="32" />
          <p>
            {{
              player.looking_for ||
              '还没有填写组队偏好。一起训练、复盘，也许就是下一支好车队的开始。'
            }}
          </p>
          <RouterLink v-if="featureFlags.lobby" to="/lobbies" class="squad-footnote text-link"
            >去车队大厅，找到一起上场的队友 →</RouterLink
          >
        </section>
      </div>
      <TrainingBests :records="records" :own="own" />
      <DemoShowcase :key="String(player?.user_id)" :own="own" :user-id="String(player?.user_id)" />
    </div>
  </AsyncState>
</template>
<style scoped>
.player-card-page {
  display: grid;
  gap: 22px;
}
.card-page-heading {
  flex-wrap: wrap;
}
.player-hero {
  position: relative;
  overflow: hidden;
  padding: 34px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 22px;
  background: radial-gradient(ellipse at top right, #363026 0%, #202322 35%, #191b1d 75%);
}
.hero-identity {
  display: flex;
  gap: 24px;
  align-items: center;
  min-width: 0;
}
.hero-identity > .avatar {
  flex-shrink: 0;
  margin-bottom: 0;
}
.player-heading {
  min-width: 0;
}
.player-id {
  color: #b99776;
  font-size: 10px;
  letter-spacing: 2px;
}
.player-heading h2 {
  font-size: 28px;
  line-height: 1.4;
  margin: 7px 0 4px;
  overflow-wrap: anywhere;
}
.player-heading p {
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.hero-actions {
  display: flex;
  gap: 10px;
  align-items: start;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.player-signature {
  grid-column: 1 / -1;
  max-width: 800px;
  font-size: 15px;
  line-height: 1.9;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.hero-tags {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  grid-column: 1 / -1;
}
.hero-tags > span {
  font-size: 10px;
  padding: 5px 10px;
  border: 1px solid #3d403b;
  color: #bfc1b8;
  border-radius: 5px;
  background: #252824;
}
.hero-tags .mine-tag {
  color: var(--orange);
  border-color: #695039;
  background: #352b21;
}
.player-details-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 22px;
}
.platforms-panel,
.squad-panel {
  padding: 28px;
  min-width: 0;
}
.section-top .eyebrow {
  font-size: 9px;
  margin-bottom: 8px;
  display: block;
}
.platform-list {
  margin: 24px 0 0;
}
.platform-list > div {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--line);
  padding: 12px 0;
  min-height: 53px;
}
.platform-list > div:last-child {
  border-bottom: 0;
}
.platform-list dt {
  color: var(--muted);
  font-size: 12px;
}
.platform-list dd {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
}
.platform-list dd > span {
  overflow-wrap: anywhere;
}
.platform-list .icon-button {
  flex-shrink: 0;
}
.not-filled {
  color: #72777d;
}
.other-platforms {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}
.other-platforms > span {
  display: inline-flex;
  gap: 8px;
  overflow-wrap: anywhere;
  font-size: 11px;
  border: 1px solid var(--line);
  padding: 7px 10px;
  border-radius: 5px;
  max-width: 100%;
}
.other-platforms strong {
  color: var(--orange);
  font-weight: 400;
}
.squad-panel > svg {
  color: #849c91;
  margin-top: 32px;
}
.squad-panel > p {
  font-size: 14px;
  line-height: 1.9;
  margin-top: 18px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.squad-footnote {
  display: block;
  color: var(--muted);
  font-size: 11px;
  margin-top: 28px;
  line-height: 1.8;
}
@media (max-width: 1100px) {
  .player-hero {
    grid-template-columns: 1fr;
  }
  .hero-actions {
    justify-content: start;
  }
  .player-details-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 600px) {
  .player-hero,
  .platforms-panel,
  .squad-panel {
    padding: 22px;
  }
  .hero-identity {
    gap: 17px;
  }
  .hero-identity > .avatar {
    width: 66px;
    height: 66px;
    font-size: 28px;
  }
  .player-heading h2 {
    font-size: 22px;
  }
  .hero-actions .button {
    font-size: 11px;
  }
  .platform-list > div {
    grid-template-columns: 90px minmax(0, 1fr);
  }
}
</style>
