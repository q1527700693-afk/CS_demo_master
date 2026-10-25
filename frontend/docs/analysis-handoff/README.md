> **当前本地真实导出为 1.1.0。** 昵称定位后必须确认具体 SteamID，之后才提取目标玩家详细数据。优先阅读 [详细字段与接口变化](DETAILED-DATA-v1.1.md)、[新版 Schema](package-v1.1.schema.json) 和 [真实新版 ZIP 样例](sample-analysis-v1.1.zip)。旧 1.0.0 文件供模拟与兼容参考；本次未修改云端后端。

# Demo 分析前端交接包

更新：2026-10-23。**云端后端由后端组实现；本机真实解析工具现已单独放在工作区 local_parser，真实 Demo 到 ZIP 可独立测试。** 新接口为前端期望的协议，需后端组实现后联调。当前 `VITE_MOCK_REPLAY=true` 使用浏览器内合成演示数据；不是实际 Demo 分析结果。

## 直接交给后端组的文件

| 文件 | 用途 |
| --- | --- |
| `openapi.json` | OpenAPI 3.1：接口路径、请求、响应、鉴权与状态 |
| `package.schema.json` | 上传包的数据结构，JSON Schema Draft 7 |
| `report.schema.json` | 返回报告的数据结构 |
| `progress.schema.json` | 前端四阶段显示模型；本机 / 云端响应经前端映射到此结构 |
| `sample-analysis.zip` | 真正可解压的五文件上传样例，标记 is_fixture=true |
| `sample-package.json` | 五个样例 JSON 合并后的可阅读版本，不是实际上传文件 |
| `sample-report.json` | 云端报告 `data` 的完整示例，与 ZIP 的 match/package/player 标签一致 |
| `frontend-contracts.ts` | 前端当前使用的 TypeScript 类型副本 |

`analysis-handoff.zip` 是**发给开发组的交接资料包**；`sample-analysis.zip` 是**产品运行时上传的分析数据包样例**。两者用途不同。

## 用户实际上传什么

上传一个 `.zip`，不上传文件夹。使用 `multipart/form-data`，文件字段名固定为 **`file`**；浏览器自动生成 boundary，前端不手动设置 multipart Content-Type。

```text
<package_id>.zip
├── manifest.json  比赛身份、版本、玩家、文件摘要
├── metrics.json   按模块保存的指标、状态、样本数
├── rounds.json    回合编号、起止 tick、获胜队伍
├── events.json    关键事件及依据
└── map.json       道具轨迹、坐标系和地图资源版本
```

全部为 UTF-8 JSON。拟定压缩包与解压总量上限均为 50 MiB；最多只接受这五个根目录文件。禁止路径穿越、重复文件名和缺失文件，服务器必须复核，不能只依赖前端检查。

`package.schema.json` 校验解压后组合的 `{manifest,metrics,rounds,events,map}`。ZIP 内仍是五个独立 JSON，文件中包含各自的 `schema_version`、`match_id`、`package_id`。

## 最重要的四个关联标签

| 变量 | 类型 | 由谁生成 / 何时变化 |
| --- | --- | --- |
| `match_id` | string，建议 UUID | 本地工具为源 Demo 建立稳定编号；重算同一个源文件时沿用 |
| `package_id` | string，建议 UUID | 本地每次重新导出生成新编号；重传同一 ZIP 不变 |
| `analysis_id` | string，建议 UUID | 后端每次新的分析生成；同一幂等请求重试沿用 |
| `target_player_id` | string，SteamID64 | 此次分析的目标玩家；必须与包内目标一致 |

**上传响应、任务查询和最终报告必须保持 match/package/player 相同；任务查询与报告的 analysis_id 也必须相同。** 前端已经校验报告标签，不一致会停止接收，不存到错误比赛下面。SteamID 不用 JS number，避免精度损失。

`manifest.source.demo_sha256` 用于识别源文件；本地维护源摘要到 match_id 的映射。后端按登录账号隔离存储，检查重复上传和冲突。摘要只能验证一致性，不能证明客户端竞技数据真实。

## 比赛时间、比分与版本

| 变量 | 类型与约定 |
| --- | --- |
| `match.started_at` | 带时区 ISO 8601 或 null；未知不能拿上传时间代替 |
| `match.started_at_source` | demo / platform / user_input / unknown；null 时间对应 unknown |
| `match.map` | string，例如 de_mirage |
| `match.tick_rate` | 正数；时长换算使用此值，不硬编码 64 |
| `match.complete` | boolean；是否已确认完整比赛 |
| `match.teams[]` | `{team_id,name,score}`；score 为整数或 null；team_id 不随换边变化 |
| `uploaded_at` | 后端接收时间，ISO 8601 |
| `analyzed_at` | 后端生成报告时间，ISO 8601 |
| `schema_version` | 当前上传数据为 1.0.0 |
| `report_schema_version` | 当前回传报告为 1.0.0 |
| `producer` | `{app_version,parser_version,adapter_version}` |
| `module_version` | 每个算法独立版本 |
| `versions` | 报告中的 `{evaluation,prompt}`，记录云端规则和提示词版本 |

前端按 match_id 归类，报告按 analysis_id 展示。每次分析保留当时比赛元数据快照，避免后续修改元数据时错认旧报告。完整性未确认时需标明“已记录回合”，不能据此计算整场胜率。

## 后端需要实现的接口

默认 API 前缀 `/api/v1`，云端请求都带 `Authorization: Bearer <登录JWT>`。统一成功响应 `{code:0,message:"success",data:...}`，错误响应 `{code:number,message:string,data:null}`。

| 方法、路径（省略前缀） | 请求 | 返回 data |
| --- | --- | --- |
| `POST /analysis-packages` | multipart：file=ZIP | HTTP 201：match_id、package_id、target_player_id、uploaded_at，可带 reused |
| `POST /matches/{match_id}/analyses` | JSON：`{package_id,target_player_id}`；请求头 `Idempotency-Key` | HTTP 202：AnalysisRun |
| `GET /analyses/{analysis_id}` | 无 | AnalysisRun，供每秒轮询 |
| `GET /analyses/{analysis_id}/report` | 无 | AnalysisReport；未就绪 HTTP 409 |
| `GET /matches?page=1&pageSize=100` | 分页 | `{items,page,pageSize,total}`，每项含最新任务和最新可用报告编号 |
| `GET /matches/{match_id}/analyses` | 无 | `{items:AnalysisRun[]}`，按新到旧 |
| `GET /analysis-packages/{package_id}/evidence` | 无 | `{match_id,package_id,events,map}`，供事件列表和道具图使用 |

`AnalysisRun` 必需字段：match_id、package_id、analysis_id、target_player_id、status、stage、progress、message、report_available。

`status`：`queued → running → completed / partial / failed`。**partial 是可读报告的终态**，不应无限等待。`stage` 建议 queued / evaluating / generating_report / saved / failed；`progress` 为 0–100 或 null，`message` 为具体当前步骤。没有可信百分比时返回 null。

列表每项包括 `match_id`、`match`、`created_at`、`latest_analysis`、`latest_available_analysis_id`、`summary`。摘要可为 null；有结果时为 `{adr,rating,player_team_id,status}`，未知 ADR / Rating 为 null。即使最新重算失败，也保留先前可用报告入口。

幂等规则：相同用户、相同 Idempotency-Key 和请求体返回原任务；同一个键对应不同请求体返回 409。重传相同 package_id 和内容应复用，编号相同但内容不同返回 409。另一个用户查询不属于自己的包 / 任务 / 报告应返回 404。

错误约定：400 参数或包格式错误；401 登录失效（沿用现有 code=40002）；404 资源不可见；409 幂等冲突或报告未就绪；413 文件过大；500 服务失败。前端保留重试入口。接口不应把异常返回 HTTP 200 且 code=0。

## 本地工具需要的接口与端口

本机服务已在 local_parser 中实现，网页默认走“本地解析并导出 ZIP”，不调用云端。下列解析协议采用两步：先真实解析并返回玩家列表，再选择目标玩家执行算法和导出。

| 端口 | 用途 |
| --- | --- |
| 5173 | 当前 Vue 开发网页 |
| 8000 | 现有后端开发地址；生产由 HTTPS 域名代理 |
| 8877 | 建议本机解析服务，仅监听 127.0.0.1 |

| 本机路径 | 请求 / 响应 |
| --- | --- |
| `GET /local/health` | data：`{version,awpy_available}` |
| `POST /local/jobs?target_player_id=…` | application/octet-stream，原始 .dem 字节；HTTP 202，data：`{job_id}` |
| `GET /local/jobs/{job_id}` | data：job_id、status、stage、percent、message；解析完成后返回 players（player_id/name）、stats（steamid 为字符串）、map、round_count、match_id；此时尚未选择目标玩家 |
| `GET /local/jobs/{job_id}/package?target_player_id=…` | 选择目标玩家，执行本地算法并返回 application/zip；不是 JSON 包装 |

本机 status 使用 queued / running / completed / failed，percent 可为 null；除 ZIP 下载外仍使用统一 code/message/data。前端原始文件上限暂定 1 GiB，本机也必须校验长度和 CS2 文件头。

本机使用自己的会话令牌，不复用云端 JWT；建议限定 Host 和前端 Origin，校验 Bearer 令牌，支持 OPTIONS 预检。默认来源为 http://127.0.0.1:5173 和 http://localhost:5173。前端只向本机地址发送原始 Demo。HTTPS 站点连接本机服务的浏览器权限和桌面打包方式需解析组验证；手工 ZIP 上传可独立工作。

`VITE_LOCAL_PARSER_URL` 可更改本机 URL；`VITE_API_BASE_URL` 和 `VITE_PROXY_TARGET` 配置云端。端口配置只是连接约定，不代表服务已运行。

## 算法字段与前端显示约定

每个 `metrics.modules.<模块名>` 输出：`module_version`、`status`、`reason`（string/null）、`sample_count`、`metrics`（指标对象/null）、`evidence_ids`（事件编号数组）。指标是 number/null；新模块可追加，但变更已有指标含义应升级算法版本。

| 模块名 | 预留指标名 / 展示内容 |
| --- | --- |
| `basic_stats` | kills、deaths、assists、adr、kast_pct、headshot_pct、opening_kills、opening_deaths |
| `utility` | flashes_thrown、enemies_blinded、teammates_blinded、self_blinds、team_blinding_events、enemy_blind_seconds、unclassified_blinds |
| `death_context` | deaths_with_context、missing_snapshots、deaths_holding_grenade、deaths_reloading、deaths_blinded、deaths_with_unused_utility |
| `reaction` | 接敌开火延迟，具体有效样本与指标算法由解析组确认 |
| `crosshair` | 预瞄分析，待定义 |
| `movement_shooting` | 移动射击，待定义 |

以上是前端可接收的数据需求，**不表示算法已实现**。前端不计算 ADR / Rating 或判定道具正确率。模块 status 使用 completed / partial / not_computed / insufficient_data / failed；缺失值显示“未知”，不得补零。KAST/爆头率单位为百分数 0–100；致盲时长单位为秒；次数均是非负整数。

接敌反应时间需先确认视角可见性、动态遮挡、预开火过滤和 tick 精度；不能仅凭距离或 spotted 判断。闪队友是可观察事件，但不一定是失误；“道具正确率”需要定义规则与分母后再加字段。Rating 公式未确认时，`scores={}`、列表 rating=null。

报告中的 `findings[]` 包含 finding_id、module、description、evidence_ids、package_id；`training_suggestions` 为字符串数组，`ai_status` 为 completed / failed / not_configured，`warnings` 为字符串数组。AI 不可用时统计报告仍应保留。

事件格式为 `{event_id,type,round_num,tick,data}`。地图轨迹为 `{event_id,type,points:[[x,y,z],...]}`；coordinate_system=source_world，asset_version 可为 null。所有 evidence_ids 和轨迹 event_id 必须引用存在的事件。**当前前端画的是世界坐标二维投影**，不是完整地图雷达；后续底图需要资源版本、原点、缩放与楼层规则。

## 四个进度条如何驱动

| 阶段 | 驱动方式 |
| --- | --- |
| 本地 Demo 分析 | 轮询本机 job；没有逐 tick 进度时 percent=null；ZIP 模式跳过此阶段 |
| 上传分析包 | 浏览器实际发送字节；发完后继续显示服务器校验，成功响应后才标记阶段完成 |
| 云端分析 | 后端真实任务 stage/progress；等待 AI 时可为 null；报告保存后完成 |
| 回传 / 下载 | 浏览器实际接收字节；提供 Content-Length 可得到确定进度，否则为不确定进度 |

生产模式不按计时器伪造百分比。演示模式会明确标注固定样例和模拟阶段。任务编号按账号保存在 sessionStorage，同标签页刷新后可继续查询；失败可以重试或创建新分析，不覆盖旧报告。前端离开页面停止轮询，云端任务应继续。当前未设计取消或断点续传接口。

## 后端接入时的验收顺序

1. 实现 ZIP 上传，使用样例校验五文件、摘要、标签、版本、引用和账号权限。
2. 实现任务创建 / 轮询，验证幂等和失败响应；先返回明确的部分可用报告即可，不假造指标。
3. 实现报告、证据和比赛历史；确保四个标签在整个链路一致。
4. 配置前端 `VITE_MOCK_REPLAY=false`，重启前端，用真实服务联调。旧 `/demos` 协议已从当前复盘页面移除。
5. 解析组提供本机接口或可导出 ZIP 的工具后，再验收真实 Demo；AI 服务密钥只放后端，不写入 VITE_*。

已使用用户提供的真实 Demo，跑通浏览器 → 本机 awpy → 玩家选择 → 本地算法 → 下载真实 ZIP，并验证 Schema、身份标签与摘要。另有模拟检查覆盖四阶段、部分可用报告、未知指标、历史、刷新继续、手机布局和报告标签拒收。浏览器测试使用 MSW；这些检查不能替代真实解析准确性、后端持久化/安全或生产网络验收。
