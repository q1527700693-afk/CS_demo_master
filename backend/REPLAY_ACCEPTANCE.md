# 复盘后端验收记录

验收日期：2026-10-24（Asia/Shanghai）。代码分支：feature/zip-replay。本记录为本地验收，尚未部署到云服务器。

## 执行结果

- `npm test`：75 项通过、0 项失败，包含原有账号、头像、好友、组队功能、23 项复盘接口测试及 3 项 AI 服务测试。
- `git diff --check`：通过。
- 正式 package-v1.1.schema.json 用于导入校验；生成的标准报告通过 report.schema.json 校验；默认证据响应通过交接 OpenAPI Evidence 校验。
- 样例结果：23 个回合、3,760 条周期状态、131 条未知归属轨迹、19 条回看候选。规则报告状态为 partial，基础报告中的 AI 状态为 not_configured，评分为空。
- 可选 AI 接口：未配置 `DEEPSEEK_API_KEY` 时 POST 返回 50300；使用 mock provider 验证了精简事实构造、严格 JSON Schema 和未知 evidence_id 拒绝。未进行真实 DeepSeek 计费调用。
- 最新集成测试样例分析阶段：912 ms，分析进程峰值 RSS 117,900 KiB（约 115 MiB）。不包含上传、排队及单独的导入校验；不是 2 核 2G 云服务器压测。

## 覆盖范围

上传校验后才返回 201；上传不启动规则分析；显式创建任务返回 202；同键同请求复用、同键不同请求冲突；相同包重传复用、同包编号不同内容冲突；报告四个标签一致；partial 可读；跨账号访问返回 404；失败重算保留旧报告入口；并发幂等；删除清理；过期任务租约恢复；分析期间健康接口可用。

异常输入覆盖损坏 ZIP、错误摘要、旧协议、跨文件身份冲突、数值 SteamID、重复文件、重复事件、错误地图玩家、非法数组、缺失证据和不安全对象键。另手工验收了 round_num=0 的地图上下文及 start_tick=null 的合法边界，成功生成报告。

## 联调材料

- 架构、接口与 AI 设计：[说明文档](../docs/replay-analysis-design.md)。
- 启动与请求流程：[REPLAY.md](REPLAY.md)。
- 原始交接契约：[contracts/](contracts/)。
- 本地验收产物：data/replays/acceptance-handoff/cloud-report.json 与 report.json；运行数据不提交 Git。

从 backend 目录执行以下命令可重新生成标准报告与扩展事实（输出目录必须不存在）：

```sh
node scripts/analyze-package.js tests/fixtures/sample-analysis-v1.1.zip data/replays/new-acceptance
```

## 仍需部署环境验收

真实 Vue 前端页面联调、反向代理超时和上传限制、目标 2 核 2G 上限包与并发压力测试。AI 接口尚未配置真实 Key，也没有进行真实供应商调用、计费和限流压测。
