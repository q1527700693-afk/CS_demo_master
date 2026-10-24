# 全员导出 v1.2 后端接入说明

当前后端同时接受五文件 ZIP 协议 **1.1.0 / 1.2.0**。依据本次提供的 `GLOBAL-EXPORT-v1.2.md`、`package-v1.2.schema.json` 和 ZywOo Mirage 全员样例实现；原件保存在 contracts，样例保存在 tests/fixtures。

## 已实现的变化

- 按 manifest 版本选择正式 Schema；五个文件必须同版本，不接受混合版本。
- v1.2 解压总量上限为 256 MiB；旧 v1.1 仍为 50 MiB。上传 ZIP 上限仍为 50 MiB。
- events 和 map 均逐条流式校验；只保留有界的目标事件供规则计算，不将全场事件装成大数组。
- 保留全员原始统计、位置、事件、轨迹、覆盖计数和采样说明，增加包级全员查询及回合分页。
- 单人规则继续只使用 events.items 与原有目标状态；不合并 global_items、不叠加新旧轨迹。
- 未知坐标保持 null；死亡/观战状态不删除；不插值；未知或冲突归属不猜测投掷者。
- 规则版本更新为 rules-1.1.0，标准报告契约仍为 report 1.0.0；不调用 LLM。

## 接入流程

上传 `POST /api/v1/analysis-packages` 完成校验后，可直接读取包的全员数据，不必等待单人分析。单人分析仍通过 `POST /api/v1/matches/{match_id}/analyses` 显式创建，并按原有任务/报告接口查询。

所有下述接口要求 Bearer JWT，响应包装为 `{code,message,data}`。资源按账号隔离；越权返回 404。对 v1.1 包请求全员数据或 version=1.2 证据，返回 409，不伪造全员数据。

## 全员接口

路径均以 `/api/v1` 开头。

| 方法和路径 | 用途 |
| --- | --- |
| GET `/analysis-packages/{package_id}/global` | 版本、比赛、名单、导出范围、覆盖计数、采样说明、全员统计、完整回合元数据与数据条数 |
| GET `/analysis-packages/{package_id}/global/events` | 分页返回 events.global_items 原始事件 |
| GET `/analysis-packages/{package_id}/global/samples` | 分页返回 map.all_player_samples 原始位置/状态 |
| GET `/analysis-packages/{package_id}/global/trajectories` | 分页返回 map.all_trajectories 完整轨迹 |

`global` 摘要的 data 字段：

```text
schema_version, match_id, package_id, target_player_id,
match, players, export_scope, global_sampling, global_coverage,
all_player_stats, rounds,
counts: { events, samples, trajectories }
```

players 是完整名单，可能包含观战者等无统计成员，因此人数可以不同于 all_player_stats。全员统计保留解析器原始字段，不自动生成每名玩家的独立规则报告；target_player_id 仍是原包的单人分析对象。

三个分页接口共享参数：

| 参数 | 默认值 | 规则 |
| --- | --- | --- |
| round_num | all | `all`、`context`，或 1–999 的十进制回合号；context 表示未关联回合的数据 |
| offset | 0 | 0–500000 的整数，代表所选数据集/回合中的记录偏移 |
| limit | 200 | 1–500；可能因响应字节预算返回更少条数 |

```http
GET /api/v1/analysis-packages/package-example/global/samples?round_num=3&offset=0&limit=200
Authorization: Bearer <access_token>
```

返回 data：

```json
{
  "items": [],
  "total": 0,
  "offset": 0,
  "next_offset": null
}
```

items 中保持各源记录完整结构。总量为当前筛选结果的记录数；客户端必须用返回的 next_offset 翻页，null 表示结束，不能用返回条数是否等于 limit 判断结束。非法参数/未知参数返回 400，未知数据集返回 404。无数据的回合和超出末尾的 offset 返回空数组。

普通页按源 JSON 记录字节合计约 2 MiB 控制；单条较大的完整轨迹可单独返回，最高 8 MiB。轨迹不拆点、不删点。跨回合轨迹会被关联到所有与 start_tick/end_tick 区间重叠且起点已知的回合；各回合轨迹数不可相加当作全场总数。`all` 中每条轨迹仅一份，回合筛选不会裁剪该轨迹的点。

## 证据接口兼容

| 请求 | events 字段 | map 字段 |
| --- | --- | --- |
| `/evidence` | 原有目标事件数组的兼容投影 | 原有 1.0 已归属目标轨迹投影 |
| `/evidence?version=1.1` | 原有目标事件数组，保留时间字段 | 1.1 目标视图，不含新增全员数组；v1.2 导入时生成兼容投影 |
| `/evidence?version=1.2` | **完整 events.json 对象**，含 items、global_items、global_coverage 和身份字段 | 完整 1.2 map.json 对象 |

version=1.2 的 events 是对象，不是旧版本的数组。其目标流与全局流必须分别读取，不可合并相加。完整证据用于下载或诊断，前端地图播放推荐使用全员分页接口，避免一次 JSON.parse 整个地图。

## 校验与存储实现

replaySchema 按版本编译正式 Schema，逐项验证大数组后验证头部、必填数组与数量。manifest/metrics/rounds 限制为小文件。所有文件仍验证 SHA-256、大小和身份，拒绝路径穿越、重复条目、加密、符号链接、不安全 JSON 键和数值 SteamID。

新增检查包括：

- 全局事件 ID 在 global_items 内唯一，回合引用存在；事件类型与源数据集对应。
- global_coverage 与 manifest.export_scope.global_dataset_coverage 一致；保留事件数、统计人数、轨迹源行数与声明计数一致。
- 全员统计 SteamID 不重复且属于名单；全员采样玩家属于名单，外层 tick 与 state.tick 一致，已关联回合的采样不得超出已知回合范围。
- 轨迹 ID、实体分组不重复；points/point_ticks/records 长度一致，坐标/tick/实体字段逐项对应，起止 tick 与记录范围一致。
- ownership 必须与源 records 中可用的 thrower_steamid 一致：无来源 unknown、单一来源 known、冲突 conflicting；不使用距离推测。
- global_sampling 与 manifest 的位置采样声明一致。

导入时将三类全员数据写入独立 JSONL，并生成每条记录 12 字节的磁盘偏移索引，另建回合索引。分页请求只读取对应索引段与记录，不扫描整个地图，不在 API 进程解析数十 MiB 原文件。摘要和索引计数为小 JSON。

全员产物放在包的私有导入目录，分析目录不重复生成全员 JSONL。删除包会清理摘要、原始文件、全员索引和关联分析；删除单次分析不删除包的全员数据。原有数据库无需新增表，旧报告继续可读。

## 资源预算与边界

| 项目 | 限制 |
| --- | --- |
| 新上传接口 ZIP | 50 MiB；旧 /demos 上传仍为 20 MiB |
| 解压总量 | v1.2 256 MiB；v1.1 50 MiB；声明和实际字节都校验 |
| events.json | v1.2 64 MiB；v1.1 16 MiB |
| manifest / metrics / rounds | 每个 2 MiB |
| map.json | 受解压总量限制，不整体读入内存 |
| 目标事件 | 最多 20000 条，序列化数据合计最多 16 MiB |
| 全局事件 | 最多 200000 条 |
| 地图数组总记录 | v1.2 500000 条；v1.1 100000 条 |
| 单条校验预算 | 普通记录 token 计量小于 512 KiB；全员轨迹小于 8 MiB；嵌套深度小于 40 |
| 回合 | 最多 100 个 |
| 计算任务 | 单并发，old-space 384 MiB，执行超时 120 秒，租约 150 秒 |

超限明确失败，不静默截断全员数据。V8 堆限制不是 RSS 硬上限；生产仍需在 2 核 2G 服务器验证最大包、并发读取、代理超时及磁盘容量。JSONL、索引和兼容投影会额外占用磁盘；现有任务数量配额不等于磁盘字节配额。

全场指 Demo 中记录的非刀局回合，包含冻结时间，不是热身或回合外数据。位置约每 0.5 秒采样，不表示逐 tick 录像，也不证明目标玩家视野内可见。前端应根据 health/观战等源状态决定显示方式，并使用地图坐标转换配置。

## 样例与验证

```powershell
npm test
node scripts/analyze-package.js tests/fixtures/ZywOo-B8-vs-Vitality-Mirage-all-players-v1.2.zip data/replays/new-global-acceptance
```

输出目录必须不存在。样例 ZIP 约 4.3 MiB，解压约 54.1 MiB：18 回合、10 名玩家统计、4316 条全局事件、39046 条全员位置、319 条全员轨迹，共 46904 个轨迹源行。319 条轨迹目前均未知归属。单人报告包含 6 条回看候选（3 条携带道具死亡、3 条队友受闪），不是 6 次独立失误。

测试覆盖真实包导入/分析、旧协议回归、分页完整性、全量轨迹对照、权限与删除、混合版本、缺失全局数组、数值 SteamID、错误覆盖计数、重复全局事件、名单不匹配、轨迹对齐与坐标、伪造归属、null/冲突归属、JSON 字段顺序及 256 MiB 上限。
