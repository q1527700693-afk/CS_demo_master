# 当前运行资产归属

assets/manifest.json 中的 Valve-local-game-content 文件来自本机已安装的 Counter-Strike 2，模型与纹理版权归 Valve Corporation。本轮按用户要求用于本地训练原型，没有对外发布，也不将这些资产声明为 CC0 或 MIT。

本地调整包括：提取 USP-S body_hd 与 SAS 第一人称手套/袖口；从 Valve 第一人称 idle_pistol 动画解码原始握姿，按 wpn 挂点对齐 USP 并离线烘焙；压缩纹理并嵌入 GLB。灰白空间由项目代码生成，当前清单不再包含 Dust II 建筑、拱门或沙地。资源路径与文件校验值见清单，重建方法见 ASSET_RESEARCH.md。

Source 2 Viewer 的 MIT 许可只对应转换工具；Three.js 的 MIT 原文保留在 vendor/three/LICENSE。

前轮留在 assets/factory/ 与 assets/concrete/ 的文件来自 Poly Haven（CC0；作者 James Ray Cock 和 eye-candy.xyz）。这些历史文件不在当前运行或 dist 构建清单中。

assets/decor/character-T-butterfly-ruby.png 是用户提供的原始图片，逐字节复制，标记 User-provided，未声明开放许可。原图保留用于溯源；当前墙贴使用派生文件 character-T-butterfly-ruby-cutout.png，由内置 imagegen 去除背景，保留 RGBA 透明通道。两侧共用透明文件，右侧镜像由 UV 坐标实现；原图不进入当前构建清单。处理提示词保留在 assets/decor/cutout-prompt.txt。
