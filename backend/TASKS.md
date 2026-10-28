# CS Demo Master Backend Tasks

> 这个文件只写后端要做的事情。队友或 AI 看完可以直接继续写。

## 1. 技术栈

| 技术 | 用途 |
|---|---|
| Node.js 22+ | 后端运行环境 |
| Express | HTTP API 框架 |
| node:sqlite | SQLite 数据库驱动，Node.js 内置 |
| jsonwebtoken | JWT 登录令牌 |
| bcryptjs | 密码哈希 |
| multer | 文件和头像上传 |
| sharp | 头像格式校验与压缩到 512×512（JPG/PNG/WebP） |
| cors | 前后端跨域 |
| dotenv | 环境变量配置 |
| PM2 | 服务器后台运行 |
| Nginx | 反向代理 |

## 2. 后端目录

```text
backend/
├── package.json
├── .env.example
├── uploads/
│   ├── avatars/
│   └── demo-logs/
└── src/
    ├── app.js
    ├── server.js
    ├── config/
    │   └── database.js
    ├── middlewares/
    │   ├── auth.js
    │   └── errorHandler.js
    ├── routes/
    │   ├── auth.js
    │   ├── users.js
    │   ├── lobbies.js
    │   ├── friends.js
    │   ├── demos.js
    │   └── minigames.js
    ├── services/
    │   ├── authService.js
    │   ├── profileService.js
    │   ├── lobbyService.js
    │   ├── friendService.js
    │   ├── demoService.js
    │   └── aiService.js
    └── utils/
        └── response.js
```

## 3. 通用规范

### 3.1 响应格式

成功：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

失败：

```json
{
  "code": 40001,
  "message": "Invalid credentials",
  "data": null
}
```

### 3.2 状态码

| HTTP | 含义 |
|---|---|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 参数错误 |
| 401 | 未登录或 token 无效 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 409 | 冲突，例如用户名已存在 |
| 413 | 文件太大 |
| 500 | 服务器错误 |

### 3.3 认证

```http
Authorization: Bearer <token>
```

## 4. 后端任务清单

### 4.1 基础工程

| 任务 | 文件 | 说明 | 状态 |
|---|---|---|---|
| Express 骨架 | `src/app.js`, `src/server.js` | 已创建 | DONE |
| 统一响应工具 | `src/utils/response.js` | 封装 success/error 返回 | DONE |
| 错误处理中间件 | `src/middlewares/errorHandler.js` | 已创建，后续完善 | DONE |
| 环境变量 | `.env.example` | PORT、JWT_SECRET、DB_PATH、LOBBY_TTL_HOURS | DONE |

### 4.2 数据库

| 任务 | 文件 | 说明 | 状态 |
|---|---|---|---|
| SQLite 连接 | `src/config/database.js` | 使用 `node:sqlite` | DONE |
| users 表 | `src/config/database.js` | id, username, password_hash, nickname, avatar_url | DONE |
| user_profiles 表 | `src/config/database.js` | bio, steam_id, steam_friend_code, wanmei_id, five_e_id, other_game_ids | DONE |
| lobbies 表 | `src/config/database.js` | 队伍人数、组队码、过期时间 | DONE |
| lobby_claims 表 | `src/config/database.js` | 领取组队码的虚位记录（claimed/kicked） | DONE |
| friendships 表 | `src/config/database.js` | 好友申请、双向好友关系（pending/accepted） | DONE |
| demo_analyses 表 | `src/config/database.js` | Demo 日志和分析报告 | TODO |
| minigame_scores 表 | `src/config/database.js` | 小游戏分数 | TODO |

### 4.3 认证模块

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| POST `/api/v1/auth/register` | `src/routes/auth.js`, `src/services/authService.js` | 用户名唯一，密码 bcrypt 哈希 | DONE |
| POST `/api/v1/auth/login` | `src/routes/auth.js`, `src/services/authService.js` | 校验密码，返回 JWT | DONE |
| GET `/api/v1/users/me` | `src/routes/users.js`, `src/middlewares/auth.js` | 根据 token 返回当前用户 | DONE |

### 4.4 个人名片模块

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| GET `/api/v1/users/me/profile` | `src/routes/users.js` | 返回自己的名片 | DONE |
| PATCH `/api/v1/users/me/profile` | `src/routes/users.js` | 编辑个性签名、Steam ID、Steam 好友码、完美 ID、5E ID、其他游戏 ID、水平、想找队友 | DONE |
| GET `/api/v1/users/:userId/profile` | `src/routes/users.js` | 查看公开名片 | DONE |
| POST `/api/v1/users/me/avatar` | `src/routes/users.js` | 上传头像，JPG/PNG/WebP，最大 2MB，压缩到 512x512 | DONE |
| DELETE `/api/v1/users/me/avatar` | `src/routes/users.js` | 删除头像 | DONE |


### 4.5 组队大厅模块

组队大厅是**组队码共享板**：队长填写总人数和已有玩家数（例如 5 人队已有 4 人 = 4 缺 1），发布组队码。别人点“加入”只是领取组队码，并在 `claimants` 中显示为一个虚位，**不改变** `current_players` / `slots_needed`，队伍继续挂在大厅。

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| GET `/api/v1/lobbies` | `src/routes/lobbies.js` | 缺人且未过期的队伍列表（公开，分页、按模式筛选） | DONE |
| POST `/api/v1/lobbies` | `src/routes/lobbies.js` | 发布队伍：总人数、已有玩家数、组队码 | DONE |
| GET `/api/v1/lobbies/:id` | `src/routes/lobbies.js` | 队伍详情和虚位列表 | DONE |
| POST `/api/v1/lobbies/:id/claim` | `src/routes/lobbies.js` | 领取组队码，记录虚位；`/join` 为兼容别名 | DONE |
| DELETE `/api/v1/lobbies/:id/claim` | `src/routes/lobbies.js` | 取消自己的虚位；`/leave` 为兼容别名 | DONE |
| POST `/api/v1/lobbies/:id/depart` | `src/routes/lobbies.js` | 队长发车：大厅隐藏，别人不能再领码 | DONE |
| DELETE `/api/v1/lobbies/:id/claimants/:userId` | `src/routes/lobbies.js` | 队长踢掉虚位玩家，禁止其重新领码 | DONE |
| DELETE `/api/v1/lobbies/:id` | `src/routes/lobbies.js` | 队长删除已组好的队伍 | DONE |

> 不做聊天和发消息功能。
> 组队码只返回给队长和已领取的人；公开列表/详情的 `team_code` 为 `null`。
> 列表只显示未过期、未发车且 `current_players < team_size` 的队伍；队长组好队后手动删除，超时由 `LOBBY_TTL_HOURS` 自动清理。
> 发车后除队长外所有人访问详情/领码都返回 `404`；被踢的人不会出现在 `claimants`，再次领码返回 `403`。

### 4.6 Demo 和 AI 模块

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| POST `/api/v1/demos` | `src/routes/demos.js` | 上传 Demo 日志并创建分析任务（旧 ZIP 兼容） | DONE（旧客户端，仅 ZIP） |
| GET `/api/v1/demos` | `src/routes/demos.js` | 查询自己的分析历史 | DONE |
| GET `/api/v1/demos/:id/status` | `src/routes/demos.js` | 查询分析状态 | DONE（`GET /api/v1/demos/:id`） |
| GET `/api/v1/demos/:id/report` | `src/routes/demos.js` | 获取 AI 报告 | DONE |
| POST `/api/v1/demos/:id/analyze` | `src/routes/demos.js` | 重新触发分析 | TODO |

AI 分析先调外部 LLM API，不在服务器本地跑大模型。

当前可选 AI 教练接口（基础版）已实现：

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| GET `/api/v1/analyses/:id/ai` | `src/routes/analysis.js`, `src/services/aiAnalysis.js` | 读取 AI 解读状态/结果 | DONE |
| POST `/api/v1/analyses/:id/ai` | `src/routes/analysis.js`, `src/services/aiAnalysis.js` | 基于就绪规则报告生成 AI 解读 | DONE |

- 环境变量：`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`AI_TIMEOUT_MS`、`AI_MAX_TOKENS`、`AI_PROMPT_VERSION`。
- 未配置 Key 时返回 `50300`，不影响基础报告。
- 当前为同步调用；后续可加独立 AI 队列、缓存和前端 AI 卡片。

#### 4.6.1 原始 Demo 文件（新增，已实现）

服务端直接接收 CS2 `.dem`，用 awpy 解析后再生成规则报告与 AI 解读：

| 接口 | 文件 | 说明 | 状态 |
|---|---|---|---|
| GET `/api/v1/demo-analyses/parser` | `src/routes/demoAnalyses.js` | 解析器/AI 就绪状态 | DONE |
| POST `/api/v1/demo-analyses` | 同上 | 上传 `.dem`（≤512 MiB），可选 `target_player_id` | DONE |
| GET `/api/v1/demo-analyses` | 同上 | 我的 Demo 分析列表 | DONE |
| GET `/api/v1/demo-analyses/:id` | 同上 | 状态：parsing/analyzing/reporting/completed/failed | DONE |
| GET `/api/v1/demo-analyses/:id/report` | 同上 | 标准报告 | DONE |
| GET `/api/v1/demo-analyses/:id/details` | 同上 | 扩展报告（模块/规则/回合/走位） | DONE |
| GET `/api/v1/demo-analyses/:id/rounds/:round` | 同上 | 单回合事件与规则命中 | DONE |
| GET `/api/v1/demo-analyses/:id/rounds/:round/map` | 同上 | 分页点位/轨迹 | DONE |
| GET `/api/v1/demo-analyses/:id/evidence/:event` | 同上 | 单条证据 | DONE |
| GET/POST `/api/v1/demo-analyses/:id/ai` | 同上 | 读取/生成 AI 教练解读（独立 AI 任务） | DONE |
| DELETE `/api/v1/demo-analyses/:id` | 同上 | 删除分析与 AI 任务 | DONE |

| 组件 | 文件 | 说明 | 状态 |
|---|---|---|---|
| Demo 解析器 | `../parser/parse_demo.py` | awpy 抽事实，契约 `demo-parse-1.0.0` | DONE |
| 解析器桥接 | `src/services/demoParser.js` | 探测解释器、子进程、超时、错误映射 | DONE |
| Demo 规则与报告 | `src/services/demoAnalysis.js` | 模块、规则、报告、地图 JSONL、证据 | DONE |
| 任务执行体 | `src/services/replayJobRunner.js` | import/analysis/demo/ai 统一入口 | DONE |
| AI 演示事实 | `src/services/aiAnalysis.js` | `buildDemoFacts` / `analyzeDemo` | DONE |
| 离线验收 | `scripts/analyze-demo.js` | 不经过 JWT/队列跑真实 Demo | DONE |

- 新增环境变量：`DEMO_PARSER_PYTHON`、`DEMO_PARSER_SCRIPT`、`DEMO_PARSER_PYTHONPATH`、`DEMO_PARSER_TIMEOUT_MS`、`AI_AUTO_ANALYZE`。
- 新增错误码：`50310`（解析器不可用）。
- 设计文档：`../docs/ai-demo-analysis-design.md`。

### 4.7 小游戏模块

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| POST `/api/v1/minigames/aim/scores` | `src/routes/minigames.js` | 提交小游戏分数 | TODO |
| GET `/api/v1/minigames/aim/leaderboard` | `src/routes/minigames.js` | 获取排行榜 | TODO |

### 4.8 好友模块

好友关系是双向的：A 发出申请，B 同意后双方才进入对方好友列表。好友列表只对自己可见，不做聊天。

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| GET `/api/v1/users/search` | `src/routes/users.js`, `src/services/friendService.js` | 按用户名/昵称搜索用户，返回关系状态 | DONE |
| POST `/api/v1/friends/requests` | `src/routes/friends.js` | 发送好友申请 | DONE |
| GET `/api/v1/friends/requests` | `src/routes/friends.js` | 收到的/发出的待处理申请和 `incoming_count` | DONE |
| POST `/api/v1/friends/requests/:id/accept` | `src/routes/friends.js` | 被申请人同意 | DONE |
| POST `/api/v1/friends/requests/:id/reject` | `src/routes/friends.js` | 被申请人拒绝，之后可重新申请 | DONE |
| DELETE `/api/v1/friends/requests/:id` | `src/routes/friends.js` | 申请人撤回 | DONE |
| GET `/api/v1/friends` | `src/routes/friends.js` | 我的好友列表（分页） | DONE |
| DELETE `/api/v1/friends/:userId` | `src/routes/friends.js` | 删除好友，双方关系解除 | DONE |

> 不能加自己、不能重复申请、不能同时存在 A→B 和 B→A 两条申请；已经是好友返回 `40900`。
> 只有被申请人能同意/拒绝，只有申请人能撤回；别人看不到我的好友列表。
> 拒绝/撤回会删除申请记录，之后可以重新申请；删除好友后也可以重新申请。

### 4.9 测试和部署

| 任务 | 文件 | 说明 | 状态 |
|---|---|---|---|
| 接口测试 | `tests/` | 注册、登录、名片、组队大厅、好友（49 个测试） | DONE |
| 部署文档 | `deploy/` | Nginx、PM2、环境变量 | TODO |
| 服务器部署 | Ubuntu + PM2 + Nginx | 后端监听 127.0.0.1:8000 | TODO |

## 5. 继续开发方式

1. 从 `dev` 新建功能分支：

```bash
git checkout dev
git pull
git checkout -b feature/backend-auth
```

2. 按任务清单修改对应文件。
3. 本地启动：

```bash
npm install
npm run dev
```

4. 访问健康检查：

```text
http://localhost:8000/api/v1/health
```

5. 完成后提交：

```bash
git add .
git commit -m "feat: implement backend auth"
git push -u origin feature/backend-auth
```

6. 在 GitHub 发起 Pull Request 到 `dev`。
