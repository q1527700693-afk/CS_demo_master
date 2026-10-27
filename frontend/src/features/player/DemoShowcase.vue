<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
// The public report/visibility API is not implemented. Do not reuse mock or
// private reports from the signed-in player's replay page on a public card.
defineProps<{ own: boolean }>()
</script>
<template>
  <section class="panel demo-showcase" aria-labelledby="demo-showcase-heading">
    <div class="demo-heading">
      <div>
        <div class="eyebrow">MATCH INSIGHTS</div>
        <h2 id="demo-showcase-heading">Demo 分析档案</h2>
      </div>
      <span class="tiny-tag">待开放</span>
    </div>
    <div class="demo-placeholder">
      <span class="demo-symbol"><AppIcon name="replay" :size="30" /></span>
      <div>
        <h3>把训练进步，带进每一场比赛。</h3>
        <p>
          {{
            own ? '未来可展示你选择公开的 Demo 分析。' : '未来可展示该玩家选择公开的 Demo 分析。'
          }}分析接口接入后，这里将汇总比赛表现、优势与改进建议。
        </p>
      </div>
    </div>
    <div class="demo-slots" aria-label="未来分析展示内容">
      <span>近期比赛表现</span><span>地图与关键数据</span><span>AI 复盘建议</span>
    </div>
  </section>
</template>
<style scoped>
.demo-showcase {
  padding: 28px;
}
.demo-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.eyebrow {
  font-size: 10px;
  margin-bottom: 8px;
}
.demo-placeholder {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 30px 0;
}
.demo-symbol {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  color: #ac927a;
  border: 1px dashed #514332;
  border-radius: 12px;
  background: #27231e;
}
.demo-placeholder h3 {
  font-size: 15px;
}
.demo-placeholder p {
  color: var(--muted);
  font-size: 12px;
  margin-top: 10px;
}
.demo-slots {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.demo-slots span {
  color: #a6abb1;
  font-size: 11px;
  border: 1px dashed #383b3f;
  padding: 10px 16px;
  border-radius: 6px;
}
@media (max-width: 600px) {
  .demo-showcase {
    padding: 20px;
  }
  .demo-placeholder {
    align-items: flex-start;
    gap: 16px;
  }
  .demo-symbol {
    width: 44px;
    height: 44px;
  }
}
</style>
