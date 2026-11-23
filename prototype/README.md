# CS Demo Master 课程交互原型

使用 Figma 制作设计画布，并以单文件网页提供完整的交互演示。原型基于 `front_end/src` 的模块、流程和视觉样式；比赛与玩家数据是演示数据。

## 交互演示

- `figma-source.html`：34 个状态界面、页内 Hash 导航、145 个页面链接。
- `publish/index.html`：与上述内容相同，供静态网站托管。
- `cs-demo-master-web-prototype.zip`：网页发布包，包含 `index.html` 和 `.nojekyll`。
- `figma-frames/`：各界面的预览图和链接热区清单；`figma-layout.json`：可编辑画布的几何与文字数据。

从首页可以到达全部 34 个界面，所有页面链接均指向现有界面。已在本地 Chrome 验证报告四标签和车队发布、管理、发车流程。

## Figma 设计文件

[CS Demo Master · 软件工程交互原型](https://www.figma.com/design/iseRACZAMwJMohHfqKDkEP)

当前 Figma 中有 31 个可编辑界面画布。由于账号的 Starter/View 席位达到当月 MCP 调用上限，尚未导入最后 3 个画布，也未建立 Figma 原型连线。完整可点击流程在网页演示文件中；提交前须确认老师可以访问公开网页链接，并在博客中如实说明 Figma 设计稿与网页演示各自的用途。

重新生成网页：`python build_figma_source.py`。重新提取画布数据：`node extract_figma_layout.cjs`。

## 公开在线演示

[CS Demo Master · 34 页可点击原型](https://hajiyao.github.io/cs-demo-master-prototype/)

GitHub Pages 已部署；线上 Chrome 检查通过：HTTP 200、34 个界面、报告四标签、发布车队到发车流程。
