<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import AsyncState from '@/components/AsyncState.vue'
import CommunityNav from '@/components/CommunityNav.vue'
import PlayerIdentity from '@/components/PlayerIdentity.vue'
import {
  createLobby,
  getLobby,
  claimLobby,
  cancelClaim,
  departLobby,
  deleteLobby,
  kickClaimant,
  listLobbies,
} from './api'
import { lobbyModes } from './types'
import type { Lobby, LobbyInput, LobbyMode } from './types'
import { getMyProfile } from '@/features/profile/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { communityError } from '@/features/social/errors'
import { mockModules } from '@/app/config'
const auth = useAuthStore()
const toast = useToastStore()
const router = useRouter()
const route = useRoute()
const loading = ref(true)
const error = ref('')
const items = ref<Lobby[]>([])
const page = ref(1)
const total = ref(0)
const mode = ref<LobbyMode | ''>('')
const creating = ref(false)
const saving = ref(false)
const formError = ref('')
const profileHint = ref('')
const busy = ref(false)
const detail = ref<Lobby | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const form = reactive<LobbyInput>({
  title: '',
  description: '',
  mode: 'competitive',
  map: '',
  region: '',
  skill_level: '',
  team_size: 5,
  current_players: 1,
  team_code: '',
})
const pages = computed(() => Math.max(1, Math.ceil(total.value / 12)))
let revision = 0
let detailRevision = 0
let createRevision = 0
let disposed = false
function requireLogin() {
  if (!auth.user) {
    void router.push({ name: 'login', query: { redirect: route.fullPath } })
    return false
  }
  if (mockModules.auth) {
    toast.show('发布和领码需要使用真实账号登录。', 'error')
    return false
  }
  return true
}
async function load() {
  const current = ++revision
  loading.value = true
  error.value = ''
  try {
    const data = await listLobbies(page.value, mode.value)
    if (current !== revision) return
    items.value = data.items
    total.value = data.total
    if (page.value > pages.value) {
      page.value = pages.value
      return load()
    }
  } catch (cause) {
    if (current === revision) error.value = communityError(cause)
  } finally {
    if (current === revision) loading.value = false
  }
}
async function loadDetail() {
  const current = ++detailRevision
  detail.value = null
  detailError.value = ''
  detailLoading.value = false
  if (!route.query.team) return
  const id = Number(route.query.team)
  if (!Number.isSafeInteger(id) || id < 1) {
    detailError.value = '车队链接无效，请检查车队编号。'
    return
  }
  detailLoading.value = true
  try {
    const result = await getLobby(id)
    if (current === detailRevision) detail.value = result
  } catch (cause) {
    if (current === detailRevision) detailError.value = communityError(cause)
  } finally {
    if (current === detailRevision) detailLoading.value = false
  }
}
function openDetail(id: number) {
  void router.push({ path: '/lobbies', query: { team: String(id) } })
}
function closeDetail() {
  void router.replace({ path: '/lobbies' })
}
async function beginCreate() {
  if (!requireLogin() || saving.value) return
  creating.value = !creating.value
  const version = ++createRevision
  if (!creating.value) return
  formError.value = ''
  profileHint.value = ''
  // A profile is a suggested starting point; never overwrite an edited draft.
  const originalSkill = form.skill_level,
    originalDescription = form.description
  try {
    const profile = await getMyProfile()
    if (version !== createRevision || disposed) return
    if (!originalSkill && form.skill_level === originalSkill)
      form.skill_level = profile.skill_level || ''
    if (!originalDescription && form.description === originalDescription)
      form.description = profile.looking_for || ''
    profileHint.value = '已参考个人资料填写游戏水平和组队说明，可按本次车队调整。'
  } catch {
    if (version === createRevision) profileHint.value = '暂时无法读取个人资料，可直接填写车队信息。'
  }
}
async function create() {
  if (!requireLogin() || saving.value) return
  formError.value = ''
  if (!form.title.trim()) {
    formError.value = '请填写车队名称。'
    return
  }
  if (
    !Number.isInteger(form.team_size) ||
    form.team_size < 2 ||
    form.team_size > 10 ||
    !Number.isInteger(form.current_players) ||
    form.current_players < 1 ||
    form.current_players >= form.team_size
  ) {
    formError.value = '队伍人数应为 2–10 人，当前人数至少 1 人且小于队伍人数。'
    return
  }
  if (
    form.team_code.trim().length < 4 ||
    form.team_code.trim().length > 64 ||
    /[\u0000-\u001f\u007f]/.test(form.team_code)
  ) {
    formError.value = '请填写 4–64 个字符的游戏组队码，不包含换行或控制字符。'
    return
  }
  saving.value = true
  const owner = auth.user?.id
  try {
    const result = await createLobby({
      ...form,
      title: form.title.trim(),
      team_code: form.team_code.trim(),
      description: form.description?.trim() || null,
      map: form.map?.trim() || null,
      region: form.region?.trim() || null,
      skill_level: form.skill_level?.trim() || null,
    })
    if (disposed || owner !== auth.user?.id) return
    creating.value = false
    form.title = ''
    form.team_code = ''
    page.value = 1
    mode.value = ''
    toast.show('车队已发布，队友领取后可查看组队码')
    openDetail(result.id)
    await load()
  } catch (cause) {
    if (!disposed && owner === auth.user?.id) formError.value = communityError(cause)
  } finally {
    saving.value = false
  }
}
async function act(
  lobby: Lobby,
  action: 'claim' | 'cancel' | 'depart' | 'delete' | 'kick',
  userId?: number,
) {
  if (!requireLogin() || busy.value) return
  const confirmations = {
    depart: '确认发车？车队将从大厅隐藏并停止领码。',
    delete: '确认删除这条车队招募？',
    kick: '确认移除这位领码成员？对方将无法再次领取该车队组队码。',
  }
  if (
    action in confirmations &&
    !window.confirm(confirmations[action as keyof typeof confirmations])
  )
    return
  busy.value = true
  const owner = auth.user?.id
  try {
    let updated: Lobby | null = null
    if (action === 'claim') updated = (await claimLobby(lobby.id)).lobby
    if (action === 'cancel') updated = await cancelClaim(lobby.id)
    if (action === 'depart') updated = await departLobby(lobby.id)
    if (action === 'kick' && userId) updated = await kickClaimant(lobby.id, userId)
    if (action === 'delete') await deleteLobby(lobby.id)
    if (disposed || owner !== auth.user?.id) return
    if (action === 'delete' && Number(route.query.team) === lobby.id) closeDetail()
    else if (updated && Number(route.query.team) === lobby.id) {
      // A read begun before this mutation must not restore the old code/claim state.
      detailRevision++
      detailLoading.value = false
      detailError.value = ''
      detail.value = updated
    } else if (action === 'claim') openDetail(lobby.id)
    toast.show(
      {
        claim: '已领取组队码，请在游戏内加入',
        cancel: '已取消领码',
        depart: '已发车，车队已从大厅隐藏',
        delete: '车队招募已删除',
        kick: '已移除领码成员',
      }[action],
    )
    await load()
  } catch (cause) {
    if (disposed || owner !== auth.user?.id) return
    toast.show(communityError(cause), 'error')
    await Promise.all([load(), loadDetail()])
  } finally {
    busy.value = false
  }
}
async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.show(`${label}已复制`)
  } catch {
    toast.show('复制失败，请手动选择并复制。', 'error')
  }
}
function share(id: number) {
  void copy(
    `${window.location.origin}${router.resolve({ path: '/lobbies', query: { team: String(id) } }).href}`,
    '车队链接',
  )
}
function refresh() {
  if (busy.value || saving.value) return
  void load()
  if (route.query.team) void loadDetail()
}
function setMode(value: LobbyMode | '') {
  mode.value = value
  page.value = 1
  void load()
}
function turnPage(value: number) {
  page.value = value
  void load()
}
watch(() => route.query.team, loadDetail, { immediate: true })
watch(
  () => auth.user?.id,
  () => {
    items.value = []
    detail.value = null
    creating.value = false
    form.team_code = ''
    createRevision++
    refresh()
  },
)
onMounted(() => {
  void load()
  window.addEventListener('focus', refresh)
})
onBeforeUnmount(() => {
  disposed = true
  revision++
  detailRevision++
  createRevision++
  window.removeEventListener('focus', refresh)
})
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">FIND YOUR FIVE</div>
      <h1>下一场，一起打<span class="orange">.</span></h1>
      <p>看看队友的名片，领取组队码，把默契带进下一局。</p>
    </div>
    <button class="button primary" :disabled="saving" @click="beginCreate">
      <AppIcon :name="creating ? 'close' : 'plus'" :size="18" />{{
        creating ? '取消发布' : '发布车队'
      }}
    </button>
  </section>
  <CommunityNav />
  <div class="lobby-explainer">
    <AppIcon name="users" :size="22" />
    <div>
      <strong>领取组队码 → 在游戏内加入 → 队长发车</strong>
      <p>领码仅表示有意组队，不会增加游戏内人数。请使用队长提供的组队码进入游戏房间。</p>
    </div>
  </div>
  <section v-if="creating" class="panel lobby-create" aria-label="发布车队">
    <div class="section-topline">
      <h2>发布一条招募</h2>
      <RouterLink to="/profile" class="text-link">编辑个人资料</RouterLink>
    </div>
    <p class="muted small-text">{{ profileHint || '填写本次组队信息，让队友找到你。' }}</p>
    <form class="form-stack" @submit.prevent="create">
      <fieldset :disabled="saving" class="lobby-fields">
        <div class="form-columns">
          <label
            >车队名称<input
              v-model="form.title"
              required
              maxlength="60"
              placeholder="例如：今晚五排，友好沟通"
          /></label>
          <label
            >游戏模式<select v-model="form.mode">
              <option v-for="(label, value) in lobbyModes" :key="value" :value="value">
                {{ label }}
              </option>
            </select></label
          >
          <label
            >地图<input
              v-model="form.map"
              maxlength="32"
              placeholder="选填，例如 Mirage"
              list="lobby-maps"
          /></label>
          <label
            >地区<input v-model="form.region" maxlength="32" placeholder="选填，例如 华东"
          /></label>
          <label
            >游戏水平<input
              v-model="form.skill_level"
              maxlength="32"
              placeholder="选填，例如 完美 C+ / 5E 2200"
          /></label>
          <label
            >游戏组队码<input
              v-model="form.team_code"
              required
              minlength="4"
              maxlength="64"
              autocomplete="off"
              placeholder="4–64 个字符，领取后才对队友显示"
          /></label>
          <label
            >队伍人数<input
              v-model.number="form.team_size"
              type="number"
              required
              min="2"
              max="10"
              step="1"
          /></label>
          <label
            >当前游戏内人数<input
              v-model.number="form.current_players"
              type="number"
              required
              min="1"
              :max="form.team_size - 1"
              step="1"
          /></label>
        </div>
        <label
          >组队说明<textarea
            v-model="form.description"
            rows="3"
            maxlength="300"
            placeholder="选填，说明开打时间、需要的位置或沟通偏好"
          />
        </label>
      </fieldset>
      <datalist id="lobby-maps">
        <option
          v-for="map in ['Mirage', 'Inferno', 'Dust II', 'Nuke', 'Ancient', 'Anubis', 'Vertigo']"
          :key="map"
        >
          {{ map }}
        </option>
      </datalist>
      <p v-if="formError" class="error-text" role="alert">{{ formError }}</p>
      <div class="form-actions">
        <span class="muted small-text">名片和头像沿用个人资料；招募到期后自动下架。</span
        ><button class="button primary" :disabled="saving">
          {{ saving ? '发布中…' : '确认发布' }}
        </button>
      </div>
    </form>
  </section>
  <section v-if="route.query.team" class="panel lobby-detail" aria-label="车队详情">
    <div class="section-topline">
      <h2>车队详情</h2>
      <button class="button secondary compact" @click="closeDetail">收起详情</button>
    </div>
    <AsyncState :loading="detailLoading" :error="detailError" @retry="loadDetail"
      ><template v-if="detail">
        <div class="detail-title">
          <div>
            <span class="eyebrow">TEAM / {{ detail.id }}</span>
            <h2>{{ detail.title }}</h2>
          </div>
          <span :class="['team-state', { departed: detail.status === 'departed' }]">{{
            detail.status === 'departed' ? '已发车' : '招募中'
          }}</span>
        </div>
        <div class="team-tags">
          <span>{{ lobbyModes[detail.mode] }}</span
          ><span>{{ detail.map || '地图不限' }}</span
          ><span>{{ detail.region || '地区不限' }}</span
          ><span>{{ detail.skill_level || '水平不限' }}</span>
        </div>
        <p class="description">{{ detail.description || '队长还没有补充组队说明。' }}</p>
        <div class="detail-columns">
          <div>
            <span class="small-text muted">队长 · 点击查看名片</span
            ><PlayerIdentity :player="detail.owner" />
          </div>
          <div class="team-numbers">
            <strong
              >{{ detail.current_players }} / {{ detail.team_size }}
              <small>游戏内人数</small></strong
            ><span>还缺 {{ detail.slots_needed }} 人 · {{ detail.claim_count }} 人已领码</span
            ><small>{{ new Date(detail.expires_at).toLocaleString('zh-CN') }} 到期</small>
          </div>
        </div>
        <div v-if="detail.team_code" class="team-code">
          <div>
            <span>游戏组队码</span><code data-testid="team-code">{{ detail.team_code }}</code>
          </div>
          <button class="button primary compact" @click="copy(detail.team_code, '组队码')">
            <AppIcon name="copy" :size="15" />复制组队码
          </button>
        </div>
        <p v-else class="code-hint">领取后可查看组队码。领取不会自动加入游戏房间。</p>
        <div class="detail-actions">
          <template v-if="detail.is_owner"
            ><button
              v-if="detail.status === 'open'"
              class="button primary compact"
              :disabled="busy"
              @click="act(detail, 'depart')"
            >
              确认发车</button
            ><button
              class="button secondary compact"
              :disabled="busy"
              @click="act(detail, 'delete')"
            >
              删除招募
            </button></template
          >
          <button
            v-else-if="detail.is_claimed"
            class="button secondary compact"
            :disabled="busy"
            @click="act(detail, 'cancel')"
          >
            取消领码
          </button>
          <button
            v-else-if="detail.can_claim"
            class="button primary compact"
            :disabled="busy"
            @click="act(detail, 'claim')"
          >
            {{ auth.user ? '领取组队码' : '登录后领码' }}
          </button>
          <button class="button secondary compact" @click="share(detail.id)">复制车队链接</button
          ><button
            class="button secondary compact"
            :disabled="busy || detailLoading"
            @click="refresh"
          >
            刷新详情
          </button>
        </div>
        <div class="claimant-heading">
          <h3>
            领码成员 <span class="muted">{{ detail.claim_count }}</span>
          </h3>
          <span class="muted small-text">与游戏内实际成员人数分开显示</span>
        </div>
        <p v-if="!detail.claimants.length" class="muted small-text">暂时还没有人领码。</p>
        <div class="claimants">
          <article v-for="member in detail.claimants" :key="member.user_id" class="claimant">
            <PlayerIdentity :player="member" /><span v-if="member.is_you" class="mine-label"
              >我</span
            ><button
              v-if="detail.is_owner"
              class="button secondary compact"
              :disabled="busy"
              @click="act(detail, 'kick', member.user_id)"
            >
              移除成员
            </button>
          </article>
        </div>
      </template></AsyncState
    >
  </section>
  <div class="lobby-toolbar">
    <div class="mode-filters" aria-label="游戏模式筛选">
      <button :class="{ selected: !mode }" :aria-pressed="!mode" @click="setMode('')">
        全部模式</button
      ><button
        v-for="(label, value) in lobbyModes"
        :key="value"
        :class="{ selected: mode === value }"
        :aria-pressed="mode === value"
        @click="setMode(value)"
      >
        {{ label }}
      </button>
    </div>
    <button class="button secondary compact" :disabled="loading || busy" @click="refresh">
      刷新大厅
    </button>
  </div>
  <AsyncState :loading="loading" :error="error" @retry="load">
    <div class="lobby-count muted small-text">{{ total }} 支招募中的车队 · 按最新发布排序</div>
    <div v-if="!items.length" class="state-panel">
      <AppIcon name="users" :size="32" />
      <h3>好车队，从一次招募开始。</h3>
      <p>当前模式暂无车队，发布你的组队计划吧。</p>
    </div>
    <div class="team-grid">
      <article
        v-for="lobby in items"
        :key="lobby.id"
        class="panel team-card"
        :data-lobby-id="lobby.id"
      >
        <div class="team-card-top">
          <span class="eyebrow">{{ lobbyModes[lobby.mode] }}</span
          ><span class="team-state">{{
            lobby.is_owner ? '我的招募' : lobby.is_claimed ? '已领码' : '招募中'
          }}</span>
        </div>
        <h2>{{ lobby.title }}</h2>
        <div class="team-tags">
          <span>{{ lobby.map || '地图不限' }}</span
          ><span>{{ lobby.skill_level || '水平不限' }}</span
          ><span v-if="lobby.region">{{ lobby.region }}</span>
        </div>
        <p class="description card-description">
          {{ lobby.description || '先看看队长的名片，认识下一位队友。' }}
        </p>
        <PlayerIdentity :player="lobby.owner" />
        <div class="team-capacity">
          <strong
            >{{ lobby.current_players }}<span> / {{ lobby.team_size }}</span></strong
          >
          <div>
            游戏内还缺 {{ lobby.slots_needed }} 人<small>{{ lobby.claim_count }} 人已领码</small>
          </div>
        </div>
        <div class="card-actions">
          <button class="button secondary compact" @click="openDetail(lobby.id)">
            {{ lobby.is_owner ? '管理车队' : lobby.is_claimed ? '查看组队码' : '查看详情' }}</button
          ><button
            v-if="!lobby.is_owner && !lobby.is_claimed"
            class="button primary compact"
            :disabled="busy || !lobby.can_claim"
            @click="act(lobby, 'claim')"
          >
            {{ auth.user ? '领取组队码' : '登录后领码' }}</button
          ><button
            v-else-if="lobby.is_claimed"
            class="button secondary compact"
            :disabled="busy"
            @click="act(lobby, 'cancel')"
          >
            取消领码</button
          ><button v-else class="button secondary compact" @click="share(lobby.id)">
            分享车队
          </button>
        </div>
      </article>
    </div>
    <div v-if="pages > 1" class="pagination">
      <button class="button secondary compact" :disabled="page === 1" @click="turnPage(page - 1)">
        上一页</button
      ><span>{{ page }} / {{ pages }}</span
      ><button
        class="button secondary compact"
        :disabled="page >= pages"
        @click="turnPage(page + 1)"
      >
        下一页
      </button>
    </div>
  </AsyncState>
</template>
<style scoped>
.lobby-explainer {
  display: flex;
  gap: 16px;
  align-items: center;
  background: #202620;
  border: 1px solid #344438;
  padding: 18px 22px;
  border-radius: 8px;
  margin-bottom: 24px;
}
.lobby-explainer > svg {
  color: var(--green);
  flex-shrink: 0;
}
.lobby-explainer strong {
  font-size: 13px;
  font-weight: 500;
}
.lobby-explainer p {
  color: var(--muted);
  font-size: 12px;
  margin-top: 6px;
}
.lobby-create,
.lobby-detail {
  padding: 28px;
  margin-bottom: 24px;
}
.section-topline,
.detail-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.lobby-create > p {
  margin: 14px 0 24px;
}
.lobby-fields {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 20px;
  min-width: 0;
}
.detail-title {
  margin: 26px 0 16px;
}
.detail-title h2 {
  margin-top: 6px;
  font-size: 24px;
  overflow-wrap: anywhere;
}
.team-state {
  color: var(--green);
  background: #26372e;
  padding: 4px 9px;
  border-radius: 5px;
  font-size: 10px;
  flex-shrink: 0;
}
.team-state.departed {
  color: var(--muted);
  background: #303134;
}
.team-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.team-tags span {
  font-size: 11px;
  padding: 4px 9px;
  background: #25282b;
  border: 1px solid #33373a;
  color: #babfc3;
  border-radius: 4px;
  overflow-wrap: anywhere;
}
.description {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
  font-size: 13px;
  color: #b4b9be;
  margin: 18px 0;
}
.detail-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  padding: 22px 0;
  border-top: 1px solid var(--line);
}
.detail-columns > div > .player-identity {
  margin-top: 12px;
}
.team-numbers {
  display: grid;
  align-content: center;
  gap: 8px;
  font-size: 13px;
}
.team-numbers strong {
  font-size: 24px;
}
.team-numbers small {
  font-size: 12px;
  color: var(--muted);
  font-weight: 400;
}
.team-code {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  background: #30271f;
  border: 1px solid #624630;
  padding: 20px;
  border-radius: 8px;
}
.team-code > div {
  min-width: 0;
}
.team-code span {
  display: block;
  font-size: 11px;
  color: #c6a380;
}
.team-code code {
  display: block;
  color: var(--orange);
  font-size: 23px;
  letter-spacing: 1px;
  margin-top: 8px;
  overflow-wrap: anywhere;
  user-select: all;
}
.team-code button {
  flex-shrink: 0;
}
.code-hint {
  color: var(--muted);
  font-size: 12px;
  padding: 18px;
  background: #141618;
  border-radius: 6px;
}
.detail-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 20px;
}
.claimant-heading {
  margin: 28px 0 18px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.claimants {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.claimant {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 7px;
  flex-wrap: wrap;
}
.claimant .player-identity {
  flex: 1;
}
.mine-label {
  color: var(--orange);
  font-size: 11px;
}
.lobby-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.mode-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.mode-filters button {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #191b1d;
  padding: 9px 15px;
  font-size: 12px;
  color: var(--muted);
}
.mode-filters .selected {
  color: var(--orange);
  border-color: #65472f;
  background: #34291f;
}
.lobby-count {
  margin-bottom: 18px;
}
.team-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.team-card {
  padding: 24px;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.team-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.team-card > h2 {
  margin: 22px 0 14px;
  overflow-wrap: anywhere;
  font-size: 18px;
}
.card-description {
  flex: 1;
}
.team-capacity {
  display: flex;
  align-items: center;
  gap: 16px;
  border-top: 1px solid var(--line);
  margin-top: 24px;
  padding-top: 20px;
}
.team-capacity strong {
  font-size: 30px;
  color: var(--orange);
  font-weight: 500;
}
.team-capacity strong span {
  font-size: 18px;
  color: var(--muted);
}
.team-capacity > div {
  font-size: 12px;
}
.team-capacity small {
  display: block;
  color: var(--muted);
  margin-top: 4px;
}
.card-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 20px;
}
.pagination {
  display: flex;
  gap: 18px;
  align-items: center;
  justify-content: center;
  margin-top: 26px;
}
@media (max-width: 1280px) {
  .team-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 750px) {
  .team-grid,
  .detail-columns,
  .claimants {
    grid-template-columns: 1fr;
  }
  .lobby-create,
  .lobby-detail {
    padding: 20px;
  }
  .team-code {
    align-items: start;
    flex-direction: column;
  }
}
</style>
