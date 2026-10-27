# 好友、车队与个人资料联调

更新日期：2026-10-25。好友、车队均使用真实后端，不再使用前端模拟数据。

## 后端版本与部署

通过 GitHub codeload 重新下载并核验当前分支：

- `dev`：`bd464418dfac7752172087021451ee7605f79b75`，已合入好友和组队大厅。
- `feature/zip-replay`：`371494d482be8a47540966e0a037916d3b997f2b`，本地已有该版本，包含上述好友和车队实现。
- 远程 dev 与本地的 `friendService.js`、`lobbyService.js`、`friends.js`、`lobbies.js`、`users.js` 内容一致（仅 CRLF/LF 换行差异）。本地数据库配置多出的 WAL 设置来自已有复盘版本。
- 保留本地原有的复盘补丁，不 checkout、不 reset、不覆盖后端。本次没有修改任何后端源码、测试或数据库结构；启动时使用后端自身逻辑。
- 根目录 `start-local.cmd` 启动，`stop-local.cmd` 停止启动器管理的服务。前端 5173，后端 8000，解析服务 8877。已有账号、头像和复盘数据继续使用原路径。

远程快照、修改前前端备份及后端源码校验位于 `../../docs/social-integration-20261025/`。

## 页面与资料统一

- `/friends`：用户名/昵称搜索、服务端分页、数字 ID 名片查询、我的好友、收到/发出的申请、发送/接受/拒绝/撤回/解除好友。
- `/players/:userId`：公开名片，好友操作与列表共用 Pinia 关系状态；游客可查看，登录后添加好友。
- `/lobbies`：公开大厅，服务端模式筛选及分页；发布、领取/取消领取组队码。
- `/lobbies?team=:id`：可分享的车队详情，队长发车、删除和移除领码成员；刷新页面可恢复详情。
- `/profile`：保存的头像、游戏水平、签名和组队偏好由同一后端资料读取。发布招募时预填水平和偏好，可按本次车队修改。
- 三个区域共用社区导航、头像和玩家身份组件。好友、队长、领码成员均可打开公开名片；侧栏显示待处理好友申请数。
- 关系状态在页面切换、窗口重新获得焦点和用户刷新时更新；切换/退出账号清空缓存，丢弃旧账号的迟到响应。

好友关系与资料请求失败会明确显示错误并允许重试，不以模拟数据代替。离线模拟账号无法操作真实好友/车队。

## 真实接口

所有路径以前缀 `/api/v1` 调用，统一解包 `{ code, message, data }`。

| 方法与路径 | 请求/返回要点 |
| --- | --- |
| GET `/users/search?q=...&page=1&pageSize=20` | q 为 2–32 字符；按用户名或昵称搜索；Page<SearchPlayer> |
| GET `/friends?page=1&pageSize=50` | Page<Friend>，每项为 friendship_id / user / friends_since |
| GET `/friends/requests` | incoming / outgoing / incoming_count；每项含数字 id、direction、user |
| POST `/friends/requests` | `{ user_id: number }` |
| POST `/friends/requests/:id/accept` | 接受 |
| POST `/friends/requests/:id/reject` | 拒绝 |
| DELETE `/friends/requests/:id` | 撤回自己发出的申请 |
| DELETE `/friends/:userId` | 双向解除好友 |
| GET `/lobbies?page=1&pageSize=12&mode=competitive` | mode 可省略；服务端分页，总数不是当前页数量 |
| POST `/lobbies` | title / description / mode / map / region / skill_level / team_size / current_players / team_code |
| GET `/lobbies/:id` | 含 owner、claimants、权限标志、到期时间和可见组队码 |
| POST `/lobbies/:id/claim` | 返回 `{ team_code, lobby_id, claimed_at, lobby }` |
| DELETE `/lobbies/:id/claim` | 取消领码，返回 Lobby |
| POST `/lobbies/:id/depart` | 队长发车，返回 Lobby |
| DELETE `/lobbies/:id/claimants/:userId` | 队长移除成员并禁止其再次领取 |
| DELETE `/lobbies/:id` | 队长删除招募 |

类型位于 `src/features/social/types.ts` 和 `src/features/lobby/types.ts`，请求函数分别位于各模块 `api.ts`。

车队的 `current_players` 是队长填写的游戏内人数，`claim_count` 是领码人数；两者不得相加。领码不等于加入游戏。组队码只由后端授权返回给队长和已领码玩家，不自行猜测或拼接。

组队人数 2–10；当前人数 1 到队伍人数减 1；标题最多 60 字，说明 300 字，地图/地区/水平各 32 字，组队码 4–64 字。模式为 competitive / premier / wingman。默认 24 小时到期，以后端返回 expires_at 为准。

后端未提供聊天、邀请好友入队、修改已发布招募、已发车历史列表和实时推送接口，因此页面未添加这些操作。被移除的成员再次领码时会得到后端 403，前端显示中文解释。公开训练与公开 Demo 汇总仍无接口，继续保持原本的未开放状态。

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run test:social
```

`test:social` 需要 Playwright 和 Chrome；本机自动使用现有 Codex runtime Playwright，也可设置 `PLAYWRIGHT_MODULE` / `BROWSER_EXECUTABLE`。脚本启动独立 18081 后端和 15175 前端，测试结束关闭服务，独立数据库及截图保留在 `test-results/social-integration-20261025/`，不会写入现有 app.db。

已通过：原有 48 项前端测试、新增 4 项好友状态回归测试、后端原有 49 项好友/车队/资料测试、TypeScript 检查和 Vite 构建。真实浏览器测试覆盖三个登录账号、资料/头像同步、迟到的详情响应保护、好友完整流程、车队完整流程、复制组队码、游客与非队长权限、失效链接、分页/筛选、断网重试、退出后状态隔离和 390px 四页面布局。浏览器无未捕获异常，业务请求均未由 Service Worker 模拟。

名片及五模式训练回归也已通过：原有 47 个训练文件字节一致、公开名片不泄露其他账号本机训练成绩。后端 src/tests 共 30 个文件的前后 SHA-256 一致，Git 状态也与任务开始时完全一致。

