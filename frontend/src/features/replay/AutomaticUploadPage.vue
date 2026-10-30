<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useUploadTask } from './upload-task'
import ProgressStages from './ProgressStages.vue'
const task = useUploadTask()
const {
  chooseEveryTime,
  desktop,
  parser,
  checkingParser,
  parserError,
  file,
  busy,
  dragging,
  error,
  analysisId,
  players,
  choosingPlayer,
  stages,
  fileLabel,
} = storeToRefs(task)
const { selectPlayer, selectFile, drop, process } = task
const fileInput = ref<HTMLInputElement>()
const route = useRoute()
onMounted(() => {
  task.prepareNew()
  if (typeof route.query.source === 'string' && typeof route.query.target === 'string')
    task.startFromCloud(route.query.source, route.query.target, route.query.force === 'true')
  else task.resume(typeof route.query.task === 'string' ? route.query.task : undefined)
  if (!desktop.value) void task.checkParser()
})
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">MATCH ANALYSIS</div>
      <h1>分析一场比赛<span class="orange">.</span></h1>
      <p>
        {{
          desktop
            ? 'Demo 在本机解析，仅上传分析数据。'
            : '上传原始 Demo，由服务器解析并保存个人报告。'
        }}
      </p>
    </div>
  </section>
  <section class="panel automatic-upload">
    <div class="analysis-channels" aria-label="Demo 解析通道">
      <button class="channel" :class="{ selected: !desktop }" :disabled="desktop">
        <strong>云端解析 Demo</strong
        ><span>{{ desktop ? '应用版已关闭' : '当前可用 · 服务器解析' }}</span>
      </button>
      <button class="channel" :class="{ selected: desktop }" :disabled="!desktop">
        <strong>本地解析 Demo</strong
        ><span>{{ desktop ? '当前可用 · 原始文件留在本机' : '请在应用版中使用' }}</span>
      </button>
    </div>
    <label v-if="desktop" class="local-choice"
      ><input
        v-model="chooseEveryTime"
        type="checkbox"
        :disabled="busy"
      />每次选择要分析的玩家</label
    >
    <div v-if="!desktop" class="cloud-options">
      <p v-if="checkingParser" role="status">正在检测云端解析服务…</p>
      <p v-else-if="parserError" class="error-text" role="alert">
        {{ parserError }}
        <button class="button secondary compact" @click="task.checkParser">重新检测</button>
      </p>
      <p v-else-if="parser?.available" class="muted small-text">
        云端解析可用 · 原始 Demo 最大 512 MiB · AI
        {{ parser.ai?.configured ? '可用' : '暂未配置，规则报告仍可使用' }}
      </p>
      <p class="muted small-text">
        上传后先读取比赛名单，再选择要分析的玩家。不同玩家的报告分别保存。
      </p>
    </div>
    <label
      class="drop-zone"
      :class="{ dragging, busy }"
      @dragover.prevent="dragging = !busy"
      @dragleave.prevent="dragging = false"
      @drop.prevent="drop"
      tabindex="0"
      @keydown.enter.prevent="!busy && fileInput?.click()"
      @keydown.space.prevent="!busy && fileInput?.click()"
      aria-label="上传 Demo 或分析包"
    >
      <span class="drop-symbol" aria-hidden="true">↑</span>
      <strong>{{ busy ? '正在处理比赛…' : '将 Demo 拖到这里，或点击选择文件' }}</strong>
      <span class="muted"
        >支持 .dem（{{ desktop ? '最多 1 GB，本机解析' : '最多 512 MiB，上传服务器' }}）及已有 .zip
        分析包（最多 50 MB）</span
      >
      <span v-if="fileLabel" class="selected-file">{{ fileLabel }}</span>
      <input
        ref="fileInput"
        type="file"
        accept=".dem,.zip"
        :disabled="busy"
        class="file-input"
        aria-label="选择比赛文件"
        @change="
          selectFile(($event.target as HTMLInputElement).files?.[0] || null)
          ;($event.target as HTMLInputElement).value = ''
        "
      />
    </label>
    <div v-if="choosingPlayer" class="player-selection" role="status">
      <label
        >选择本次分析的玩家<select aria-label="选择分析玩家" @change="selectPlayer">
          <option value="" selected disabled>请选择一位玩家，随后自动继续</option>
          <option v-for="p in players" :key="p.player_id" :value="p.player_id">
            {{ p.name }} · {{ p.player_id }}
          </option>
        </select></label
      >
      <p class="muted">选定后会自动完成剩余步骤。</p>
    </div>
    <ProgressStages :stages="stages" />
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <button
      v-if="error && (file || analysisId)"
      class="button primary"
      :disabled="busy"
      @click="process"
    >
      重试
    </button>
    <p v-if="busy && !choosingPlayer" class="muted small-text" role="status">
      可切换到练枪或其他页面，任务会在后台继续。请保持此浏览器标签页打开。
    </p>
  </section>
</template>
<style scoped>
.local-choice {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  font-size: 13px;
}
.local-choice input {
  width: 16px;
}
.analysis-channels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.channel {
  display: grid;
  gap: 8px;
  padding: 18px;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #1b2329;
  color: #b9c4cc;
}
.channel span {
  font-size: 11px;
}
.channel.selected {
  border-color: #c18d59;
  color: #f0bc87;
  background: #29251f;
}
.channel:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.cloud-options {
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
}
.cloud-options label {
  display: grid;
  gap: 8px;
  max-width: 430px;
  font-size: 12px;
}
.automatic-upload {
  padding: 24px;
}
.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 240px;
  padding: 32px 20px;
  border: 1px dashed #59616a;
  border-radius: 12px;
  background: #15191c;
  text-align: center;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.drop-zone:hover,
.drop-zone.dragging {
  border-color: var(--orange);
  background: #27221d;
}
.drop-zone.busy {
  cursor: wait;
  border-style: solid;
}
.drop-symbol {
  font-size: 30px;
  color: var(--orange);
}
.drop-zone strong {
  font-size: 17px;
  font-weight: 600;
}
.drop-zone .muted {
  font-size: 12px;
}
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.selected-file {
  color: var(--orange);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.player-selection {
  margin-top: 22px;
  padding: 20px;
  background: #24201b;
  border: 1px solid #64503c;
  border-radius: 10px;
}
.player-selection label {
  display: grid;
  gap: 12px;
}
.player-selection p {
  font-size: 12px;
  margin-top: 10px;
}
.automatic-upload > .error-text {
  margin-bottom: 16px;
}
@media (max-width: 650px) {
  .automatic-upload {
    padding: 16px;
  }
  .drop-zone {
    padding: 24px 14px;
    min-height: 210px;
  }
  .drop-zone strong {
    font-size: 15px;
  }
}
</style>
