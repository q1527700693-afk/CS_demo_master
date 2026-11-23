# 复盘报告界面与扩展约定

更新：2026-10-24。

## 页面组织

- 比赛概览：个人关键指标、回合胜负走势、击杀与阵亡分布、经济走势、攻防表现、前三项复盘重点。
- 回合复盘：真实雷达底图、移动路线、已归属/未归属道具、附近玩家采样、阵亡位置、播放与时间线、事件定位。
- 道具与生存：闪光效果对比、道具投掷分布、阵亡前状态、每页六项的复盘重点。
- 详细数据：逐回合统计、可展开武器明细、事件筛选与分页、可展开原始记录、数据说明和分析历史。

旧链接中的 `#report-map`、`#report-modules`、`#report-findings`、`#report-events` 和 `#report-performance` 自动映射到新视图。自动上传、身份确认、后端接口与分析业务规则保持兼容。

参考公开产品工作流：

- [Skybox EDGE](https://skybox.gg/edge/)：比赛报告、队伍分析和二维回放的分工。
- [Refrag Demo Review](https://refrag.gg/blog/how-to-view-cs2-demos-online/)：地图、时间线与道具过程联动。

界面并未复制其页面代码或商业资产。当前后端的数据范围是“目标玩家及相关上下文”，不将它包装成十名玩家持续可见的完整战队回放。

## 组件边界

| 文件 | 职责 / 扩展方式 |
| --- | --- |
| `src/features/replay/AnalysisDashboard.vue` | 报告布局、选项卡与回合/事件跳转。新视图在这里接入。 |
| `useReplayReport.ts` | 身份校验、加载状态、报告/详情/事件/历史读取、重新分析与导出。视图不自行拼接接口。 |
| `review-presentation.ts` | 中文文案、武器名、指标解释、复盘规则映射与优先顺序。新规则先补明确事实与行动文案。 |
| `ReviewOverview.vue` | 概览指标图表和优先复盘入口。 |
| `ReviewRounds.vue` / `RoundMap.vue` | 回合事件、地图图层、时间控制。地图数据按回合分页加载，切换时取消旧请求。 |
| `ReviewUtility.vue` | 道具与阵亡状态；各状态可能重叠，不能相加作占比。 |
| `ReviewData.vue` | 详细表格、搜索与原始数据核验。 |
| `radar-data.ts` / `radar-metadata.json` | 版本化底图注册、世界坐标变换、楼层过滤、采样时效与轨迹时间裁切。 |
| `review.css` | 只作用于 `.review-dashboard` 的样式变量与布局原语。避免修改全站 CSS。 |

新增后端指标时，先在 `contracts.ts` 扩展类型，再在对应视图中设计有解释的展示。不要恢复遍历所有后端键名直接输出的模式。未计算指标不占主页面卡片；未知值显示“—”，实测零保留为零。未知事件可在详细数据中核验，不直接显示英文内部字段。

新增规则在 `reviewRules` 注册标题、回看操作和基础优先级；保留具体回合、时刻与证据 ID。闪光按实测持续时间排序，排序代表回看顺序，不代表失误分数。不要把“携带道具阵亡”等单一事实自动改写成战术失误。

## 雷达资源与更新

地图源：[pnxenopoulos/awpy-data](https://github.com/pnxenopoulos/awpy-data)，固定版本 [2000933](https://github.com/pnxenopoulos/awpy-data/releases/tag/2000933)，游戏构建 25966348。

- 原始下载：`images.zip`、`map_data.json`、`manifest.json`，均来自同一版本。
- 已校验图片压缩包 SHA-256：`6a6533e28b8b9da40060d542c942886b5b5b18b086de0e0648f81fb73f9c2c9f`。
- 运行时图片放在 `public/maps/2000933/radars/`，只从本地静态服务加载。
- 坐标元数据原件保留在 `public/maps/2000933/`；代码使用其副本 `radar-metadata.json`，避免从 public 目录导入 JS 资源。
- 图片是从 CS2 游戏资产提取的雷达，原始游戏资产权利归 Valve；awpy-data 构建脚本使用 MIT 许可。不要将构建脚本许可误当作游戏图片的许可。

更新时下载并校验同一版本的图片与坐标数据，新增版本目录，同步 `RADAR_VERSION`、`radar-metadata.json` 和注册地图列表。不要仅替换图片。旧录像可能对应不同地图构建，目前分析包没有提供足够信息自动匹配历史地图版本；界面中的地图说明展示所用底图版本。将来可由分析包 `asset_version` 与地图资源注册表实现版本选择。

1024 像素北向雷达坐标沿用 Awpy 的变换：`px = (x - pos_x) / scale`，`py = (pos_y - y) / scale`。`rotate`/`zoom` 是游戏 HUD 参数，不能再次旋转或缩放静态导出的雷达 PNG。核子危机等多层地图按元数据的高度分界过滤位置，提供上/下层选择。未知地图或底图加载失败时显示明确空状态，不绘制缺乏地图参照的线。

时间线以回合冻结时间结束为起点，按比赛 tick_rate 换算秒数。采样只取当前时刻之前、不超过一秒的记录，不延用过期位置，不把阵亡后的最后存活位置作为当前状态。没有逐点时间的轨迹仅在结束后或整回合总览展示，不捏造中间飞行过程。未归属道具使用虚线，仅作场内上下文，不计为目标玩家投掷。

## 验证入口

```powershell
node node_modules/vue-tsc/bin/vue-tsc.js -b
node node_modules/vitest/vitest.mjs run
node node_modules/vite/bin/vite.js build
node tests/replay-backend-integration.cjs
node tests/automatic-demo-integration.cjs
```

报告联调使用独立的 SQLite 与上传目录、18080 后端端口和 15174 前端端口，不写入日常用户的比赛记录。原始 Demo 回归使用独立云端数据和已运行的本地解析服务 8877。浏览器截图与结果保存在 `test-results/review-redesign-20261024/` 和 `test-results/automatic-demo-20261024/`。

新增七项单元测试覆盖固定坐标映射、多层地图、过期/未来/死亡采样、未定时轨迹、长闪光优先级、真实背包道具和未知字段的展示。浏览器联调另比对实际样本坐标与 SVG 位置、测试事件定位、播放、快速切换、道具图层、数据筛选与分页、移动端、缺失底图、重新分析和 ZywOo 实例。

2026-10-24 完成验证：类型检查通过，45 项单元测试通过，生产构建通过；真实后端报告联调和原始 Demo 自动流程回归均通过。ZywOo 样例显示 19 / 9 / 7，优先事件定位到第 17 回合 76.90625 秒，队友受闪 4.11 秒。桌面和 390px 手机布局无页面横向溢出，浏览器无运行时异常。日常 5173 服务已确认报告组件、地图图片返回 200，8000 后端健康检查正常。
