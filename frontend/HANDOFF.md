# 前端 v1.0 交接说明

此文件夹是可单独交给队友的前端源码版本，包含 Vue/TypeScript 源码、静态资源、训练模块运行副本、依赖锁文件、测试和接口文档。无需复制原工作区的 `training` 目录即可构建和运行前端。

## 启动

1. 安装 Node.js 20.19+ 或 22.12+，并启用 pnpm 11.25.0（可通过 Corepack 使用）。
2. 在此文件夹运行 `pnpm install --frozen-lockfile`。
3. 按需复制 `.env.example` 为 `.env.local`，配置后端地址。
4. 运行 `pnpm dev`，打开 `http://127.0.0.1:5173`。Windows 也可双击 `start.cmd`。

运行 `pnpm build` 生成生产构建，运行 `pnpm test` 执行前端单元测试。`dev` 和 `build` 会检查同级目录的训练游戏源码；若不存在，则直接使用此包内 `public/vector-trainer` 的完整运行副本。

## 联调边界

- 账号、资料、好友、车队和在线复盘接口依赖单独运行的后端，开发代理默认指向 `http://127.0.0.1:8000`。接口说明在 `docs/`。
- 本地 Demo 解析依赖单独运行的 `local_parser` 服务，默认端口为 8877；相关令牌不会包含在交接包中。只运行前端时，这部分功能需要队友自行接入服务。
- 原工作区根目录的 `start-local.cmd`、`stop-local.cmd`、`backend_service`、`local_parser` 和测试 Demo 文件不在此包内；需要完整联调时应单独获取对应模块。
- `tests/` 中部分集成测试依赖上述服务或测试数据；`pnpm test` 的单元测试可独立运行。

交接包不包含 `node_modules`、`dist`、测试运行输出、`.env.local` 和历史原型文件。原项目的详细功能介绍见 [README.md](README.md)。
