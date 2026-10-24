# 复盘后端验收记录

验收日期：2026-10-24（Asia/Shanghai）。代码分支：feature/zip-replay。本记录为本地验收，尚未部署到云服务器。

## 执行结果

- `npm test`：89 项通过、0 项失败，包含原有账号、头像、好友、组队功能及 40 项复盘测试（新增 18 项 v1.2 测试）。
- `git diff --check`：通过。
- 正式 package-v1.1.schema.json 用于导入校验；生成的标准报告通过 report.schema.json 校验；默认证据响应通过交接 OpenAPI Evidence 校验。
- 样例结果：23 个回合、3,760 条周期状态、131 条未知归属轨迹、19 条回看候选。标准报告状态为 partial，AI 状态为 not_configured，评分为空。
- 本轮全量测试 v1.1 样例分析阶段：1,037 ms，分析进程峰值 RSS 122,440 KiB（约 120 MiB）。不包含上传、排队及单独的导入校验；不是 2 核 2G 云服务器压测。

## v1.2 全员样例

`ZywOo-B8-vs-Vitality-Mirage-all-players-v1.2.zip` 已通过真实上传、显式分析、报告、全员分页及证据接口验证。

- 18 回合、10 名玩家统计、4,316 条全局事件、39,046 条全员状态、319 条全员轨迹。
- 46,904 个轨迹源行逐条对照原数据，points/point_ticks/records 完整保留，包括超过旧 200 点抽稀规模的轨迹。
- 单人规则仍使用目标流，得到 6 条回看候选（3 条携带道具死亡、3 条队友受闪），没有重复累加全局事件。
- 本轮全量测试分析阶段：4,340 ms，worker 峰值 RSS 116,808 KiB（约 114 MiB）；不包含上传与单独导入校验，不代表云服务器上限包性能。
- 新增接口覆盖全员摘要、按回合分页、字节预算分页续读、旧 Evidence/v1.1 投影、完整 v1.2 Evidence、账号隔离及删除清理。
- 异常验证覆盖混合版本、缺失数组、数值 SteamID、错误覆盖计数、重复全局事件、名单不匹配、轨迹对齐/坐标/归属错误、256 MiB 解压上限；null 坐标、冲突归属及任意 JSON 头部字段顺序可正确处理。

具体接口与资源预算见 [REPLAY_V12.md](REPLAY_V12.md)。

## 覆盖范围

上传校验后才返回 201；上传不启动规则分析；显式创建任务返回 202；同键同请求复用、同键不同请求冲突；相同包重传复用、同包编号不同内容冲突；报告四个标签一致；partial 可读；跨账号访问返回 404；失败重算保留旧报告入口；并发幂等；删除清理；过期任务租约恢复；分析期间健康接口可用。

异常输入覆盖损坏 ZIP、错误摘要、旧协议、跨文件身份冲突、数值 SteamID、重复文件、重复事件、错误地图玩家、非法数组、缺失证据和不安全对象键。另手工验收了 round_num=0 的地图上下文及 start_tick=null 的合法边界，成功生成报告。

## 联调材料

- 架构、接口与 LLM 预留设计：[说明文档](../docs/replay-analysis-design.md)。
- 启动与请求流程：[REPLAY.md](REPLAY.md)。
- 原始交接契约：[contracts/](contracts/)。
- 本地验收产物：data/replays/acceptance-handoff/cloud-report.json 与 report.json；运行数据不提交 Git。

从 backend 目录执行以下命令可重新生成标准报告与扩展事实（输出目录必须不存在）：

```sh
node scripts/analyze-package.js tests/fixtures/sample-analysis-v1.1.zip data/replays/new-acceptance
```

## 仍需部署环境验收

真实 Vue 前端页面联调、反向代理超时和上传限制、目标 2 核 2G 上限包与并发压力测试。当前没有外部 LLM 调用。
