<img src="public/icons/app.svg" width="80" height="80" alt="Mineradio 桌面歌词">

# Mineradio 桌面歌词

继续用官方网易云 Windows 客户端选歌和播放，独立显示 Mineradio 风格的动态桌面歌词。

**[下载 1.0.0 正式版 Windows x64 安装包](https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics/releases/download/v1.0.0/Mineradio-Desktop-Lyrics-1.0.0-x64-Setup.exe)** · [正式版便携包](https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics/releases/download/v1.0.0/Mineradio-Desktop-Lyrics-1.0.0-x64-Portable.zip) · [发布说明与校验文件](https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics/releases/tag/v1.0.0)

**[下载 1.1.0-rc.2 预发布版](https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics/releases/tag/v1.1.0-rc.2)**。候选包使用 Windows 的共享 Microsoft Edge WebView2 Evergreen Runtime。缺少运行时的设备可从微软下载安装。[WebView2 下载](https://developer.microsoft.com/microsoft-edge/webview2/#download)

安装版与便携版二选一即可。普通用户无需安装 Node、npm 或开发环境；源码 ZIP 用于开发和复现构建。

## 安装与首次使用

1. 下载并运行 Setup.exe，选择安装目录。完成后从桌面或开始菜单打开 **Mineradio 桌面歌词**，直接运行 GUI EXE。
2. 按首次连接向导核对自己的原版网易云路径、BetterNCM profile 及插件状态。已具备受支持的 BetterNCM / InfLink 时，点 **配置／更新内置 Bridge**，确认目标目录后完成配置，无需另下或手工复制 Bridge ZIP。匹配文件不重复复制，旧桥接文件会先备份。
3. 如有更新，自己从网易云托盘正常退出再打开，使插件加载；然后正常播放。歌词程序不会强制结束音乐，也不会复制第二套客户端。

**安装本程序不等于网易云联动依赖已经就绪。** Setup 内置本项目 Bridge；网易云、BetterNCM 与 InfLink 二进制不分发。缺少第三方依赖时，向导显示缺项，并可打开固定版本的官方发布页；按[安装与连接说明](docs/INSTALL_1.0_RC.md)完成外部配置。不会覆盖未知 DLL、自动降级或重装网易云。存在多个安装/profile 时，请选自己实际使用的原版。

已有验证组合为 **Windows 11 x64、网易云 3.1.42.205594 x64、BetterNCM 1.3.4 x64、InfLink-rs 3.4.0、MineradioBridge 0.4.3**。自动 Bridge 部署仅在这些已记录的客户端／加载器／InfLink 条件匹配时开放；其他版本尚未验证。文件检测与真实连接状态分开判断，不宣称任意版本装完即用。

1.0.0 和已生成的未签名候选包可能触发 SmartScreen 提示。正式签名附件会在构建记录中列出经 Windows 验证的发布者和签名状态。[Windows 签名与 GitHub 发布](docs/WINDOWS_SIGNING.md)

## 已有功能

- 透明独立桌面歌词，锁定穿透与解锁拖动，立即显隐。
- InfLinkApi 真实歌曲身份与时间轴，暂停、跳转、切歌校正，长句横向滚动及逐字高亮。
- 前奏歌曲信息、LRC/YRC 选择与解析修复、纯音乐与失败等状态区分。
- 真实 InfLink PCM 驱动漂浮、发光、低音与节奏效果；不播放第二份音乐、不采集麦克风。
- 跟随封面配色／固定颜色，自定义状态字幕、面板标题及字幕预览。
- 通用、中文、拉丁、日语、韩语、西里尔文字字体与混排后备，只使用本机字体。
- 保留已确认的暖白 DSH 设置前端、专属应用图标及 EFS 保存兼容。

## 日常操作

- `Ctrl+Alt+H`：隐藏／显示歌词，再次运行入口可唤回已有窗口。
- `Ctrl+Alt+L`：解锁拖动／锁定穿透。
- 托盘 → **歌词设置**：字幕、配色、字体、面板标题、预览、保存及恢复默认。
- 托盘 → **网易云连接设置**：只重启歌词并重新打开连接向导，音乐继续。
- 托盘 → **退出**：仅退出歌词，网易云继续播放。

歌词隐藏 5 秒后会释放渲染窗口，播放连接继续运行。再次显示时先同步当前歌词，再显示窗口。

设置、连接配置与窗口位置保存在 `%APPDATA%\MineradioExternalLyrics`，升级和卸载默认保留，沿用旧单字体迁移及 EFS 兼容。卸载仅删除本程序登记的安装文件和入口，不删除网易云、账号、音乐、第三方插件或私人备份。

## 常见问题与限制

- **未连接**：在托盘重新打开连接设置，确认实际客户端/profile、固定依赖和内置 Bridge，正常重启网易云加载插件；文件齐全不代表运行会话已连通。
- **更新 Bridge**：仅经明确确认更新本项目五个文件；备份在用户配置目录的 `bridge-backups`，保留会话文件与其他插件。独立 Bridge ZIP 仅供部署/恢复，不是 EXE 用户的额外必需下载。
- **没有歌词或节奏**：受歌词接口、歌曲权限、客户端与 InfLink 音源能力影响；不绕过权限。部分 PCM 没有可靠原生 PTS，保留质量标记，回调接收时间不代表声学采样时间。
- **字体缺字**：使用后备字体；代表文字预览不等于完整字库覆盖。纯汉字语言不确定时可用现有语言选项纠正。
- **安装候选升级**：退出旧歌词再运行新版安装器，音乐可继续。手工部署目录不会被自动删除；不要同时运行两套歌词入口。

## 源码与构建

构建需要 Windows x64、带 C++ 桌面开发组件和 Windows SDK 的 Visual Studio 2022 或更新版、Node.js ≥22.12 及 Python ≥3.10。构建脚本按 `build/runtime.json` 下载和校验 Node.js x64 可执行文件与 WebView2 SDK。Electron 开发入口仍可用，NSIS 使用已经构建的 Win32 应用目录。

```powershell
npm ci
python tools/build-desktop.py --output .runtime/release-1.1.0-rc.2
npm run build:setup -- --prepackaged .runtime/release-1.1.0-rc.2 --output artifacts/1.1.0-rc.2
python tools/package-candidate.py --directory .runtime/release-1.1.0-rc.2 --release artifacts/1.1.0-rc.2
```

为每次构建指定新输出目录。`resources/app` 按发布清单装入界面、歌词逻辑、连接设置和内置 Bridge。应用自带 Node.js，复用系统 WebView2。源码包记录基线提交和实际打包文件的哈希。

以上命令生成未签名候选包。需要签名发布时，使用 `npm run build:setup:signed`，签名和验签通过后再生成便携附件与 SHA-256 校验文件。[Windows 签名与 GitHub 发布](docs/WINDOWS_SIGNING.md)

## 来源与许可

基于 [XxHuberrr/Mineradio-paused](https://github.com/XxHuberrr/Mineradio-paused) 提交 `d43de565acabfdc1a9c9820a27e81a98ccbebcef` 改造，沿用 GPLv3 与原作者署名。Node.js、WebView2 Loader、Instrument Sans OFL、NSIS 许可及素材来源说明随候选包提供。[LICENSE](LICENSE) · [NOTICE](NOTICE.md) · [第三方说明](docs/THIRD_PARTY_RC.md) · [更新记录](CHANGELOG.md)
