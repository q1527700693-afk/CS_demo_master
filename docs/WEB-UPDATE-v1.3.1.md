# v1.3.1 网页更新与缓存修复

线上新上传 Demo 的 performance 接口已返回完整六类 utility_throws，旧报告也可由私有补充记录提供次数。截图中“来自已归属到分析玩家的投掷记录”只存在于旧组件；新组件始终展示六种道具，缺记录时也会明确说明。投掷次数由后端解析完整 Demo，前端不另行上传次数。

排查时线上入口及组件文件已经更新，但 Nginx 的 HTML 响应没有 Cache-Control。此次将 HTML（包括 SPA 路径的回退入口）和 version.json 设为不缓存；带内容哈希的 assets 继续长期缓存。已有的旧缓存或已打开的旧页面仍需首次刷新，可以用带新查询参数的网址打开。服务器配置片段在 deploy/nginx-web-cache.conf，放入现有 server 块后执行 nginx -t 并 reload。

每次生产构建自动生成独立于版本号的网页构建标识，写入 HTML 和 version.json。更新后的客户端会在进入页面、回到标签页及每五分钟检查一次版本；新发布时提示手动刷新，保留当前路径与锚点。正在上传、解析或选择分析玩家时禁止通过该提示刷新。网络异常、无版本文件或非 JSON 响应不会触发提示，不自动重载页面。

发布时先复制新的 assets，保留旧哈希资源；再原子替换 index.html，最后原子替换同一构建生成的 version.json。不要用另一个发布清单覆盖 version.json。仅 package.json 的版本仍为 1.3.1。

GitHub 上传源码时包含此目录、deploy、vite.config.ts 和 src；dist 不必提交。无需重复上传 Demo 或删除旧报告。此次未修改桌面客户端，也未提交或推送 GitHub。
