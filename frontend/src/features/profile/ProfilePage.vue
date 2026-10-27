<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import AppIcon from '@/components/AppIcon.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import CommunityNav from '@/components/CommunityNav.vue'
import { deleteAvatar, getMyProfile, updateMyProfile, uploadAvatar } from './api'
import { emptyProfileForm, profilePayload, profileToForm, validateAvatar } from './form'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { ApiError, errorMessage } from '@/api/http'
import { trackStartup } from '@/app/startup-tasks'
import type { UserProfile } from '@/types'
import { featureFlags } from '@/app/config'
const auth = useAuthStore()
const toast = useToastStore()
const loading = ref(true)
const saving = ref(false)
const avatarBusy = ref(false)
const error = ref('')
const saveError = ref('')
const avatarError = ref('')
const card = ref<UserProfile | null>(null)
const input = ref<HTMLInputElement | null>(null)
const form = reactive(emptyProfileForm())
const busy = computed(() => saving.value || avatarBusy.value)
const displayName = computed(
  () => card.value?.nickname || card.value?.username || auth.user?.nickname || '新玩家',
)
function syncAvatar(url: string | null) {
  if (card.value && auth.user?.id === String(card.value.user_id)) auth.setAvatar(url)
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    card.value = await getMyProfile()
    Object.assign(form, profileToForm(card.value))
    syncAvatar(card.value.avatar_url)
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    loading.value = false
  }
}
async function save() {
  if (busy.value) return
  saveError.value = ''
  saving.value = true
  try {
    card.value = await updateMyProfile(profilePayload(form))
    Object.assign(form, profileToForm(card.value))
    syncAvatar(card.value.avatar_url)
    toast.show('玩家名片已保存')
  } catch (cause) {
    saveError.value =
      cause instanceof ApiError && cause.code === 40900
        ? '该平台账号已绑定其他用户，请检查后重试'
        : errorMessage(cause)
  } finally {
    saving.value = false
  }
}
async function chooseAvatar(event: Event) {
  const element = event.target as HTMLInputElement
  const file = element.files?.[0]
  element.value = ''
  if (!file || busy.value || !card.value) return
  avatarError.value = ''
  avatarBusy.value = true
  try {
    validateAvatar(file)
    const result = await uploadAvatar(file)
    card.value.avatar_url = result.avatar_url
    syncAvatar(result.avatar_url)
    toast.show('头像已更新')
  } catch (cause) {
    avatarError.value = errorMessage(cause)
  } finally {
    avatarBusy.value = false
  }
}
async function removeAvatar() {
  if (busy.value || !card.value) return
  avatarError.value = ''
  avatarBusy.value = true
  try {
    const result = await deleteAvatar()
    card.value.avatar_url = result.avatar_url
    syncAvatar(result.avatar_url)
    toast.show('头像已删除')
  } catch (cause) {
    avatarError.value = errorMessage(cause)
  } finally {
    avatarBusy.value = false
  }
}
onMounted(() => trackStartup(load()))
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">PLAYER PROFILE</div>
      <h1>让队友认识你<span class="orange">.</span></h1>
      <p>分享你的游戏风格，找到合拍的队友。平台账号可以稍后补充。</p>
    </div>
    <RouterLink
      v-if="auth.user && featureFlags.social"
      :to="`/players/${auth.user.id}`"
      class="button secondary compact"
      >查看我的名片<AppIcon name="arrow" :size="16"
    /></RouterLink>
  </section>
  <CommunityNav />
  <AsyncState :loading="loading" :error="error" @retry="load">
    <div class="profile-layout">
      <aside class="panel profile-preview">
        <UserAvatar :src="card?.avatar_url" :name="displayName" size="large" />
        <h2>{{ displayName }}</h2>
        <p>@{{ card?.username }}</p>
        <span class="rank-badge">{{ form.skill_level || '尚未填写游戏水平' }}</span>
        <p class="profile-bio">{{ form.signature || '写一句话，介绍你的游戏风格。' }}</p>
        <div class="tag-list">
          <span v-if="form.steam_id">Steam</span>
          <span v-else-if="form.steam_friend_code">Steam 好友码</span
          ><span v-if="form.wanmei_id">完美世界</span><span v-if="form['5E_id']">5E</span>
        </div>
        <p class="profile-bio">{{ form.looking_for || '告诉大家，你想找怎样的队友。' }}</p>
        <p class="profile-bio small-text">
          保存后，头像、游戏水平与组队偏好会同步展示在玩家名片和好友列表中；发布车队时可直接参考这些资料。
        </p>
        <div class="profile-community-links">
          <RouterLink v-if="featureFlags.social" to="/friends" class="button secondary compact"
            >管理好友</RouterLink
          >
          <RouterLink v-if="featureFlags.lobby" to="/lobbies" class="button secondary compact"
            >寻找车队</RouterLink
          >
        </div>
      </aside>
      <section class="panel profile-form">
        <div class="panel-heading">
          <h2>我的玩家名片</h2>
          <span class="small-text muted">@{{ card?.username }}</span>
        </div>
        <div class="profile-avatar-editor">
          <UserAvatar :src="card?.avatar_url" :name="displayName" size="large" />
          <div class="avatar-editor-actions">
            <strong>{{ displayName }}</strong>
            <p class="muted small-text">JPEG / PNG / WebP，不超过 2 MB，保存为 512 × 512 头像。</p>
            <div class="avatar-buttons">
              <button
                type="button"
                class="button secondary compact"
                :disabled="busy"
                @click="input?.click()"
              >
                <AppIcon name="upload" :size="16" />{{
                  avatarBusy ? '处理中…' : '上传头像'
                }}</button
              ><button
                v-if="card?.avatar_url"
                type="button"
                class="button secondary compact"
                :disabled="busy"
                @click="removeAvatar"
              >
                删除头像
              </button>
            </div>
          </div>
          <input
            ref="input"
            type="file"
            class="visually-hidden"
            aria-label="选择头像"
            accept="image/jpeg,image/png,image/webp"
            @change="chooseAvatar"
          />
        </div>
        <p v-if="avatarError" class="error-text profile-inline-error" role="alert">
          {{ avatarError }}
        </p>
        <form class="form-stack" @submit.prevent="save">
          <fieldset :disabled="busy" class="profile-fields">
            <div class="profile-section-title">
              <h3>平台账号 <span class="inline-hint">选填</span></h3>
              <p>可以全部留空，先保存游戏风格。Steam ID、完美和 5E 账号不能重复绑定给其他用户。</p>
            </div>
            <label
              >Steam 账号<input
                v-model="form.steam_id"
                maxlength="200"
                placeholder="SteamID64、SteamID2 / 3 或数字主页链接"
              /><span class="small-text muted"
                >此处填写 Steam ID，不是好友码。例如 76561198000000001；自定义 /id/
                主页链接暂不支持。</span
              ></label
            >
            <label
              >Steam 好友码<input
                v-model="form.steam_friend_code"
                aria-label="Steam 好友码"
                inputmode="numeric"
                maxlength="12"
                placeholder="选填，6–12 位数字"
              /><span class="small-text muted"
                >可在 Steam「添加好友」页面查看，与 17 位 SteamID64 分开填写。</span
              >
            </label>
            <div class="form-columns">
              <label
                >完美世界账号<input
                  v-model="form.wanmei_id"
                  maxlength="32"
                  placeholder="2–32 位字母、数字、下划线或横线" /></label
              ><label
                >5E 账号<input
                  v-model="form['5E_id']"
                  maxlength="32"
                  placeholder="2–32 位字母、数字、下划线或横线"
              /></label>
            </div>
            <div class="profile-section-title">
              <h3>游戏风格</h3>
              <p>让队友在组队前多了解你一点。</p>
            </div>
            <label
              >个性签名<textarea
                v-model="form.signature"
                rows="3"
                maxlength="200"
                placeholder="介绍一下你的游戏风格，最多 200 字"
              />
            </label>
            <label
              >游戏水平<input
                v-model="form.skill_level"
                maxlength="32"
                placeholder="例如：完美 C+ / 5E 2200"
            /></label>
            <label
              >想找的队友<textarea
                v-model="form.looking_for"
                rows="2"
                maxlength="100"
                placeholder="例如：周末五排，沟通友好，一起复盘"
              />
            </label>
            <div class="profile-section-title">
              <h3>其他游戏账号 <span class="inline-hint">选填 · 最多 5 个</span></h3>
            </div>
            <div v-for="(row, index) in form.other_game_ids" :key="index" class="other-game-row">
              <label
                >游戏名称<input
                  v-model="row.game"
                  :aria-label="`游戏名称 ${index + 1}`"
                  required
                  maxlength="32"
                  placeholder="例如 Faceit" /></label
              ><label
                >游戏账号<input
                  v-model="row.account"
                  :aria-label="`游戏账号 ${index + 1}`"
                  required
                  maxlength="32"
                  placeholder="该游戏中的账号" /></label
              ><button
                type="button"
                class="icon-button"
                :aria-label="`删除游戏账号 ${index + 1}`"
                @click="form.other_game_ids.splice(index, 1)"
              >
                <AppIcon name="close" :size="17" />
              </button>
            </div>
            <button
              type="button"
              class="button secondary compact add-game"
              :disabled="form.other_game_ids.length >= 5"
              @click="form.other_game_ids.push({ game: '', account: '' })"
            >
              <AppIcon name="plus" :size="16" />添加游戏账号
            </button>
          </fieldset>
          <p v-if="saveError" class="error-text" role="alert">{{ saveError }}</p>
          <div class="form-actions">
            <span class="small-text muted">你的名片可供其他玩家查看，请勿填写私人敏感信息。</span
            ><button class="button primary" :disabled="busy">
              {{ saving ? '保存中…' : '保存资料' }}<AppIcon name="check" :size="17" />
            </button>
          </div>
        </form>
      </section>
    </div>
  </AsyncState>
</template>
<style scoped>
.profile-community-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin-top: 20px;
}
.profile-preview h2,
.profile-preview > p,
.avatar-editor-actions strong {
  overflow-wrap: anywhere;
}
.profile-form .panel-heading {
  flex-wrap: wrap;
}
.profile-fields {
  display: grid;
  gap: 20px;
  min-width: 0;
  border: 0;
  padding: 0;
  margin: 0;
}
.profile-section-title {
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.profile-section-title h3 {
  margin: 0;
  font-size: 14px;
}
.profile-section-title p {
  color: var(--muted);
  font-size: 11px;
  margin: 8px 0 0;
  line-height: 1.8;
}
.profile-avatar-editor {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 22px 28px;
}
.profile-avatar-editor > .avatar {
  flex-shrink: 0;
}
.avatar-editor-actions {
  min-width: 0;
}
.avatar-editor-actions p {
  line-height: 1.8;
}
.avatar-buttons {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.profile-inline-error {
  padding: 0 28px;
}
.other-game-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 12px;
  align-items: end;
  min-width: 0;
}
.other-game-row .icon-button {
  margin-bottom: 5px;
}
.add-game {
  justify-self: start;
}
@media (max-width: 440px) {
  .profile-avatar-editor {
    padding: 18px;
    gap: 14px;
    align-items: flex-start;
  }
  .profile-avatar-editor > .avatar {
    width: 56px;
    height: 56px;
    font-size: 26px;
  }
  .other-game-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .other-game-row label:first-child {
    grid-column: 1 / -1;
  }
}
</style>
