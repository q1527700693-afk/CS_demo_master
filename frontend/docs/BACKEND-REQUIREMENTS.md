# 网页版 v1.1.0 后端交接

## 已适配的 AI 接口

- `GET /api/v1/analyses/:id/ai` 查询 `not_generated | not_configured | completed`。
- `POST /api/v1/analyses/:id/ai` 生成；前端最多等待 90 秒，失败保留重试入口。
- 使用现有 JWT，校验分析所属账号。模型 Key 仅在服务器，响应禁止返回 Key、上游 Authorization 或环境变量。
- 响应保持现有 `summary / improvement_areas / strengths / data_limitations / evidence_ids` 结构。
- 旧报告的 AI 文本不会被前端擅自改写。启用下述新规则后，请重新分析原包，再生成 AI，避免沿用旧的误伤统计。

## 统计修复（与现有接口兼容）

`backend-patch/backend/src/services/` 提供基于 `release/cloud-test@7dfd819` 的两个文件：

- `combatFacts.js`：在内存中修正导入包的统计，原始 ZIP 和证据不变。
- `replayAnalysis.js`：分析版本升为 `rules-1.2.0`，在 AI 所用统计生成之前应用修正；新增 `team_kill` 复盘重点，闪光重点阈值为 0.5 秒。

击杀必须由事件时刻的双方阵营确认是敌我关系，排除自杀、TK、阵营未知和冻结阶段。不能用名单中的固定队伍推算换边后的阵营。TK 独立记录在逐回合 `team_kills`，双方涉及分析玩家时保留重点和证据。有效致盲 `duration >= 0.5` 秒；更短微白仍可查原始事件。此门槛是产品筛选口径，不声称可由时长准确推断转身角度。

`utility.metrics` 增加 `he_damage / fire_damage / utility_team_damage / min_effective_blind_seconds`。伤害优先用 `dmg_health_real`，否则原始 `dmg_health`；HE 和火焰只累计对敌伤害，队伤单列，不根据轨迹邻近推测归属。各接口应明确事件覆盖，未提供完整伤害流不能伪装成零。

测试：`node combatFacts.test.cjs`。该完整文件基于线上版本制作，合并到其他分支前请保留其他同学已有改动。已有持久化报告不批量覆写；旧包重新分析即可应用规则。

## 待开发：玩家精选展示接口

现有个人资料接口没有“分析选择 + 公开权限 + 安全快照”。前端已完成选择比赛、数据/AI 模式、预览、默认关闭开关和本人草稿保存，并预留以下接口。接口不存在（404/405/501）时只保存当前浏览器的账号草稿，**不宣称已公开**；网络失败或权限错误不回退为保存成功。

### GET /api/v1/users/me/demo-showcase（需登录）

返回当前账号自己的设置和已选快照。

### PUT /api/v1/users/me/demo-showcase（需登录）

请求：

```json
{"enabled":true,"analysis_id":"分析编号","mode":"stats"}
```

`mode` 为 `stats | ai`。关闭时允许 `{enabled:false, analysis_id:null, mode:"stats"}`；已经开启时必须立即撤销公开快照。开启/切换必须验证报告属于当前账号、未删除且分析已完成；AI 模式必须有已完成 AI 结果。建议已存表字段 `user_id / enabled / analysis_id / mode / snapshot_json / updated_at`。

服务端自己从报告生成快照，**不能信任客户端提交的分数、姓名、AI 文本或账号 ID**。前端不提交 snapshot。只返回用户明确选择的简要字段，不公开原始 Demo、包 ID、完整报告、路径、令牌或模型密钥。

### GET /api/v1/users/:userId/demo-showcase（公开读）

关闭、未选择、源报告已删除时返回 `enabled:false, analysis_id:null, snapshot:null`；不要透露私人报告是否存在。公开响应建议 `Cache-Control: no-store`，关闭后立即失效。

所有成功接口使用现有 `{code:0,message:"success",data:{...}}` 包装。例如 data：

```json
{
  "enabled": true,
  "analysis_id": "分析编号",
  "mode": "ai",
  "snapshot": {
    "map": "de_mirage",
    "player_name": "Demo 中的昵称",
    "kills": 24,
    "deaths": 12,
    "adr": 102.5,
    "ai_title": "道具创造突破",
    "ai_excerpt": "本场精彩表现的短摘录，最多 280 字。"
  }
}
```

数据可以简单；AI 选已生成报告的首条 strength（或 summary 摘录）。前端只展示快照，不通过公开名片访问任何私有分析接口。后端实现这些接口后无需改变前端流程。

验收：跨账号选报告应 403/404；未完成 AI 选 AI 模式应 409；关闭后访客立即看不到；删除分析时撤销展示；昵称/AI 纯文本输出；保存/读取隔离账号。
