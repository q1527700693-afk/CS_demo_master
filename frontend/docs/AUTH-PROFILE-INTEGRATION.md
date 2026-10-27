# 账号与个人资料联调

## 接入的后端版本

仓库：`https://github.com/q1527700693-afk/CS_demo_master`

分支：`dev`，本机当前验证提交 `08f705341c6faebfc5f284a050a30f0ef8f750bb`。该版本允许平台账号全部留空，新增独立的 Steam 好友码，并自动为旧数据库补充该列。注册可提交可选昵称；前端目前仍使用用户名作为默认显示名。
使用 Node.js + Express、SQLite、JWT、sharp；不是 main 根目录中的 Flask 注册登录，也不是原 FastAPI 空骨架。

本次前端已完成用户名注册/登录、注册后进入资料、JWT 登录恢复、受限路由、失效跳转、个人名片编辑及头像上传/替换/删除。车队与 Demo 保留模拟占位，原训练游戏与 2 秒最短开屏逻辑保持原样。

## 日常启动

当前电脑双击项目根目录的 `start-local.cmd`，会同时启动 `backend_service/backend` 和前端；用根目录的 `stop-local.cmd` 停止由它启动的进程。首次配置已完成，可直接在网页注册自己的账号。[本地测试说明](../../本地测试说明.md) 包含数据位置、日志和更新方法。

需要手动运行后端时，在后端仓库切到 `dev`，进入 `backend` 目录运行：

```powershell
git switch dev
cd backend
npm install
Copy-Item .env.example .env
npm run dev
```

只在第一次配置时复制 `.env.example`；已有 `.env` 时保留原配置。后端需要支持 `node:sqlite` 的 Node 22.13+ 或较新 LTS，本次使用 Node 24.19 验证。
默认监听 8000，创建 `backend/data/app.db` 和头像上传目录。团队提供远程后端时，不必在自己的机器运行这一份，可直接将代理目标指向团队服务地址。

前端使用下列配置（`.env.example` 和代码默认值已按此设置）：

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_PROXY_TARGET=http://127.0.0.1:8000
VITE_MOCK_AUTH=false
VITE_MOCK_PROFILE=false
VITE_MOCK_REPLAY=true
VITE_MOCK_LOBBY=true
```

然后在 `front_end` 双击 `start.cmd`，或 `npm run dev`。环境变量改动后重启前端服务。已有 `.env.local` 优先于默认值，若仍显示演示账号按钮，检查这两个账号/资料开关是否仍为 true。
开发代理同时转发 `/api` 和 `/uploads`，保证头像可见。正式托管也需要这两条转发，或者将 API 地址设为完整跨域地址并配置后端 CORS。

日常后端目录是项目根目录下的 `backend_service/backend`，账号保存在其 `data/app.db`，头像保存在其 `uploads/avatars`。浏览器测试使用该后端代码但连接独立的 `front_end/test-results/dev-backend-20261020.db`；测试数据与日常本地数据、团队数据库分开。本次没有向团队服务器或线上数据库写入测试账号。

## 表单与后端约束

- 用户名 3–32 位英文字母、数字、下划线；密码 8–128 位。注册只提交用户名和密码，确认密码只在前端校验。
- 注册响应含 JWT，前端自动进入个人资料；从受限页面跳来的注册/登录仍优先返回该页。
- 账号返回的 nickname 可为 null，显示时回退到 username。后端没有提供修改昵称的接口，因此当前不显示可编辑昵称、邮箱或旧的学校/地图字段。
- Steam ID、Steam 好友码、完美世界和 5E 都可留空，可以只保存签名等资料，也可清空已填写的平台字段。Steam ID、完美和 5E 仍有跨用户唯一约束；好友码单独存储，要求 6–12 位数字，保留前导零，不会自动转为 SteamID64。上传头像不要求先绑定账号。
- 个性签名最多 200 字、游戏水平 32 字、找队友需求 100 字；其他游戏最多 5 个，每行游戏名和账号均必填、最多 32 字。
- 头像仅 JPEG/PNG/WebP，最多 2 MB；服务端还会真实解码验证，转换为 512×512 JPEG。保存成功才更新页面和顶栏，失败保留旧头像；删除头像不清空尚未保存的表单。
- 资料名片通过后端公开接口可供其他玩家查看，前端展示页为 `/players/:userId`；个人编辑页可点击“查看我的名片”。好友和公开战绩接口尚未提供，详见 [玩家名片与好友说明](PLAYER-CARDS-AND-FRIENDS.md)。

退出登录清除本地 JWT，不调用不存在的退出接口。因为后端 JWT 暂不提供撤销，已签发的 token 在到期前仍可能有效。

## 离线演示（可选）

将 `VITE_MOCK_AUTH` 与 `VITE_MOCK_PROFILE` 都改为 true 并重启，使用 `demo_player / Demo123456!`。模拟接口也使用 username、access_token 和个人名片字段，不会继续走旧邮箱协议。
模拟账号新注册密码只存在当前页内存中；刷新后使用固定演示账号。正式真实注册账号由后端保存，不受此限制。

## 验证

```powershell
npm test
npm run build
```

`tests/account-integration.cjs` 为可选真实浏览器测试，使用外部 Playwright；`PLAYWRIGHT_MODULE` 指向依赖位置，`TEST_URL` 指向临时前端（默认 5174），`TEST_BACKEND` 指向本地测试后端（默认 18000）。
只对独立本地测试数据库运行，它会真实注册测试用户、保存名片和上传/删除测试头像。前端测试服务的代理目标也必须指向该测试后端，并保持账号与资料模拟关闭。

```powershell
npm run test:accounts
```

测试涵盖真实注册/登录、刷新恢复、资料持久化、空平台保存、独立好友码校验与保存、清空全部平台字段、Steam 规范化、平台冲突、头像完整流程、JWT 失效以及车队/Demo 仍为模拟占位。

2026-10-21 更新前已将日常数据库、头像和后端配置备份到 `front_end/test-results/update-20261021/backup/`。自动迁移后逐项核对原有账号记录（含密码哈希）、资料旧字段、头像文件和配置均未变化；`test` 账号保留。备份包含私有本地数据，留在被忽略的测试结果目录，不应提交到公共仓库。
