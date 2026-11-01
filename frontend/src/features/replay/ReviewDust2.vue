<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { errorMessage } from '@/api/http'
import { getCloudDust2Summary, getCloudTeams, isCloudAnalysis } from './cloud-api'
import type { CloudTeam, Dust2Summary } from './contracts'

const props = defineProps<{
  analysisId: string
  map: string
}>()

const teams = ref<CloudTeam[]>([])
const selectedTeam = ref('')
const summary = ref<Dust2Summary | null>(null)
const loadingTeams = ref(false)
const loadingSummary = ref(false)
const teamsError = ref('')
const summaryError = ref('')
let requestRevision = 0

const supported = computed(() => props.map === 'de_dust2')
const cloud = computed(() => isCloudAnalysis(props.analysisId))
const selectedRoster = computed(
  () => teams.value.find((team) => team.team_clan_name === selectedTeam.value) || null,
)
const profile = computed(() => summary.value?.scout_defense_profile || null)

function numberText(value: number | null | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function percent(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'
}

async function loadTeams() {
  teamsError.value = ''
  summaryError.value = ''
  summary.value = null
  teams.value = []
  selectedTeam.value = ''
  if (!supported.value || !cloud.value) return
  loadingTeams.value = true
  try {
    const result = await getCloudTeams(props.analysisId)
    teams.value = result.teams || []
    selectedTeam.value = teams.value[0]?.team_clan_name || ''
  } catch (error) {
    teamsError.value = errorMessage(error)
  } finally {
    loadingTeams.value = false
  }
}

async function loadSummary() {
  if (!selectedTeam.value || !supported.value || !cloud.value) return
  const revision = ++requestRevision
  summaryError.value = ''
  loadingSummary.value = true
  try {
    const value = await getCloudDust2Summary(props.analysisId, selectedTeam.value, {
      maxRounds: 10,
      scoutRounds: 6,
    })
    if (revision === requestRevision) summary.value = value
  } catch (error) {
    if (revision === requestRevision) {
      summary.value = null
      summaryError.value = errorMessage(error)
    }
  } finally {
    if (revision === requestRevision) loadingSummary.value = false
  }
}

watch(selectedTeam, () => {
  if (selectedTeam.value) void loadSummary()
})

onMounted(loadTeams)
</script>

<template>
  <section class="dust2-review review-panel">
    <header class="dust2-head">
      <div>
        <p class="dust2-kicker">DUST2 / TACTICAL READ</p>
        <h2>战术分析</h2>
        <p class="dust2-subtitle">
          根据前几回合的 CT 站位、回防结果和我方经济/出生位，给出接下来优先打点的候选。
        </p>
      </div>
      <span class="dust2-badge">规则引擎</span>
    </header>

    <div v-if="!supported" class="dust2-notice">
      <strong>目前只支持 Dust2</strong>
      <p>这张地图的战术知识库还没有接入。当前报告其他页面仍可正常查看。</p>
    </div>

    <div v-else-if="!cloud" class="dust2-notice">
      <strong>战术分析暂时只支持云端上传的 .dem</strong>
      <p>ZIP 分析包不会包含全部玩家站位，无法生成 CT 防守画像和打点建议。</p>
    </div>

    <template v-else>
      <div class="dust2-team-picker">
        <div>
          <label for="dust2-team">选择自家队伍</label>
          <p>分析视角以这支队伍为“我方”，另一支队伍作为对手。</p>
        </div>
        <select id="dust2-team" v-model="selectedTeam" :disabled="loadingTeams">
          <option v-if="!teams.length" value="">没有可选队伍</option>
          <option v-for="team in teams" :key="team.team_clan_name" :value="team.team_clan_name">
            {{ team.team_clan_name }} · {{ team.names.map((name) => name.trim()).join(' / ') }}
          </option>
        </select>
      </div>

      <p v-if="loadingTeams" class="dust2-status">正在读取队伍名单…</p>
      <p v-if="teamsError" class="dust2-alert" role="alert">{{ teamsError }}</p>
      <p v-if="loadingSummary" class="dust2-status">正在分析前几回合的 CT 防守习惯…</p>
      <p v-if="summaryError" class="dust2-alert" role="alert">{{ summaryError }}</p>

      <template v-if="summary && !loadingSummary">
        <section class="dust2-profile">
          <div class="dust2-section-head">
            <div>
              <p class="dust2-kicker">SCOUTING REPORT</p>
              <h3>对手防守画像</h3>
            </div>
            <span class="dust2-confidence" :class="`confidence-${profile?.confidence || 'low'}`">
              {{ profile?.confidence === 'medium' ? '中等置信度' : '低置信度' }}
            </span>
          </div>
          <p class="dust2-lede">
            {{ summary.own_team.team_clan_name || summary.own_team.label }} 视角 ·
            观察 {{ profile?.rounds_observed || 0 }} 个 CT 回合
          </p>
          <div class="dust2-metrics">
            <div class="dust2-metric">
              <span>A 初始站位</span>
              <strong>{{ numberText(profile?.initial?.A) }} 人</strong>
            </div>
            <div class="dust2-metric">
              <span>B 初始站位</span>
              <strong>{{ numberText(profile?.initial?.B) }} 人</strong>
            </div>
            <div class="dust2-metric">
              <span>A 守住率</span>
              <strong>{{ percent(profile?.hold_rate?.A) }}</strong>
            </div>
            <div class="dust2-metric">
              <span>B 守住率</span>
              <strong>{{ percent(profile?.hold_rate?.B) }}</strong>
            </div>
            <div class="dust2-metric">
              <span>A 回防时间</span>
              <strong>{{ numberText(profile?.retake_seconds?.A) }} 秒</strong>
            </div>
            <div class="dust2-metric">
              <span>B 回防时间</span>
              <strong>{{ numberText(profile?.retake_seconds?.B) }} 秒</strong>
            </div>
          </div>
          <div class="dust2-signals">
            <p v-for="signal in profile?.signals || []" :key="signal">{{ signal }}</p>
            <p v-if="profile?.weaknesses?.weaker_site">
              当前规则判断：<strong>{{ profile.weaknesses.weaker_site }} 点</strong>更容易被打开。
            </p>
            <p v-else>当前没有明显的单侧弱点，优先准备默认/假打。</p>
          </div>
        </section>

        <section class="dust2-recommendations">
          <div class="dust2-section-head">
            <div>
              <p class="dust2-kicker">ROUND PLAN</p>
              <h3>接下来优先打点</h3>
            </div>
            <span>{{ summary.round_recommendations.length }} 个 T 回合</span>
          </div>
          <p v-if="!summary.round_recommendations.length" class="dust2-status">
            当前没有可分析的 T 回合。
          </p>
          <div v-else class="dust2-round-list">
            <article
              v-for="recommendation in summary.round_recommendations"
              :key="recommendation.round_num"
              class="dust2-round-card"
            >
              <div class="dust2-round-top">
                <span class="dust2-round-number">R{{ recommendation.round_num }}</span>
                <strong>{{ recommendation.recommended_tactic_name }}</strong>
                <span class="dust2-round-site">{{ recommendation.primary_site }} 点</span>
                <span class="dust2-round-confidence">{{
                  recommendation.confidence === 'medium' ? '中等置信度' : '低置信度'
                }}</span>
              </div>
              <div class="dust2-round-body">
                <div class="dust2-score-box">
                  <span>A {{ recommendation.site_scores.A }}</span>
                  <span>B {{ recommendation.site_scores.B }}</span>
                </div>
                <ul>
                  <li v-for="reason in recommendation.reasons" :key="reason">{{ reason }}</li>
                </ul>
              </div>
              <div v-if="recommendation.risks.length" class="dust2-risks">
                <strong>风险</strong>
                <span v-for="risk in recommendation.risks" :key="risk">{{ risk }}</span>
              </div>
            </article>
          </div>
        </section>

        <section class="dust2-weapons">
          <div class="dust2-section-head">
            <div>
              <p class="dust2-kicker">ECONOMY / WEAPON VALUE</p>
              <h3>低成本高影响</h3>
            </div>
            <span>{{ summary.weapon_highlights?.length || 0 }} 条候选</span>
          </div>
          <p v-if="!summary.weapon_highlights?.length" class="dust2-status">
            本场没有提取到冷门武器或低经济高影响击杀。
          </p>
          <div v-else class="dust2-weapon-list">
            <article
              v-for="highlight in summary.weapon_highlights"
              :key="`${highlight.player_name}-${highlight.weapon}-${highlight.rounds.join('-')}`"
              class="dust2-weapon-card"
            >
              <div class="dust2-weapon-head">
                <strong>{{ highlight.player_name.trim() }}</strong>
                <span>{{ highlight.weapon_label }}</span>
              </div>
              <p>{{ highlight.reason }}</p>
              <div class="dust2-weapon-stats">
                <span>{{ highlight.kills }} 杀</span>
                <span v-if="highlight.first_bloods">{{ highlight.first_bloods }} 首杀</span>
                <span v-if="highlight.multi_kill_rounds">{{ highlight.multi_kill_rounds }} 个多杀回合</span>
                <span v-if="highlight.cost != null">约 ${{ highlight.cost }}</span>
              </div>
              <div class="dust2-evidence">
                <span>证据</span>
                <code v-for="id in highlight.evidence_ids.slice(0, 6)" :key="id">{{ id }}</code>
              </div>
            </article>
          </div>
          <div v-if="summary.player_weapon_impact?.length" class="dust2-impact-list">
            <h4>玩家武器影响</h4>
            <div class="dust2-impact-grid">
              <article
                v-for="impact in summary.player_weapon_impact"
                :key="impact.name"
                class="dust2-impact-card"
              >
                <div>
                  <strong>{{ impact.name.trim() }}</strong>
                  <span>{{ impact.team_clan_name || '队伍未记录' }}</span>
                </div>
                <b>{{ impact.weapon_impact_score }}</b>
                <p>
                  {{ impact.kills }} 杀 · {{ impact.first_bloods }} 首杀 ·
                  {{ impact.economy_kills }} 经济局击杀
                </p>
              </article>
            </div>
          </div>
          <div v-if="summary.weapon_transitions?.length" class="dust2-transitions">
            <h4>采样到的武器变化</h4>
            <p class="dust2-status">
              来自玩家快照，不一定是主动拾取或换枪；只作为 AI 的上下文提示。
            </p>
            <div class="dust2-transition-list">
              <span
                v-for="transition in summary.weapon_transitions.slice(0, 10)"
                :key="`${transition.player_name}-${transition.round_num}-${transition.from_label}-${transition.to_label}`"
              >
                R{{ transition.round_num }} {{ transition.player_name.trim() }}：
                {{ transition.from_label }} → {{ transition.to_label }}
              </span>
            </div>
          </div>
          <ul class="dust2-limitations">
            <li v-for="item in summary.weapon_limitations || []" :key="item">{{ item }}</li>
          </ul>
        </section>

        <ul class="dust2-limitations dust2-global-limits">
          <li v-for="item in summary.limitations" :key="item">{{ item }}</li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
.dust2-review {
  padding: 24px;
  display: grid;
  gap: 18px;
}
.dust2-head,
.dust2-section-head,
.dust2-team-picker,
.dust2-round-top,
.dust2-weapon-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}
.dust2-kicker {
  margin: 0 0 6px;
  color: var(--accent, #ff9a55);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
}
.dust2-head h2,
.dust2-section-head h3 {
  margin: 0;
}
.dust2-head h2 {
  font-size: 24px;
}
.dust2-section-head h3 {
  font-size: 19px;
}
.dust2-subtitle,
.dust2-team-picker p,
.dust2-lede {
  margin: 6px 0 0;
  color: var(--muted, #8d97a8);
  font-size: 13px;
  line-height: 1.6;
}
.dust2-badge,
.dust2-confidence {
  border: 1px solid rgba(255, 154, 85, 0.35);
  border-radius: 999px;
  padding: 5px 10px;
  color: #ffb27d;
  font-size: 11px;
  white-space: nowrap;
}
.dust2-confidence.confidence-medium {
  border-color: rgba(106, 210, 157, 0.4);
  color: #8de0b4;
}
.dust2-notice,
.dust2-profile,
.dust2-recommendations,
.dust2-weapons,
.dust2-team-picker {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: 18px;
  background: rgba(255, 255, 255, 0.025);
}
.dust2-notice p {
  margin: 7px 0 0;
  color: var(--muted, #8d97a8);
  font-size: 13px;
}
.dust2-team-picker select {
  min-width: 280px;
  max-width: 55%;
}
.dust2-status {
  margin: 0;
  color: var(--muted, #8d97a8);
  font-size: 13px;
}
.dust2-alert {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid rgba(255, 100, 100, 0.4);
  border-radius: 10px;
  color: #ffb0b0;
  background: rgba(255, 80, 80, 0.08);
}
.dust2-metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.dust2-metric {
  display: grid;
  gap: 5px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}
.dust2-metric span {
  color: var(--muted, #8d97a8);
  font-size: 11px;
}
.dust2-metric strong {
  font-size: 17px;
}
.dust2-signals {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--muted, #aab4c3);
  font-size: 13px;
  line-height: 1.8;
}
.dust2-signals p {
  margin: 0;
}
.dust2-round-list,
.dust2-weapon-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}
.dust2-round-card,
.dust2-weapon-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.025);
}
.dust2-round-number {
  color: #ffb27d;
  font-weight: 700;
}
.dust2-round-top {
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
}
.dust2-round-site,
.dust2-round-confidence {
  border-radius: 999px;
  padding: 3px 8px;
  background: rgba(255, 154, 85, 0.12);
  color: #ffc092;
  font-size: 11px;
}
.dust2-round-confidence {
  background: rgba(255, 255, 255, 0.06);
  color: var(--muted, #aab4c3);
}
.dust2-round-body {
  display: flex;
  gap: 18px;
  margin-top: 12px;
}
.dust2-score-box {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
  align-self: flex-start;
  color: #ffb27d;
  font-weight: 700;
}
.dust2-round-body ul {
  margin: 0;
  padding-left: 18px;
  color: var(--muted, #aab4c3);
  font-size: 13px;
  line-height: 1.7;
}
.dust2-risks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  color: #ffb0b0;
  font-size: 12px;
}
.dust2-risks strong {
  color: #ff8585;
}
.dust2-weapon-head {
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
}
.dust2-weapon-head strong {
  font-size: 15px;
}
.dust2-weapon-head span {
  color: #ffb27d;
  font-size: 12px;
}
.dust2-weapon-card p {
  margin: 8px 0;
  color: var(--muted, #aab4c3);
  font-size: 13px;
  line-height: 1.65;
}
.dust2-weapon-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: #8de0b4;
  font-size: 12px;
}
.dust2-evidence {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  color: var(--muted, #8d97a8);
  font-size: 11px;
}
.dust2-evidence code {
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
}
.dust2-limitations {
  margin: 12px 0 0;
  padding-left: 18px;
  color: var(--muted, #8d97a8);
  font-size: 12px;
  line-height: 1.7;
}
.dust2-global-limits {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 14px;
}
.dust2-impact-list,
.dust2-transitions {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.dust2-impact-list h4,
.dust2-transitions h4 {
  margin: 0 0 10px;
  font-size: 14px;
}
.dust2-impact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.dust2-impact-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 12px;
  padding: 10px 12px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.035);
}
.dust2-impact-card div {
  display: grid;
  gap: 3px;
}
.dust2-impact-card span,
.dust2-impact-card p {
  margin: 0;
  color: var(--muted, #8d97a8);
  font-size: 11px;
}
.dust2-impact-card > b {
  color: #ffb27d;
  font-size: 18px;
}
.dust2-impact-card p {
  grid-column: 1 / -1;
}
.dust2-transition-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dust2-transition-list span {
  padding: 4px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--muted, #aab4c3);
  font-size: 11px;
}
@media (max-width: 760px) {
  .dust2-head,
  .dust2-section-head,
  .dust2-team-picker {
    display: grid;
  }
  .dust2-team-picker select {
    width: 100%;
    max-width: none;
    min-width: 0;
  }
  .dust2-metrics,
  .dust2-impact-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .dust2-round-body {
    display: grid;
  }
}
</style>
