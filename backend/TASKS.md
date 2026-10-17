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
    │   ├── demos.js
    │   └── minigames.js
    ├── services/
    │   ├── authService.js
    │   ├── profileService.js
    │   ├── lobbyService.js
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
| 统一响应工具 | `src/utils/response.js` | 封装 success/error 返回 | TODO |
| 错误处理中间件 | `src/middlewares/errorHandler.js` | 已创建，后续完善 | DOING |
| 环境变量 | `.env.example` | PORT、JWT_SECRET、DB_PATH | TODO |

### 4.2 数据库

| 任务 | 文件 | 说明 | 状态 |
|---|---|---|---|
| SQLite 连接 | `src/config/database.js` | 使用 `node:sqlite` | TODO |
| users 表 | `src/config/database.js` | id, username, password_hash, nickname, avatar_url | TODO |
| user_profiles 表 | `src/config/database.js` | bio, steam_id, perfect_world_id, five_e_id, other_game_ids | TODO |
| lobbies 表 | `src/config/database.js` | 组队大厅 | TODO |
| lobby_members 表 | `src/config/database.js` | 队伍成员和准备状态 | TODO |
| demo_analyses 表 | `src/config/database.js` | Demo 日志和分析报告 | TODO |
| minigame_scores 表 | `src/config/database.js` | 小游戏分数 | TODO |

### 4.3 认证模块

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| POST `/api/v1/auth/register` | `src/routes/auth.js`, `src/services/authService.js` | 用户名唯一，密码 bcrypt 哈希 | TODO |
| POST `/api/v1/auth/login` | `src/routes/auth.js`, `src/services/authService.js` | 校验密码，返回 JWT | TODO |
| GET `/api/v1/users/me` | `src/routes/users.js`, `src/middlewares/auth.js` | 根据 token 返回当前用户 | TODO |

### 4.4 个人名片模块

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| GET `/api/v1/users/me/profile` | `src/routes/users.js` | 返回自己的名片 | DOING |
| PATCH `/api/v1/users/me/profile` | `src/routes/users.js` | 编辑个性签名、Steam ID、完美 ID、5E ID、其他游戏 ID、水平、想找队友 | DOING |
| GET `/api/v1/users/:userId/profile` | `src/routes/users.js` | 查看公开名片 | DOING |
| POST `/api/v1/users/me/avatar` | `src/routes/users.js` | 上传头像，JPG/PNG/WebP，最大 2MB，压缩到 512x512 | DOING |
| DELETE `/api/v1/users/me/avatar` | `src/routes/users.js` | 删除头像 | DOING |

> 实现位置：`src/routes/users.js` + `src/services/profileService.js`，
> 测试在 `tests/profile.test.js`（`npm test`）。
> 随 4.4 一起提供的最小依赖：`src/config/database.js`（users / user_profiles
> 建表）、`src/utils/response.js`、`src/middlewares/auth.js`、
> `src/services/authService.js` 与 register / login / me。4.1–4.3 的负责人可以
> 直接在此基础上继续或替换。
> 字段命名：接口用平台自己的叫法 `wanmei_id` / `5E_id`（5E 以数字开头，数据库列
> 与内部属性为 `five_e_id`，请求两种写法都接受）。个性签名存在 4.2 规划的 `bio`
> 列里，接口字段名为 `signature`，入参也接受 `bio`。

### 4.5 组队大厅模块

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| GET `/api/v1/lobbies` | `src/routes/lobbies.js` | 获取队伍列表 | TODO |
| POST `/api/v1/lobbies` | `src/routes/lobbies.js` | 创建队伍 | TODO |
| GET `/api/v1/lobbies/:id` | `src/routes/lobbies.js` | 队伍详情 | TODO |
| POST `/api/v1/lobbies/:id/join` | `src/routes/lobbies.js` | 加入未满员队伍 | TODO |
| DELETE `/api/v1/lobbies/:id/leave` | `src/routes/lobbies.js` | 退出队伍 | TODO |
| POST `/api/v1/lobbies/:id/ready` | `src/routes/lobbies.js` | 切换准备状态 | TODO |
| DELETE `/api/v1/lobbies/:id` | `src/routes/lobbies.js` | 队长解散队伍 | TODO |

> 不做聊天和发消息功能。

### 4.6 Demo 和 AI 模块

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| POST `/api/v1/demos` | `src/routes/demos.js` | 上传 Demo 日志并创建分析任务 | TODO |
| GET `/api/v1/demos` | `src/routes/demos.js` | 查询自己的分析历史 | TODO |
| GET `/api/v1/demos/:id/status` | `src/routes/demos.js` | 查询分析状态 | TODO |
| GET `/api/v1/demos/:id/report` | `src/routes/demos.js` | 获取 AI 报告 | TODO |
| POST `/api/v1/demos/:id/analyze` | `src/routes/demos.js` | 重新触发分析 | TODO |

AI 分析先调外部 LLM API，不在服务器本地跑大模型。

### 4.7 小游戏模块

| 接口 | 文件 | 要求 | 状态 |
|---|---|---|---|
| POST `/api/v1/minigames/aim/scores` | `src/routes/minigames.js` | 提交小游戏分数 | TODO |
| GET `/api/v1/minigames/aim/leaderboard` | `src/routes/minigames.js` | 获取排行榜 | TODO |

### 4.8 测试和部署

| 任务 | 文件 | 说明 | 状态 |
|---|---|---|---|
| 接口测试 | `tests/` | 注册、登录、名片、组队大厅 | TODO |
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
