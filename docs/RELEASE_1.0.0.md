# Mineradio 桌面歌词 1.0.0

官方网易云负责播放，Mineradio 独立显示动态桌面歌词。

## 下载

- **普通用户：[Windows x64 Setup.exe](https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics/releases/download/v1.0.0/Mineradio-Desktop-Lyrics-1.0.0-x64-Setup.exe)**
- 可选便携版：Mineradio-Desktop-Lyrics-1.0.0-x64-Portable.zip，与安装版二选一。
- Source.zip 是对应构建源码；Bridge 0.4.3 ZIP 仅供单独部署/恢复，不是 EXE 用户必需附件。
- SHA256SUMS.txt 提供本次实际附件校验值。

## 首次使用

安装并打开 Mineradio 桌面歌词，无需 Node/npm。按向导选择正在使用的原版网易云和 BetterNCM profile。受支持依赖就绪时，点击“配置／更新内置 Bridge”并确认即可，无需另下 Bridge 文件；匹配文件复用、旧文件先备份，只改本项目文件。更新后请自行正常重启网易云，不会强制中断音乐。

Setup 不含网易云、BetterNCM、InfLink。缺项会明确显示，并提供固定版本官方发布页及本地说明。已知组合为 Windows 11 x64 / 网易云 3.1.42.205594 x64 / BetterNCM 1.3.4 x64 / InfLink 3.4.0 / Bridge 0.4.3。其他组合未验证；不会替换未知 DLL、自动降级或复制客户端。

## 本版内容

保留真实 InfLinkApi 歌曲身份、时间轴与 PCM 节奏，长句滚动、逐字高亮、前奏提示及漏词修复，分文字系统字体、封面配色、自定义字幕和面板标题，用户认可的 DSH 暖白前端及新图标。

Ctrl+Alt+H 显隐，Ctrl+Alt+L 锁定/解锁拖动。托盘可设置、重试歌词、重新配置连接或独立退出；退出歌词不退出音乐。设置沿用原用户目录与 EFS 兼容；升级/卸载保留设置和位置，不删除网易云、音乐、账号与其他插件。

## 验收与限制

本轮完成正式版本化、必要首次配置接线、构建与版本/清单/许可/源码/SHA-256 静态核对，以及远端发布核对。未运行测试套件、安装/升级/卸载、候选应用或播放测试；先前主机体验不代表新包经过全新环境验收。当前未签名，Windows 可能提示未知发布者，请核对来源与哈希，不要关闭系统防护。音源权限、接口和客户端兼容性仍影响歌词/PCM。额外背景模板等待用户模板。

基于 XxHuberrr/Mineradio-paused，GPLv3；保留上游作者、Electron/Chromium、Instrument Sans OFL、NSIS 许可及素材来源。没有分发客户端、账号、系统字体或认证会话。
