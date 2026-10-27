<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { localBase, localHealth, startLocal, localStatus, transfer } from './analysis-api'
import { errorMessage } from '@/api/http'
import { findPlayers, uniqueExactPlayer, type RosterPlayer } from './player-identity'
type ParsedJob = Awaited<ReturnType<typeof localStatus>> & {
  match_id?: string
  map?: string
  round_count?: number
  players?: RosterPlayer[]
  stats?: { steamid: string; kills: number; deaths: number; adr: number }[]
  active_target_player_id?: string
  summary?: { events: number; player_samples: number; keyframes: number; size_bytes: number }
}
const file = ref<File | null>(null),
  token = ref(''),
  nickname = ref(''),
  confirmed = ref(false),
  player = ref('')
const busy = ref(false),
  exporting = ref(false),
  error = ref(''),
  message = ref('等待选择原始 Demo'),
  percent = ref<number | null>(null)
const job = ref<ParsedJob | null>(null),
  zipURL = ref('')
const matches = computed(() => findPlayers(job.value?.players || [], nickname.value))
const selectedPlayer = computed(() => job.value?.players?.find((p) => p.player_id === player.value))
const selectedStats = computed(() => job.value?.stats?.find((s) => s.steamid === player.value))
let disposed = false
function clearZip() {
  if (zipURL.value) URL.revokeObjectURL(zipURL.value)
  zipURL.value = ''
}
watch(nickname, () => {
  player.value = ''
  confirmed.value = false
  clearZip()
})
watch(player, () => {
  confirmed.value = false
  clearZip()
})
function select(value: File | null) {
  file.value = value
  job.value = null
  player.value = ''
  confirmed.value = false
  clearZip()
  error.value = ''
  percent.value = null
  message.value = '等待读取真实玩家名单'
}
async function parse() {
  if (!file.value || busy.value) return
  busy.value = true
  error.value = ''
  job.value = null
  player.value = ''
  confirmed.value = false
  clearZip()
  try {
    if (
      !file.value.name.toLowerCase().endsWith('.dem') ||
      !file.value.size ||
      file.value.size > 1024 ** 3
    )
      throw new Error('请选择非空且不超过 1 GB 的 .dem 文件')
    if (!token.value.trim()) throw new Error('请复制 local_parser/token.txt 内的本机连接令牌')
    message.value = '连接本机工具；第一步只读取名单和回合'
    percent.value = null
    await localHealth(token.value.trim())
    const created = await startLocal(file.value, '', token.value.trim(), (n) => {
      percent.value = n
      message.value = '将文件交给本机工具（只传到 127.0.0.1）'
    })
    while (!disposed) {
      const state = (await localStatus(created.job_id, token.value.trim())) as ParsedJob
      if (disposed) return
      message.value = state.message
      percent.value = state.percent
      if (state.status === 'failed') throw new Error(state.message)
      if (state.status === 'completed') {
        if (!state.players?.length) throw new Error('未返回真实玩家名单，请更新本机工具')
        job.value = state
        player.value = uniqueExactPlayer(state.players, nickname.value)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  } catch (e) {
    error.value = errorMessage(e)
    message.value = '读取名单失败'
    percent.value = null
  } finally {
    busy.value = false
  }
}
async function exportZip() {
  if (!job.value || exporting.value) return
  if (!selectedPlayer.value || !confirmed.value) {
    error.value = '请明确选择并确认分析对象'
    return
  }
  const id = job.value.job_id,
    target = player.value
  exporting.value = true
  error.value = ''
  clearZip()
  message.value = '等待提取选定玩家的详细数据'
  percent.value = null
  try {
    await transfer<{ job_id: string }>(
      `${localBase}/local/jobs/${encodeURIComponent(id)}/exports`,
      token.value.trim(),
      () => {},
      {
        json: {
          target_player_id: target,
          nickname_query: nickname.value.trim(),
          identity_confirmed: true,
        },
      },
    )
    while (!disposed) {
      const state = (await localStatus(id, token.value.trim())) as ParsedJob
      if (disposed) return
      message.value = state.message
      percent.value = state.percent
      if (state.status === 'failed') throw new Error(state.message)
      if (state.status === 'completed' && state.stage === 'exported') {
        if (state.active_target_player_id !== target)
          throw new Error('返回数据与选定玩家不一致，已停止下载')
        job.value = state
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
    if (disposed) return
    const blob = await transfer<Blob>(
      `${localBase}/local/jobs/${encodeURIComponent(id)}/package?target_player_id=${encodeURIComponent(target)}`,
      token.value.trim(),
      (n) => {
        percent.value = n
      },
      { blob: true },
    )
    if (disposed) return
    zipURL.value = URL.createObjectURL(blob)
    message.value = '选定玩家的详细 ZIP 已生成，未上传云端'
    percent.value = 100
  } catch (e) {
    error.value = errorMessage(e)
    message.value = '详细导出失败'
    percent.value = null
  } finally {
    exporting.value = false
  }
}
onUnmounted(() => {
  disposed = true
  clearZip()
})
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">LOCAL PLAYER ANALYSIS</div>
      <h1>确认玩家，再分析<span class="orange">.</span></h1>
      <p>读取名单 → 昵称定位与身份确认 → 提取详细基础数据 → ZIP。</p>
    </div>
  </section>
  <section class="panel local-export">
    <p class="muted">
      先运行 start-local-parser.cmd；本机
      {{ localBase }} 处理文件。名单读取完成后才选择对象，详细计算只围绕该玩家及必要关联信息。
    </p>
    <label
      >本机连接令牌<input
        v-model="token"
        type="password"
        autocomplete="off"
        :disabled="busy || exporting"
        placeholder="复制 local_parser/token.txt 的内容"
    /></label>
    <label
      >自己的游戏昵称 / SteamID<input
        v-model="nickname"
        maxlength="100"
        :disabled="busy || exporting"
        placeholder="输入昵称查找；同名时根据 SteamID 选择"
    /></label>
    <label
      >选择原始 .dem（最多 1 GB）<input
        type="file"
        accept=".dem"
        :disabled="busy || exporting"
        @change="select(($event.target as HTMLInputElement).files?.[0] || null)"
    /></label>
    <button class="button primary" :disabled="!file || busy || exporting" @click="parse">
      {{ busy ? '正在读取真实名单…' : '读取玩家名单' }}
    </button>
    <div class="local-progress" aria-live="polite">
      <p>
        {{ message }}<span v-if="percent !== null"> · {{ percent }}%</span>
      </p>
      <progress
        max="100"
        :value="percent === null ? undefined : percent"
        aria-label="本地处理进度"
      />
    </div>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
    <template v-if="job">
      <h2>{{ job.map }} · {{ job.round_count }} 个已记录回合</h2>
      <p class="muted">
        共 {{ job.players?.length }} 名玩家，{{ matches.length }}
        名符合查询。昵称用于定位；此确认不代表验证了 Steam 账号所有权。
      </p>
      <label
        >选择要分析的玩家<select
          v-model="player"
          :disabled="exporting"
          aria-label="选择要分析的玩家"
        >
          <option value="" disabled>请选择具体玩家</option>
          <option v-for="p in matches" :key="p.player_id" :value="p.player_id">
            {{ p.name }} · {{ p.player_id }}
          </option>
        </select></label
      >
      <p v-if="!matches.length" class="error-text">
        没有匹配玩家，请修改昵称，或清空查询查看全部名单。
      </p>
      <label v-if="selectedPlayer" class="identity-confirmation"
        ><input v-model="confirmed" type="checkbox" :disabled="exporting" />确认以
        {{ selectedPlayer.name }}（{{ selectedPlayer.player_id }}）作为分析对象</label
      >
      <p v-if="selectedStats">
        击杀 {{ selectedStats.kills }} · 死亡 {{ selectedStats.deaths }} · ADR
        {{ selectedStats.adr?.toFixed(2) ?? '未知' }}
      </p>
      <button
        class="button primary"
        :disabled="exporting || !confirmed || !player"
        @click="exportZip"
      >
        {{ exporting ? '正在提取、计算与打包…' : '计算并导出 ZIP' }}
      </button>
      <a
        v-if="zipURL"
        :href="zipURL"
        :download="`${job.match_id}_${player}.zip`"
        class="button secondary"
        >下载真实分析 ZIP</a
      >
      <p v-if="zipURL && job.summary">
        已导出 {{ job.summary.events }} 条记录、{{
          job.summary.player_samples
        }}
        个目标玩家时序样本、{{ job.summary.keyframes }} 个关键状态；ZIP 约
        {{ (job.summary.size_bytes / 1024).toFixed(1) }} KB。
      </p>
      <p class="muted">
        保留伤害、击杀、开火、闪光对象、物品与经济、炸弹及回合事件、目标状态和关联人物信息。其他玩家不生成完整时序；未知归属道具单列为上下文。反应时间、道具正确率及综合评分尚未计算。
      </p>
    </template>
  </section>
</template>
<style scoped>
.local-export {
  padding: 24px;
  display: grid;
  gap: 20px;
}
.local-export label {
  display: grid;
  gap: 10px;
}
.local-export input,
.local-export select {
  width: 100%;
  min-width: 0;
  padding: 12px;
  border: 1px solid #475154;
  border-radius: 6px;
  background: #161b1e;
  color: inherit;
}
.local-export .button {
  justify-self: start;
}
.local-export p {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.local-progress progress {
  width: 100%;
  accent-color: #f89842;
}
.local-progress {
  padding: 16px;
  background: #151b1e;
  border: 1px solid #394043;
  border-radius: 8px;
}
.local-export .identity-confirmation {
  display: flex;
  align-items: center;
  gap: 10px;
}
.local-export .identity-confirmation input {
  width: auto;
}
</style>
