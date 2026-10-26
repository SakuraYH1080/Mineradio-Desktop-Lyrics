# 改造关系与署名

本项目由 SakuraYH1080 整理公开，基于 **XxHuberrr/Mineradio-paused** 的桌面歌词渲染与视觉设计改造，非原项目官方发行，也非网易云官方产品。

上游：https://github.com/XxHuberrr/Mineradio-paused

提取基准：`d43de565acabfdc1a9c9820a27e81a98ccbebcef`。保留 GPL-3.0-only LICENSE；原作者署名和原始致谢另见 docs/UPSTREAM_NOTICE.md（其中许多原播放器组件未被本项目分发）。

- vendor/desktop-lyrics.html：提取的桌面歌词渲染器，已修改外部状态接入、高亮重置、长句滚动与定位、字体布局、显隐和交互边界；保留原漂浮、缩放、发光风格。
- vendor/overlay-preload.js：沿用原 IPC 接口并补充独立窗口状态与显隐报告。
- vendor/lyrics-fetch-parse.js：保留原解析模块，在隔离 Node VM 中读取定义；外层适配 LRC offset、逐字定位和纯音乐识别。
- src/palette.cjs：从上游 public/js/modules/02-visual/07-lyrics-palette-text-utils.js 的亮度／色度评分与约520ms插值作最小适配。原文件 SHA256：51a4db8492da0b298be967e0e001a7a97635c8781c969e17a1623eca93ec4a3d。
- 窗口和中键处理参考 desktop/main.js；新增外部时间轴、认证桥接、PCM分析、配置保存、显隐和设置界面。

研究参考：Widdit/now-playing-service（c6cfc33997ca5b63fe64975ca3037acc72ae7366）、apoint123/inflink-rs（API基准 e4ad4946ce24f63b99082fe8be3f30ca92d4428e）。未捆绑整套参考服务。

未包含上游播放器首页、登录、Three.js 场景、第二套音乐播放引擎或第三方平台客户端。
