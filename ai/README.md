# CS Demo Master AI

负责提示词设计与结构化日志的 AI 解读。代码位于后端 `backend/src/services/aiAnalysis.js`，本目录只放说明与后续扩展材料。

## 当前实现

| 入口 | 说明 |
| --- | --- |
| `analyze(details)` | ZIP 复盘报告（`report-1.0.0`）的教练解读 |
| `analyzeDemo(details)` | 原始 `.dem` 解析报告的同构解读（`buildDemoFacts` 组织事实） |

两条入口共用：同一份输出 JSON Schema、同一套证据白名单校验、同一组环境变量。

## 设计约束

- **只给事实**：输入是规则层算出的紧凑 JSON（模块指标、规则命中、关键回合、回合经济、走位摘要、数据限制），不含地图点位、原始采样或 Demo 二进制。
- **证据可回溯**：模型输出的每个 `evidence_ids` 必须能在证据索引里查到，否则整个结果被拒绝（`50200`），不写入 `ai-report.json`。
- **不伪造**：提示词明确要求不得编造回合、数值、位置与因果，不得声称看过比赛画面，不输出综合评分。
- **失败隔离**：AI 任务独立入队，供应商超时/报错/返回非法 JSON 只影响 AI 结果，基础报告始终可读。

## 提示词版本

- `coach-1.0.0`（ZIP 报告）
- `coach-1.0.0-demo`（Demo 文件报告，`AI_PROMPT_VERSION` + `-demo`）

修改提示词时必须同步 `AI_PROMPT_VERSION`，否则旧结果无法与新结果区分。

## 输出结构

```json
{
  "ai_status": "completed",
  "analysis_id": "…",
  "model": "deepseek-chat",
  "prompt_version": "coach-1.0.0-demo",
  "generated_at": "…",
  "summary": "…",
  "improvement_areas": [
    { "priority": "high", "category": "utility", "title": "…", "evidence_ids": ["death_0001"], "explanation": "…", "training": ["…"] }
  ],
  "strengths": [{ "title": "…", "evidence_ids": ["kill_0001"], "explanation": "…" }],
  "data_limitations": ["…"]
}
```

前端契约见 `frontend/src/features/replay/contracts.ts` 的 `AiCoachReport`。

## 验证

```bash
cd backend
node tests/aiAnalysis.test.js      # 禁用状态、事实组织、证据校验、Demo 入口
node tests/demoAnalyses.test.js    # Demo 上传 → AI 任务 → 结果读取
```

详细设计见 [docs/ai-demo-analysis-design.md](../docs/ai-demo-analysis-design.md) 第 7 节。
