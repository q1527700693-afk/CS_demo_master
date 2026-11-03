# 网页版 1.3.0

在 1.2.1 的选人、历史、删除、地图和 AI 排队修复上增加战术分析，并保留服务器尚未同步到 GitHub 的增强。

## 功能

- 报告新增“战术分析”页，默认选择当前分析玩家所在队伍，可切换双方视角。
- Dust2 展示 CT 防守站位、守住率、回防时间、转点速度与反向包点放空，以及逐回合进攻倾向、经济与出生位、实际结果、亮点和建议。
- 支持原始逐武器亮点和线上按玩家合并的多武器亮点；展示武器影响与采样变化。武器影响不是综合评分，倾向分不是胜率，采样变化不是确定的拾枪记录。
- 回合按钮切换到回合复盘；事件列表中存在的证据可定位到地图，未加载的证据禁用跳转。
- 队伍/报告切换取消旧请求；接口失败可重试。缺少数据保留“—”，不把未知守住率显示成 0%。
- 非 Dust2、本地及 ZIP 报告显示适用范围；旧服务缺少接口时显示可重试提示。
- 390px 手机布局适配。版本号 1.3.0；桌面源码与安装包未修改、未重新打包。

## 接口

共用现有登录令牌与 /api/v1 前缀：

- GET /demo-analyses/{id}/teams
- GET /demo-analyses/{id}/dust2-summary?team={encodedTeam}&maxRounds=10&scoutRounds=6

新页面仅调用云端原始 Demo 接口。保留既有 ZIP、个人资料、好友、组队大厅和 AI 接口。线上已提供以上接口，本次发布只更新前端；开发机 backend_service 仍是旧版本，未覆盖其未提交修改。

## 构建与交付

把交付源码目录的内容放到仓库 frontend/，不要额外嵌套版本文件夹。关闭 VITE_MOCK_AUTH、VITE_MOCK_PROFILE、VITE_MOCK_REPLAY，设置 VITE_API_BASE_URL=/api/v1，然后执行 pnpm build。

验证：pnpm test、pnpm typecheck、pnpm test:tactical；上传/历史/AI 的既有集成回归使用 tests/v121-integration.cjs，需要 CSDM_TEST_CLOUD_BACKEND 指向支持 1.2.1 接口的隔离测试后端。浏览器战术测试使用合成 HTTP 响应，不调用付费模型。

发布记录、产物哈希与回滚位置见工作区 docs/frontend-v1.3.0/DEPLOYMENT.md。GitHub 由仓库所有者自行提交上传。
