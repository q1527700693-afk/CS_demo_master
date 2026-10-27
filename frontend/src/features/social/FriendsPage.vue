<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import CommunityNav from '@/components/CommunityNav.vue'
import PlayerIdentity from '@/components/PlayerIdentity.vue'
import AsyncState from '@/components/AsyncState.vue'
import FriendActions from './FriendActions.vue'
import { useAuthStore } from '@/stores/auth'
import { useSocialStore } from '@/stores/social'
import { searchPlayers } from './api'
import { communityError } from './errors'
import type { SearchPlayer } from './types'
const auth = useAuthStore()
const social = useSocialStore()
const router = useRouter()
const tab = ref<'friends' | 'incoming' | 'outgoing'>('friends')
const query = ref('')
const searched = ref('')
const results = ref<SearchPlayer[]>([])
const searchLoading = ref(false)
const searchError = ref('')
const searchPage = ref(1)
const searchTotal = ref(0)
const friendPage = ref(1)
const playerId = ref('')
const idError = ref('')
let revision = 0
let controller: AbortController | undefined
const tabs = computed(() => [
  { id: 'friends' as const, label: '我的好友', count: social.friends.length },
  { id: 'incoming' as const, label: '收到的申请', count: social.incoming.length },
  { id: 'outgoing' as const, label: '发出的申请', count: social.outgoing.length },
])
const rows = computed(() =>
  tab.value === 'friends'
    ? social.friends
        .slice((friendPage.value - 1) * 10, friendPage.value * 10)
        .map((x) => ({ user: x.user, date: x.friends_since }))
    : social[tab.value].map((x) => ({ user: x.user, date: x.created_at })),
)
watch(
  () => social.friends.length,
  (total) => {
    friendPage.value = Math.min(friendPage.value, Math.max(1, Math.ceil(total / 10)))
  },
)
async function search(page = 1) {
  const q = (page === 1 ? query.value : searched.value).trim()
  if (q.length < 2 || q.length > 32) {
    searchError.value = '请输入 2–32 个字符的用户名或昵称。'
    return
  }
  const current = ++revision
  controller?.abort()
  controller = new AbortController()
  searchLoading.value = true
  searchError.value = ''
  try {
    const data = await searchPlayers(q, page, controller.signal)
    if (current !== revision) return
    searched.value = q
    results.value = data.items
    searchTotal.value = data.total
    searchPage.value = page
  } catch (error) {
    if (current === revision) searchError.value = communityError(error)
  } finally {
    if (current === revision) searchLoading.value = false
  }
}
function openCard() {
  idError.value = ''
  const id = playerId.value.trim()
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    idError.value = '请输入有效的数字玩家 ID。'
    return
  }
  void router.push(`/players/${id}`)
}
function refresh() {
  void social.refresh()
  if (searched.value) void search(searchPage.value)
}
onMounted(refresh)
onBeforeUnmount(() => {
  revision++
  controller?.abort()
})
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">PLAY BETTER TOGETHER</div>
      <h1>玩家与好友<span class="orange">.</span></h1>
      <p>先认识彼此，再一起上场。名片、好友与车队，在这里连接。</p>
    </div>
    <RouterLink v-if="auth.user" :to="`/players/${auth.user.id}`" class="button secondary compact"
      ><AppIcon name="user" :size="16" />我的名片</RouterLink
    >
  </section>
  <CommunityNav />
  <div class="social-layout">
    <section class="panel people-panel" aria-label="好友管理">
      <div class="section-topline">
        <div>
          <span class="eyebrow">YOUR TEAMMATES</span>
          <h2>把默契留下来</h2>
        </div>
        <button
          class="button secondary compact"
          :disabled="social.loading || social.busy !== null"
          @click="refresh"
        >
          刷新
        </button>
      </div>
      <div class="social-tabs" aria-label="好友分类">
        <button
          v-for="item in tabs"
          :key="item.id"
          :class="{ selected: tab === item.id }"
          :aria-pressed="tab === item.id"
          @click="tab = item.id"
        >
          {{ item.label }} <span>{{ item.count }}</span>
        </button>
      </div>
      <div v-if="!social.available" class="state-panel">好友功能需要登录真实账号。</div>
      <AsyncState
        v-else
        :loading="social.loading && !social.ready"
        :error="social.error"
        @retry="refresh"
      >
        <div v-if="!rows.length" class="social-empty">
          <AppIcon name="users" :size="40" />
          <h3>{{ tab === 'friends' ? '下一位默契队友，等你认识。' : '暂时没有待处理申请' }}</h3>
          <p>
            {{
              tab === 'friends'
                ? '搜索用户名或昵称，也可以从车队成员名片添加好友。'
                : '新的申请会显示在这里，刷新即可查看最新状态。'
            }}
          </p>
          <RouterLink to="/lobbies" class="text-link"
            >去车队大厅看看 <AppIcon name="arrow" :size="16"
          /></RouterLink>
        </div>
        <article
          v-for="row in rows"
          :key="row.user.user_id"
          class="person-row"
          :data-user-id="row.user.user_id"
        >
          <PlayerIdentity :player="row.user" detail />
          <div class="person-bottom">
            <span class="muted small-text"
              >{{ tab === 'friends' ? '成为好友' : '申请时间' }} ·
              {{ new Date(row.date).toLocaleDateString('zh-CN') }}</span
            ><FriendActions :user-id="row.user.user_id" />
          </div>
        </article>
        <div v-if="tab === 'friends' && social.friends.length > 10" class="pagination">
          <button
            class="button secondary compact"
            :disabled="friendPage === 1"
            @click="friendPage--"
          >
            上一页</button
          ><span>{{ friendPage }} / {{ Math.ceil(social.friends.length / 10) }}</span
          ><button
            class="button secondary compact"
            :disabled="friendPage * 10 >= social.friends.length"
            @click="friendPage++"
          >
            下一页
          </button>
        </div>
      </AsyncState>
    </section>
    <aside class="discovery-column">
      <section class="panel discovery-panel" aria-label="搜索玩家">
        <div class="eyebrow">FIND YOUR TEAMMATES</div>
        <h2>认识新的队友</h2>
        <p class="muted small-text">按用户名或昵称搜索，了解风格，再发送申请。</p>
        <form class="search-form" @submit.prevent="search()">
          <label for="player-search">用户名或昵称</label>
          <div>
            <input
              id="player-search"
              v-model="query"
              required
              minlength="2"
              maxlength="32"
              placeholder="输入至少 2 个字符"
              :disabled="!social.available"
            /><button class="button primary compact" :disabled="searchLoading || !social.available">
              <AppIcon name="search" :size="16" />搜索
            </button>
          </div>
        </form>
        <p v-if="searchError" role="alert" class="error-text">
          {{ searchError }} <button class="text-link" @click="search()">重试</button>
        </p>
        <p v-if="searchLoading" role="status" class="muted small-text">正在搜索…</p>
        <p v-else-if="searched && !searchError" class="search-summary">
          “{{ searched }}” · {{ searchTotal }} 位玩家
        </p>
        <article
          v-for="player in results"
          :key="player.user_id"
          class="person-row search-result"
          :data-user-id="player.user_id"
        >
          <PlayerIdentity :player="player" detail /><FriendActions :user-id="player.user_id" />
        </article>
        <p
          v-if="searched && !searchLoading && !searchError && !results.length"
          class="muted small-text"
        >
          没有找到匹配的玩家，试试其他用户名或昵称。
        </p>
        <div v-if="searchTotal > 20" class="pagination">
          <button
            class="button secondary compact"
            :disabled="searchPage === 1 || searchLoading"
            @click="search(searchPage - 1)"
          >
            上一页</button
          ><span>{{ searchPage }} / {{ Math.ceil(searchTotal / 20) }}</span
          ><button
            class="button secondary compact"
            :disabled="searchPage * 20 >= searchTotal || searchLoading"
            @click="search(searchPage + 1)"
          >
            下一页
          </button>
        </div>
      </section>
      <section class="panel discovery-panel">
        <h3>已有玩家 ID？</h3>
        <p class="muted small-text">名片上的数字 ID，可直接打开对方资料。</p>
        <form class="search-form" @submit.prevent="openCard">
          <label for="player-id">玩家 ID</label>
          <div>
            <input
              id="player-id"
              v-model="playerId"
              required
              inputmode="numeric"
              maxlength="16"
              placeholder="例如 1"
            /><button class="button secondary compact">查看名片</button>
          </div>
          <p v-if="idError" role="alert" class="error-text">{{ idError }}</p>
        </form>
      </section>
      <div class="community-tip">
        <AppIcon name="user" :size="20" />
        <p>
          完善游戏水平和组队偏好，让新队友更了解你。<RouterLink to="/profile" class="text-link"
            >编辑个人资料 →</RouterLink
          >
        </p>
      </div>
    </aside>
  </div>
</template>
<style scoped>
.social-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr);
  gap: 24px;
  align-items: start;
}
.people-panel,
.discovery-panel {
  padding: 26px;
  min-width: 0;
}
.section-topline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.section-topline h2,
.discovery-panel h2 {
  margin: 8px 0;
}
.social-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 24px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}
.social-tabs button {
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--muted);
}
.social-tabs button.selected {
  background: #34291f;
  color: var(--orange);
  border-color: #65472f;
}
.social-tabs span {
  margin-left: 5px;
  font-variant-numeric: tabular-nums;
}
.person-row {
  padding: 22px 0;
  border-bottom: 1px solid var(--line);
  display: grid;
  gap: 16px;
}
.person-row:last-child {
  border-bottom: 0;
}
.person-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.social-empty {
  min-height: 340px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 20px;
  text-align: center;
}
.social-empty > svg {
  color: var(--green);
}
.social-empty p {
  max-width: 340px;
  color: var(--muted);
  font-size: 13px;
}
.discovery-column {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.discovery-panel > p {
  margin-top: 10px;
}
.search-form {
  margin-top: 22px;
  display: grid;
  gap: 10px;
}
.search-form label {
  font-size: 12px;
  color: var(--muted);
}
.search-form > div {
  display: flex;
  gap: 10px;
}
.search-form input {
  min-width: 0;
  flex: 1;
}
.search-form button {
  flex-shrink: 0;
}
.search-summary {
  font-size: 12px;
  color: var(--green);
  margin-top: 20px;
  overflow-wrap: anywhere;
}
.pagination {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: center;
  margin-top: 22px;
  font-size: 12px;
}
.community-tip {
  padding: 8px 16px;
  display: flex;
  gap: 14px;
  color: var(--muted);
  font-size: 12px;
}
.community-tip svg {
  flex-shrink: 0;
  color: var(--orange);
}
.community-tip a {
  display: block;
  margin-top: 8px;
}
@media (max-width: 1100px) {
  .social-layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 600px) {
  .people-panel,
  .discovery-panel {
    padding: 20px;
  }
  .social-tabs {
    gap: 0;
  }
  .social-tabs button {
    padding: 8px;
  }
}
</style>
