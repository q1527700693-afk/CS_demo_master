# CS Demo Master 前端框架

## 服务器部署说明

从 v1.0.1 起，公网部署的“我的复盘”读取后端保存的比赛和报告；仅本机 `localhost` / `127.0.0.1` 开发环境使用 `/local` 解析服务和本地资料库。公网 HTTP 页面没有 `crypto.subtle`，因此不能把本机资料库流程直接用于服务器页面。服务器仍建议配置 HTTPS；上传 ZIP 和云端复盘通过 `/api/v1` 访问后端。

面向软件工程课程小组独立开发的 Vue 3 + Vite + TypeScript 前端。代码集中在 `front_end`。登录、个人资料、好友、车队和 Demo 均已对接真实后端，训练仍是本地原游戏。好友与车队最新说明见 [好友车队联调](docs/SOCIAL-LOBBY-INTEGRATION.md)。

## 启动

本机完整联调：双击项目上一层的 `start-local.cmd`，同时启动前后端并自动打开页面；双击 `stop-local.cmd` 停止它启动的服务。详见 [本地测试说明](../本地测试说明.md)。

只启动前端时，Windows 双击本目录的 `start.cmd`，然后在浏览器打开终端显示的地址（默认 `http://127.0.0.1:5173`）。停止该前端服务时在终端按 Ctrl+C。
启动器优先使用已安装的 pnpm/npm，也兼容当前电脑随 Codex 提供的运行环境。
登录和资料需要先启动对应后端，默认地址为 `http://127.0.0.1:8000`。后端分支、启动命令和配置见 [账号与个人资料联调](docs/AUTH-PROFILE-INTEGRATION.md)。

打开或刷新应用会静音显示视频背景，最短约 2 秒；应用就绪且已满 2 秒后即进入主界面，无需等视频播完。加载较慢时视频继续循环，应用内切换页面不重复开屏。底部进度条结合应用加载阶段和这 2 秒的显示时间，满足进入条件后才到 100%。
视频位于 `public/media/startup.mp4`；启动、更新与异常处理见 [开屏加载说明](docs/STARTUP-SPLASH.md)。

在已安装 Node.js 的其他电脑上也可以运行：

```powershell
cd "D:\大学\软件工程\软件工程\front_end"
npm install
npm run dev
```

Node.js 要求 20.19+ 或 22.12+（建议使用当前 LTS）；团队统一使用 pnpm 时可用 `pnpm install` / `pnpm dev`，已提交 `pnpm-lock.yaml`。
`public/mockServiceWorker.js` 已生成；更新 MSW 后执行 `npm run mock:init`。

## 当前包含

- 响应式公共布局、导航、路由、404、加载 / 空数据 / 错误状态。
- 用户名注册登录、JWT 登录恢复、本地退出、登录失效处理、受限页面跳转。
- 个人名片、可选平台账号、独立 Steam 好友码、签名、游戏水平、找队友需求、其他游戏账号。
- 头像上传、替换与删除，顶栏同步更新；JPEG/PNG/WebP、2 MB 限制。
- 公开玩家名片 `/players/:userId`、通过玩家 ID 查看名片、复制名片链接。
- 玩家与好友：用户名/昵称搜索、好友列表、申请接受/拒绝/撤回、解除好友，与公开名片统一关系状态。
- 按账号分别保存本机五种训练模式的最佳战绩，参数分组比较；Demo 分析档案保留待开放区域。
- Demo 四阶段进度、本地工具连接入口、ZIP 上传、模块报告、道具轨迹图、历史和失败重试；支持真实后端分析。
- 真实车队大厅：模式筛选、分页、发布、领码/取消领码、队长发车/移除成员/删除，分享详情链接。
- 完整接入队友的 VECTOR 瞄准训练，保留五种模式、设置、训练、结算、记录与教程。
- 逐模块模拟接口开关、统一请求层、公共类型、接口协作文档。
- 统一模块注册、独立启用开关、页面按需加载与加载失败重试。

**训练游戏来自队友的 training 目录，运行副本按字节复制，未修改游戏内容。** 平台原来的训练占位卡片、结算页和模拟排行榜已删除。
名片与好友接口边界、训练归属和后端协作草案见 [玩家名片与好友说明](docs/PLAYER-CARDS-AND-FRIENDS.md)。
现已补齐本机 awpy 工具（工作区 local_parser），真实 Demo 到 ZIP 可以独立运行；云端接口由后端组实现。前端已预留本机 8877 的连接接口，也支持手工上传 ZIP。原始 Demo 不发到云端。

## 演示模式

默认账号与资料使用真实后端。离线演示时，在 `.env.local` 将 `VITE_MOCK_AUTH` 和 `VITE_MOCK_PROFILE` 都设为 `true`，重启前端后点击“使用演示账号进入”，或填写：

```text
用户名：demo_player
密码：Demo123456!
```

仅模拟模式的资料和复盘记录保存在当前浏览器本地；模拟新注册账号的凭据只在当前页面会话内存在，刷新后请改用演示账号。真实账号和个人名片由后端 SQLite 保存，前端只保存 JWT。
模拟上传只检查文件后缀、非空与大小，不解析 ZIP；使用固定合成数据展示四阶段流程。页面可下载五文件协议样例。演示不会解析所选 Demo 或调用云端算法。
当前道具图展示样例世界坐标的二维轨迹，未叠加地图雷达底图，不判断楼层或覆盖范围。
页面上的演示数据和状态不可代表真实后端完成度。

## 逐模块接真实后端

复制 `.env.example` 为 `.env.local`：

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_PROXY_TARGET=http://127.0.0.1:8000
VITE_MOCK_AUTH=false
VITE_MOCK_PROFILE=false
VITE_MOCK_REPLAY=true
VITE_MOCK_LOBBY=false
```

账号、资料和复盘保留可选模拟开关；好友和车队固定使用真实后端，旧 VITE_MOCK_LOBBY 开关不再生效。修改配置后重启开发服务器。
开发时 `/api` 和头像的 `/uploads` 都通过 Vite 转发。也可把 API_BASE_URL 设成完整地址，但需要后端允许对应前端 origin；头像地址会按 API 主机解析。
生产部署必须关闭全部模拟模块，配置同源 `/api` 反向代理，或在后端配置跨域允许。`VITE_` 变量会进入前端构建，不放服务端密钥。
用户身份相关模块优先一起联调；开启真实认证而保留其他模拟模块时，模拟模块使用前端已恢复的当前用户作本地演示身份。

## 目录与职责

```text
src/app/                 路由、模块注册 modules.ts、功能配置
src/layouts/             公共布局
src/components/          可复用显示组件
src/api/http.ts          fetch / 上传封装、统一错误处理
src/stores/              登录状态、全局提示
src/types/               账号/资料真实契约与其他模块待确认类型
src/features/auth/       登录注册
src/features/profile/    玩家资料
src/features/replay/     ZIP 上传、状态、报告
src/features/lobby/      车队
src/features/training/   完整训练模块的 Vue 挂载容器
src/mocks/               独立模拟网络层
public/vector-trainer/   队友训练模块的原样运行副本
scripts/sync-training.mjs 自动同步训练运行资源并记录 SHA-256
docs/                    后端接口协作和游戏接入说明
```

添加业务功能时，把页面、局部组件和 API 函数放进对应 features 目录。
页面通过该目录的 `api.ts` 访问数据，不直接读写后端数据库。公共 UI 放 components，跨页面身份放 auth store。
页面路由、导航入口及模块是否开放，统一在 `src/app/modules.ts` 注册；不必分别改路由和侧栏。

## 各功能模块的更新

见 [模块更新与扩展说明](docs/MODULE-UPDATES.md)，包括登录、个人资料、复盘、车队、瞄准训练和新增功能的具体入口。
各模块可独立改页面和 API 适配层。复盘、资料、车队、训练另有 `VITE_FEATURE_*` 启用开关；关闭后隐藏入口，旧链接显示暂未开放。
功能启用开关与 `VITE_MOCK_*` 模拟接口开关相互独立。修改环境变量后需要重启开发服务；正式版本需要重新构建并发布。
当前提供代码和资源层面的更新能力，尚未实现应用内下载补丁或云端自动更新服务。

## 接入成员的游戏

见 [游戏接入说明](docs/GAME-INTEGRATION.md)。当前 `/training` 使用队友公开的 `mountTrainer` 接口挂载完整模块，离开页面时调用 `destroy`。
`npm run dev` 和 `npm run build` 自动同步 `../training/CSPlatform/aim-trainer` 的运行文件，也可单独执行 `npm run training:sync`。只有训练页面会加载这些资源，不需要另开游戏服务器。
原模块的本地记录、导出及计分逻辑均保留，当前不自动同步云端；本地记录仍是同浏览器共用的数据。

## 接口协作

Demo 新功能交接见 [Demo 分析交接包](docs/analysis-handoff/README.md)，包含 OpenAPI、Schema、字段类型、ZIP 和报告样例。只包含前端及契约，需后端组按协议实现。

见 [接口约定与差异](docs/API-CONTRACT.md)。账号、资料、好友、车队和复盘已按真实后端联调；训练云端接口仍未实现。
联调时以双方确认后的 OpenAPI/接口文档为准，优先修改 features/*/api.ts 和类型定义，避免散改各个页面。

## 检查与部署

```powershell
npm run typecheck
npm test
npm run test:social    # 真实好友/车队/资料联调（隔离数据库）
npm run test:analysis  # 可选：需要外部 Playwright 与 Chrome，仅前端模拟测试
npm run build
npm run preview
```

`build` 输出 `dist/`。使用 HTTP 服务提供 dist，不能双击 index.html。
采用 history 路由，静态托管需把非文件页面路径回退到 index.html；`/api` 和 `/uploads` 路径必须优先转发到后端。
游戏代码由对应页面动态加载，图表库只在报告页加载。
认证读取后端的 `access_token`，使用 Bearer 请求；退出只清除本地 JWT，不调用尚未实现的退出接口。服务端未撤销的 JWT 在到期前仍有效。

## 本机真实 Demo 导出

新建复盘默认进入“本地解析并导出 ZIP”。先双击工作区根目录 start-local-parser.cmd，将 local_parser/token.txt 的令牌填入页面，输入昵称 → 选择 .dem → 读取玩家名单 → 选择 SteamID 并勾选确认 → 计算并导出 ZIP → 下载。当前工具已启动在 8877；不需要云端分析接口。独立安装、缓存和已知数据限制见 ../local_parser/README.md。

当前详细包使用 schema 1.1.0，提供目标玩家伤害/开火/物品/经济、状态样本和关联上下文。新版字段见 docs/analysis-handoff/DETAILED-DATA-v1.1.md；旧 Schema 与旧模拟样例为 1.0.0。

