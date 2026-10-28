<script setup lang="ts">
import { computed } from 'vue'
import type { AiCoachReport } from './contracts'

const props = defineProps<{
  ai: AiCoachReport | null
  loading: boolean
  error: string
}>()
const emit = defineEmits<{ generate: [] }>()

const categoryLabels: Record<string, string> = {
  utility: '道具',
  aim: '枪法',
  movement: '移动',
  decision_making: '决策',
  teamwork: '团队',
  economy: '经济',
  other: '其他',
}
const priorityLabels: Record<string, string> = {
  high: '优先改进',
  medium: '值得关注',
  low: '可继续观察',
}
const showGenerate = computed(
  () => !props.ai || props.ai.ai_status === 'not_generated',
)
</script>

<template>
  <section class="ai-coach review-panel">
    <header class="ai-head">
      <div>
        <p class="ai-kicker">AI COACH</p>
        <h2>AI 教练解读</h2>
        <p class="ai-subtitle">基于本场规则报告生成，只引用已记录的事实与证据。</p>
      </div>
      <span v-if="ai?.ai_status === 'completed'" class="ai-model">
        {{ ai.model || '已生成' }}
      </span>
    </header>

    <p v-if="error" role="alert" class="ai-alert">{{ error }}</p>

    <div v-if="ai?.ai_status === 'not_configured'" class="ai-notice">
      <strong>AI 教练尚未配置</strong>
      <p>服务器没有配置模型 API Key。规则报告、回合复盘和详细数据仍可正常使用。</p>
    </div>

    <div v-else-if="showGenerate && !error" class="ai-generate">
      <strong>生成一份针对性的提升建议</strong>
      <p>会分析本场的道具使用、闪光、死亡上下文和规则发现。生成可能需要约 30–60 秒。</p>
      <button class="button primary" :disabled="loading" @click="emit('generate')">
        {{ loading ? 'AI 分析中…' : '生成 AI 教练解读' }}
      </button>
    </div>

    <template v-if="ai?.ai_status === 'completed'">
      <article class="ai-summary">
        <p class="ai-kicker">本场总结</p>
        <p>{{ ai.summary || '本场没有生成总结。' }}</p>
      </article>

      <section class="ai-block">
        <div class="ai-block-head">
          <h3>需要提升的地方</h3>
          <span>{{ ai.improvement_areas?.length || 0 }} 项</span>
        </div>
        <p v-if="!ai.improvement_areas?.length" class="ai-empty">本场没有提取到可执行的改进点。</p>
        <div class="ai-grid">
          <article
            v-for="area in ai.improvement_areas"
            :key="`${area.title}-${area.evidence_ids.join('-')}`"
            class="ai-area"
          >
            <div class="ai-area-meta">
              <span class="ai-priority" :class="`priority-${area.priority}`">
                {{ priorityLabels[area.priority] || area.priority }}
              </span>
              <span class="ai-category">{{ categoryLabels[area.category] || area.category }}</span>
            </div>
            <h4>{{ area.title }}</h4>
            <p>{{ area.explanation }}</p>
            <div class="ai-evidence">
              <span>证据</span>
              <code v-for="id in area.evidence_ids" :key="id">{{ id }}</code>
            </div>
            <div class="ai-training">
              <span>建议练习</span>
              <ul>
                <li v-for="item in area.training" :key="item">{{ item }}</li>
              </ul>
            </div>
          </article>
        </div>
      </section>

      <section v-if="ai.strengths?.length" class="ai-block">
        <div class="ai-block-head"><h3>做得好的地方</h3><span>{{ ai.strengths.length }} 项</span></div>
        <div class="ai-grid">
          <article v-for="strength in ai.strengths" :key="strength.title" class="ai-area ai-strength">
            <h4>{{ strength.title }}</h4>
            <p>{{ strength.explanation }}</p>
            <div v-if="strength.evidence_ids.length" class="ai-evidence">
              <span>证据</span>
              <code v-for="id in strength.evidence_ids" :key="id">{{ id }}</code>
            </div>
          </article>
        </div>
      </section>

      <section v-if="ai.data_limitations?.length" class="ai-block">
        <div class="ai-block-head"><h3>数据限制</h3></div>
        <ul class="ai-limitations">
          <li v-for="item in ai.data_limitations" :key="item">{{ item }}</li>
        </ul>
      </section>

      <footer class="ai-footer">
        <span>模型：{{ ai.model || '—' }}</span>
        <span>提示词版本：{{ ai.prompt_version || '—' }}</span>
        <button class="review-text-button" :disabled="loading" @click="emit('generate')">
          重新生成
        </button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.ai-coach {
  padding: 24px;
  display: grid;
  gap: 18px;
}
.ai-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.ai-kicker {
  margin: 0 0 6px;
  color: var(--accent, #ff9a55);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
}
.ai-head h2 {
  margin: 0;
  font-size: 24px;
}
.ai-subtitle {
  margin: 6px 0 0;
  color: var(--muted, #8d97a8);
  font-size: 13px;
}
.ai-model {
  border: 1px solid rgba(255, 154, 85, 0.35);
  border-radius: 999px;
  padding: 5px 10px;
  color: #ffb27d;
  font-size: 11px;
  white-space: nowrap;
}
.ai-alert {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid rgba(255, 100, 100, 0.4);
  border-radius: 10px;
  color: #ffb0b0;
  background: rgba(255, 80, 80, 0.08);
}
.ai-notice,
.ai-generate,
.ai-summary,
.ai-block {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: 18px;
  background: rgba(255, 255, 255, 0.025);
}
.ai-notice strong,
.ai-generate strong {
  display: block;
  margin-bottom: 6px;
}
.ai-notice p,
.ai-generate p {
  margin: 0 0 14px;
  color: var(--muted, #8d97a8);
  font-size: 13px;
}
.ai-summary p:last-child {
  margin: 0;
  line-height: 1.8;
  font-size: 15px;
}
.ai-block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.ai-block-head h3 {
  margin: 0;
  font-size: 16px;
}
.ai-block-head span {
  color: var(--muted, #8d97a8);
  font-size: 12px;
}
.ai-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.ai-area {
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 12px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.12);
}
.ai-area h4 {
  margin: 8px 0;
  font-size: 15px;
}
.ai-area > p {
  color: var(--muted, #9aa4b6);
  font-size: 13px;
  line-height: 1.65;
}
.ai-area-meta,
.ai-evidence,
.ai-training > span {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.ai-priority,
.ai-category {
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
}
.priority-high {
  color: #ffb0b0;
  background: rgba(255, 80, 80, 0.16);
}
.priority-medium {
  color: #ffd18b;
  background: rgba(255, 183, 77, 0.13);
}
.priority-low {
  color: #a6d9ff;
  background: rgba(80, 160, 255, 0.13);
}
.ai-category {
  color: var(--muted, #9aa4b6);
  background: rgba(255, 255, 255, 0.06);
}
.ai-evidence {
  margin: 10px 0;
  color: var(--muted, #8d97a8);
  font-size: 11px;
}
.ai-evidence code {
  border-radius: 5px;
  padding: 2px 5px;
  color: #b7c9df;
  background: rgba(255, 255, 255, 0.07);
  font-size: 10px;
}
.ai-training {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 10px;
  color: var(--muted, #8d97a8);
  font-size: 12px;
}
.ai-training ul,
.ai-limitations {
  margin: 7px 0 0;
  padding-left: 18px;
  color: #c0c9d8;
  line-height: 1.7;
}
.ai-strength {
  border-color: rgba(90, 200, 150, 0.2);
}
.ai-empty {
  color: var(--muted, #8d97a8);
  font-size: 13px;
}
.ai-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px;
  color: var(--muted, #8d97a8);
  font-size: 11px;
}
.ai-footer button {
  margin-left: auto;
}
@media (max-width: 760px) {
  .ai-coach {
    padding: 16px;
  }
  .ai-grid {
    grid-template-columns: 1fr;
  }
  .ai-head {
    flex-direction: column;
  }
}
</style>
