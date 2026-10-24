# ZIP 复盘后端（基础报告不依赖 LLM）

基于仓库 dev 分支，在 `feature/zip-replay` 本地分支实现。运行环境 Node.js 22.23.2 或兼容的更新版本；使用原有 Express、JWT 和 SQLite。无需 Python、Redis、GPU 或模型 API Key。

现已兼容 v1.2 全员导出包。新增字段、全员分页接口和资源限制详见 [REPLAY_V12.md](REPLAY_V12.md)；原有 v1.1 单人接口继续可用。

## 启动和验收

```powershell
cd E:\CSPlatform\backend-work\backend
npm ci
$env:JWT_SECRET = '替换为你的随机密钥'
npm start
```

默认端口 8000。`npm start` 同时启动 API 和队列调度器；分析由独立 Node 子进程完成。直接导入 `src/app.js` 的自定义入口需要另外调用 `startQueue()`。

```powershell
npm test
node --test tests/replay.test.js
```

测试默认使用 `tests/fixtures/sample-analysis-v1.1.zip`，复制自本项目提供的真实解析样例。可通过 `REPLAY_SAMPLE` 指定其他样例，但固定统计断言对应当前样例。测试自动启动临时 HTTP 服务、数据库和分析进程，并清理自己的临时目录。

不启动 HTTP 的人工验收：`node scripts/analyze-package.js tests/fixtures/sample-analysis-v1.1.zip data/replays/acceptance-sample`。输出目录必须尚不存在，正式报告保存在 cloud-report.json，扩展详情保存在 report.json 和回合文件中。该命令用于本地验收，正式上传走鉴权 API。

## 前端接口（当前交接协议）

所有接口使用 Bearer 登录令牌与 `{code,message,data}` 响应。上传者拥有包、任务和报告的访问权，SteamID 只标识分析对象。

| 请求（前缀 /api/v1） | 用途 |
| --- | --- |
| POST /analysis-packages | multipart 文件字段 file；完成校验后 HTTP 201，返回 match_id、package_id、target_player_id、uploaded_at、reused |
| POST /matches/:match_id/analyses | JSON {package_id,target_player_id}，必需 Idempotency-Key；HTTP 202 返回 AnalysisRun |
| GET /analyses/:analysis_id | 查询真实任务状态与阶段 |
| GET /analyses/:analysis_id/report | 正式 1.0.0 报告；未就绪 409 |
| GET /matches?page=1&pageSize=100 | 按比赛分页，包含最新任务和最近可用报告 |
| GET /matches/:match_id/analyses | 按新到旧列出全部分析 |
| GET /analysis-packages/:package_id/evidence | 符合交接 OpenAPI 的旧版兼容证据视图 |
| GET /analysis-packages/:package_id/evidence?version=1.1 | 完整 1.1 事件与地图；保留所有采样和未知归属轨迹 |
| GET /analysis-packages/:package_id/evidence?version=1.2 | 完整 v1.2 证据；events 为包含 items/global_items 的对象 |
| GET /analysis-packages/:package_id/global | 全员统计、名单、回合、覆盖与采样摘要；仅 v1.2 |
| GET /analysis-packages/:package_id/global/:kind | kind 为 events/samples/trajectories，支持 round_num、offset、limit |
| GET /analyses/:analysis_id/details | 扩展事实、关键回合、移动射击观察和质量信息 |
| GET /analyses/:analysis_id/ai | 读取已生成的 AI 教练解读；未配置时返回 not_configured |
| POST /analyses/:analysis_id/ai | 从已就绪的基础报告生成 AI 教练解读；当前同步调用 |
| DELETE /analyses/:analysis_id | 删除非运行中的分析及结果 |
| DELETE /analysis-packages/:package_id | 删除包及其全部分析；存在运行任务返回 409 |

前端流程：上传并等待校验 → 创建分析 → 每 1–2 秒查询 → completed 或 partial 后读取报告。上传只做解压、正式 Schema 和交叉引用校验；校验也在单独进程中排队，不执行规则分析。生产反向代理的上传请求超时建议至少 180 秒。HTTP 返回 201 前不会宣布包已可用；超时 409 后重传相同包可继续等待。

任务终态为 completed / partial / failed，partial 表示已有可读报告，不能继续无限轮询。未知进度为 null；已保存为 100。报告与任务始终保持 match/package/player/analysis 标签一致。当前样例有未计算模块，所以报告为 partial。

AI 教练解读是独立于基础报告的可选步骤。未配置 `DEEPSEEK_API_KEY` 时，`POST /analyses/:analysis_id/ai` 返回 `50300`，基础报告、证据和历史查询不受影响。

相同用户、Idempotency-Key 和请求体（含 match_id）复用原任务；同键不同请求返回 409。新键创建独立分析并保留历史。相同 package_id 与相同内容复用上传结果；同编号不同内容返回 409。不同 ZIP 压缩形式但文件内容及 manifest 相同也复用。明确删除资源后，其幂等记录也删除。重新分析失败时，比赛列表仍保留先前可用报告入口。

旧 /demos 路由作为已有客户端的兼容接口保留，仅访问旧任务，不与新协议任务混用；新复盘页面使用上表接口。

## 正式报告

report.schema.json 的顶层包含 report_schema_version、四个身份标签、status、match、perspective、is_fixture、uploaded_at、analyzed_at、versions、report。report 内为 modules、scores、findings、training_suggestions、ai_status、warnings。规则报告默认 scores={}、训练建议为空、ai_status=not_configured；基础报告不依赖 LLM。AI 教练解读单独保存在 `ai-report.json`，不修改标准报告。生成报告时再次执行正式 Schema 校验。

交接包 Evidence 响应仍固定为旧版结构，所以默认接口剔除顶层新增事件时间字段，地图只投影已归属轨迹，并标明 schema_version=1.0.0。原始数据保留在 version=1.1 接口，未知归属轨迹不会被当成目标玩家投掷。前端后续升级时使用详细接口。

## 扩展详情（details 接口）

- `statistics`：复用本地模块、基础统计、每回合/武器表和原始定义；保留 null 和 not_computed。
- `findings`：换弹中死亡、持道具死亡、携带未使用道具死亡、自闪、友闪；包含规则版本、回合、tick、事件引用、事实描述和回看提示。
- `key_rounds`：根据记录中的首个击杀、多杀和规则命中筛选回合。录制缺失时首个观察事件不证明整回合完整，需同时展示 data_quality。
- `movement`：枪械开火 tick 对应精确关键帧的水平速度统计和跳跃状态；不插值、不以 0.5 秒采样估算反应时间、不输出急停评分。
- `map`：地图元信息、采样规则和各类记录数；具体点位由分页接口提供。未知归属轨迹保留为上下文，不归给目标玩家。
- `ai_status: not_requested`：规则报告本身没有调用外部模型。可通过独立 AI 接口生成教练解读，不改变基础报告可用性。

死亡状态来自 death_context，闪光来自 blind，不将 flash_effect 等重复证据再加一遍。规则命中只是回看候选，不声称操作失误或因果关系。报告最多保留 1,000 个发现；回合原始事件保留以便核查。

## 1.1.0 导入约束

已将 analysis-handoff 中的正式 package-v1.1.schema.json、report.schema.json、openapi.json 和 TypeScript 类型原样保存在 contracts/，另加入本次交接的 package-v1.2.schema.json。manifest/metrics/rounds 完整校验，events/map 按数组记录与头部流式校验，最后检查必填数组和数量上限。服务端还执行身份、摘要和跨文件引用校验；JSON Schema 本身不能代替这些检查。

已校验五个固定文件名、重复/未知条目、加密与符号链接、声明及实际解压字节、SHA-256 和大小、schema_version=1.1.0、跨文件 match/package ID、目标玩家与名单/确认范围、SteamID 字符串、回合和事件引用、关键地图状态所属玩家、模块证据引用。允许源记录增加字段，未知状态保持原样。

摘要一致性不能证明比赛真实性；选择玩家不等于 Steam 账号所有权认证。数据不会进入公开 uploads 目录。请把 REPLAY_DIR 保持在网站静态目录以外。

## 2 核 2G 的限制与运维

- 每次只运行 1 个 CPU 分析进程；API 负责调度与读结果。分析进程 V8 old-space 上限 384 MiB，这不等同于 RSS 硬限制；生产环境用 systemd/cgroup 对总内存另设限制。
- 分析最多 120 秒。任务租约 150 秒；异常中断的任务在租约过期后恢复，最多尝试 3 次。格式错误直接失败。
- 上传并发最多 2；队列最多 50；单用户最多 3 个待处理任务。存储任务上限全局 100、单用户 20，达到后通过删除接口释放；新接口容量不足返回 409；删除接口可释放容量。
- 新接口 ZIP ≤50 MiB（旧上传接口仍为 20 MiB）。v1.1 解压总量 ≤50 MiB、events ≤16 MiB、地图合计 100,000 记录；v1.2 解压总量 ≤256 MiB、events ≤64 MiB、地图合计 500,000 记录。其余小文件各 ≤2 MiB；最多 100 回合、20,000 目标事件，v1.2 另允许最多 200,000 全局事件。完整限制见 REPLAY_V12.md。
- ZIP 顺序解压到磁盘，map 数组逐条流式读取，每回合写 JSONL；报告和回合详情流式返回，证据按文件偏移读取；地图分页最多 500 条。
- SQLite WAL、短事务，不在分析期间占用写事务。数据库、原 ZIP、规范化结果使用持久磁盘；分析任务成功后删除临时解压 JSON；已接受包保留原始 JSON 供证据下载，导入校验失败会清理文件。
- 默认存储在 backend/data/replays，可用 REPLAY_DIR 设置绝对路径；DB_PATH 可设置数据库位置。停止服务后备份数据库和复盘目录，或使用支持 WAL 的 SQLite 备份机制。
- 本机样例初测规则/轨迹处理约 0.8–0.9 秒、分析进程峰值 RSS 约 110 MiB；最终耗时包含证据落盘，见测试日志。这不是目标云服务器压测。部署前测试同时上传、查询和上限大小包，测 RSS、CPU、磁盘及 API 延迟。

## 可选 AI 教练分析（已接入）

接口：

- `GET /api/v1/analyses/:analysis_id/ai`
- `POST /api/v1/analyses/:analysis_id/ai`

后端会从已保存的扩展报告中抽取精简事实：模块指标、findings、key rounds、movement 摘要、data_quality 和 limitations；不会把完整地图或原始 ZIP 发给模型。

模型服务使用 OpenAI-compatible 协议，服务器环境变量：

```env
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
AI_TIMEOUT_MS=60000
AI_MAX_TOKENS=2000
AI_PROMPT_VERSION=coach-1.0.0
```

- `DEEPSEEK_API_KEY` 留空时，AI 接口返回 `50300`，后端仍可正常启动。
- 返回必须是严格 JSON，并校验 `evidence_ids` 必须存在于报告中；未知证据返回 `50200`。
- 结果保存为分析目录下的 `ai-report.json`。
- 当前是同步调用；AI 失败不影响规则报告。
- 云端部署时只在服务器 `.env` 配置密钥，不能写入前端或提交到 Git。
