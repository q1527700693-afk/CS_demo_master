# 完整瞄准训练模块接入

当前 `/training` 完整挂载队友提供的 VECTOR 训练场，替换了前端原来的训练卡片、注册表、独立游戏页、统一结算和模拟排行榜。

## 来源与同步

- 原始目录：`../training/CSPlatform/aim-trainer`。
- 前端运行副本：`public/vector-trainer/`。
- 同步命令：`npm run training:sync`，`npm run dev` 和 `npm run build` 也会先同步。
- 仅逐字节复制 `src/`、`vendor/`、`assets/` 和 `styles.css`，包含现有场景、模型、贴图与许可证。
- 不复制原独立入口、manifest、Service Worker、测试结果、浏览器运行时；平台不注册原游戏的离线缓存。
- `public/vector-trainer/integration-source.json` 记录每个文件的 SHA-256，可验证副本与队友原件一致。
- 如果单独分发 front_end 而没有 training 源文件夹，可使用已随项目保存的运行副本启动和构建。
- 不编辑或格式化 `public/vector-trainer/`；队友更新源目录后重新执行同步。

## 挂载与退出

`src/features/training/TrainingPage.vue` 通过 `loader.ts` 调用队友公开的接口：

```ts
const { mountTrainer } = await loadTrainerModule()
const trainer = mountTrainer(container, { embedded: true, onComplete: handleCompletedSession })
// 离开路由时：
trainer.destroy()
```

`loader.ts` 使用原生 `<script type="module" src=".../training-loader.js">` 加载静态接入入口，入口再导入原始训练模块。这样开发服务器和生产静态服务都按浏览器模块方式加载，避免 Vite 开发模式禁止从源码动态导入 public 文件的问题。接入入口只转交 mountTrainer，不改游戏内容；加载失败后可重新尝试，离开再回来复用已加载模块。

模块自己使用 Shadow DOM 隔离样式，完整保留训练、记录、教程、设置、五种模式和原始结算。
前端不改变玩法、计分、模型、输入处理或历史格式。卸载调用原 destroy，释放动画、输入监听、鼠标锁定及 WebGL 资源。
旧 `/training/:mode` 链接统一重定向到完整训练页，模式切换由原模块处理。

## 成绩接口边界

成绩继续按原实现保存到浏览器的 `vector.trainer.sessions.v1`，设置保存到 `vector.trainer.settings.v1`。
它们是当前浏览器共用的训练数据，不自动转换成按平台账号隔离的记录，也不自动上传云端。
原有历史、导出、清除确认及参数比较规则全部保留。前端旧模拟训练成绩与排行榜已删除，避免展示两套不同口径的数据。

宿主现在消费原有 `onComplete(session)`，为训练挂载时已登录且完成前身份未变化的账号保存本机名片最佳战绩。使用独立账号键，不读取或自动归属旧的共享历史，不改游戏内容或计分，不上传云端。名片仅对当前账号展示本机成绩，其他玩家暂无公开成绩。
后续接入云端成绩仍需后端实现并确认账号归属、同步意愿和 session.id 幂等策略。事件格式见原目录的 `INTEGRATION.md`；本机战绩边界见 [玩家名片与好友说明](PLAYER-CARDS-AND-FRIENDS.md)。

## 验证

```powershell
npm run training:sync
npm run build
npm test
```

运行平台后打开 `/training`，可直接使用原模块的全部功能；无需另启 4173 游戏服务器。
在浏览器中验证场景资源、各模式切换、训练结算与历史，以及从侧栏离开后的清理。

仓库还提供 `npm run test:training` 浏览器集成测试，默认连接独立预览 `http://127.0.0.1:5174`。需要可用的 Playwright 包和本地 Chrome；可通过 `PLAYWRIGHT_MODULE` 指定已有 Playwright 包路径、`TEST_URL` 指定预览地址，`BROWSER_EXECUTABLE` 指定浏览器。测试在隔离浏览器中运行，验证原件与副本的 SHA-256、五种模式、原始结算、历史记录、路由卸载和响应式布局。计分行为使用原模块自带测试；集成测试通过推进引擎时间缩短结算等待，不改游戏源文件。
