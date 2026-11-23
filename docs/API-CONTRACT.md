# 前后端接口协作约定

账号和资料以已核验 `dev` 分支 `bd464418dfac7752172087021451ee7605f79b75` 的实际实现为准：`https://github.com/q1527700693-afk/CS_demo_master/blob/bd464418dfac7752172087021451ee7605f79b75/docs/api-v1.md`。平台字段可全部留空，新增 `steam_friend_code`。注册支持可选 `nickname`，当前前端仍只提交用户名和密码。
该分支是 Node.js + Express + SQLite + JWT。当前 main 的根目录 Flask `/api/login`、`/api/register` 属于另一套实现，不能与本前端账号流程混用。
账号、个人资料、好友、车队和复盘已经实际联调；训练云端接口仍未提供。好友车队完整契约见 [SOCIAL-LOBBY-INTEGRATION.md](SOCIAL-LOBBY-INTEGRATION.md)。启动方式见 [AUTH-PROFILE-INTEGRATION.md](AUTH-PROFILE-INTEGRATION.md)。

## 通用

- Base URL：`/api/v1`；可通过 `VITE_API_BASE_URL` 配置。
- 成功：`{ code: 0, message: 'success', data: ... }`。
- 失败：`{ code: number, message: string, data: null }`，配合正确 HTTP 状态码。
- 认证：`Authorization: Bearer <token>`。
- 分页：`page` / `pageSize`，响应 data 为 `{ items, page, pageSize, total }`。
- 时间字符串建议 ISO 8601；前端显示时格式化。
- 字段名、null、单位、鉴权和边界必须同时约定。后端可提供 OpenAPI 作为共同来源。

## 当前前端消费的接口

| 方法 / 路径（省略 /api/v1）      | 请求                                                          | data                                                | 与仓库清单关系                                 |
| -------------------------------- | ------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| POST /auth/login                 | `{ username, password }`                                      | `{ access_token, token_type, user }`                | 已按真实后端接入                               |
| POST /auth/register              | `{ username, password }`                                      | 同登录，HTTP 201                                    | 已接入，注册后自动登录并进入个人资料           |
| GET /users/me                    | 无                                                            | BackendUser                                         | 已接入，用于刷新恢复身份                       |
| GET /users/me/profile            | 无                                                            | UserProfile                                         | 已接入                                         |
| PATCH /users/me/profile          | 平台账号、signature、skill_level、looking_for、other_game_ids | UserProfile                                         | 已接入，未知字段会被拒绝                       |
| GET /users/{id}/profile          | 无                                                            | UserProfile                                         | 已接入公开名片页面 /players/:userId          |
| POST /users/me/avatar            | multipart，字段 file                                          | avatar_url、content_type、size_bytes、width、height | 已接入                                         |
| DELETE /users/me/avatar          | 无                                                            | UserProfile                                         | 已接入                                         |
| GET /lobbies?page=1&pageSize=12 | 可选 mode，最大 pageSize=50 | Page<Lobby> | 已联调真实大厅 |
| POST /lobbies | title, description, mode, map, region, skill_level, team_size, current_players, team_code | Lobby | 已联调发布 |
| POST /lobbies/{id}/claim | 无 | { team_code, lobby_id, claimed_at, lobby } | 领码，不改变游戏内人数 |
| DELETE /lobbies/{id}/claim | 无 | Lobby | 取消领码 |

`src/types/index.ts` 定义实际 DTO 和页面类型。请求层拆出 data；账号适配层将 `access_token` 转为内部 token、数字 id 转为字符串，nickname 为 null 时使用 username。后端 `avatar_url` 在内部用户状态中映射为 avatar。
资料可编辑字段为 `steam_id`、`steam_friend_code`、`wanmei_id`、`5E_id`、`signature`、`skill_level`、`looking_for`、`other_game_ids`。所有平台字段可留空或清空；空字符串在发送时转 null。好友码为 6–12 位数字字符串，与 `steam_id` 分开，不参与 `has_platform_id` 的计算。SteamID2/3、数字主页链接由服务端规范化为 SteamID64；不支持自定义 `/id/` 链接。填写了格式无效的平台字段时仍会拒绝保存。用户名和昵称不通过资料接口修改，学校、位置和常玩地图等旧字段已移出表单。
头像 JPEG/PNG/WebP、最多 2 MB，服务端真实解码并处理为 512×512 JPEG。`/uploads/...` 相对于 API 主机解析，开发和部署都需转发该路径。

用户名/昵称搜索、好友申请和关系已接入真实接口，具体端点、分页结构及车队管理接口见 [SOCIAL-LOBBY-INTEGRATION.md](SOCIAL-LOBBY-INTEGRATION.md)。公开训练和 Demo 汇总仍无接口。
不调用尚未实现的 `/auth/logout`，退出仅清除本地 token。401 且 code=40002 时触发登录失效；密码错误 code=40001 仅作为表单错误，避免误清除已有身份。
车队发车、移除成员和删除已接入；聊天、邀请和信用评价未提供接口。

## Demo 分析新协议（交给后端组）

见 [完整交接说明](analysis-handoff/README.md)、[OpenAPI](analysis-handoff/openapi.json)、[上传 ZIP 样例](analysis-handoff/sample-analysis.zip) 和 [回传报告样例](analysis-handoff/sample-report.json)。当前复盘页面已切换为 `/analysis-packages`、`/matches`、`/analyses`，不再使用旧 `/demos` 草案。

后端和本机解析服务已完成接入，当前 `VITE_MOCK_REPLAY=false`。协议细节见交接文档及工作区 `docs/local-deployment-v12-20261024/README.md`。

上传一个 ZIP，根目录包含 manifest.json、metrics.json、rounds.json、events.json、map.json。使用 multipart 的 file 字段。回传 JSON 同时带 match_id、package_id、analysis_id、target_player_id；缺失数据为 null，partial 为可读报告终态。

## 独立开发与版本管理

1. 为优先页面确认请求、成功 / 失败示例、字段单位与权限。
2. 前端按协议维护类型、模拟 handler 和 api.ts；后端按协议实现。
3. 完成一个模块，关闭相应 VITE_MOCK_* 开关，联调该模块。
4. 正常增加可选字段保持 v1 兼容；删除字段或改变语义时共同升级。
5. HTTP 的 /v1、训练记录的 schemaVersion、ZIP 的 schemaVersion 分开维护。

混合模式下的 mock 身份只供浏览器本地演示使用；真实后端不消费也不信任它。
车队模拟实现已移除，统一使用真实领码流程。训练区不提供模拟云端排行榜。

## 训练模块

当前完整挂载队友 VECTOR 模块，原模拟训练成绩与排行榜已经移除。原始历史不变；宿主另行通过完成回调为登录账号保存独立的本机名片最佳，不读取或认领原共享历史，不调用云端接口。仓库中的 `/minigames/aim/scores` 与 `/minigames/aim/leaderboard` 仍是待确认的后端草案；目前不消费此前前端假定的 TrainingResult 格式。详见 GAME-INTEGRATION.md 和 PLAYER-CARDS-AND-FRIENDS.md。

