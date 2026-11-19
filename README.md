<img src="public/icons/app.svg" width="80" height="80" alt="Mineradio 桌面歌词">

# Mineradio 桌面歌词

继续用官方网易云 Windows 客户端选歌和播放，独立显示 Mineradio 风格的动态桌面歌词。

**[下载 1.1.0 Windows x64 完整安装包](https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics/releases/download/v1.1.0/Mineradio-Desktop-Lyrics-1.1.0-x64-Setup.exe)** · [网络安装器](https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics/releases/download/v1.1.0/Mineradio-Desktop-Lyrics-1.1.0-x64-WebSetup.exe) · [便携包](https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics/releases/download/v1.1.0/Mineradio-Desktop-Lyrics-1.1.0-x64-Portable.zip) · [发布说明与校验文件](https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics/releases/tag/v1.1.0)

程序使用 Windows 的共享 Microsoft Edge WebView2 Evergreen Runtime。缺少运行时的设备可从微软下载安装。[WebView2 下载](https://developer.microsoft.com/microsoft-edge/webview2/#download)

安装版与便携版二选一即可。普通用户无需安装 Node、npm 或开发环境；源码 ZIP 用于开发和复现构建。

## 安装与首次使用

1. 运行 `WebSetup.exe` 或完整 `Setup.exe`，分别选择桌面歌词和 BetterNCM 插件的文件夹。核对向导找到的原版网易云。安装插件或切换插件目录前，先从网易云托盘退出。
2. 点击 **配置并下载安装** 或 **配置并继续**。向导复用已有的匹配组件，或从上游下载并校验缺少的 BetterNCM 和 InfLink-rs。网络安装包在插件准备完成后下载歌词程序。两种安装器都在安装完成时写入内置 Bridge 和连接路径。
3. 打开网易云并播放，再从桌面或开始菜单打开 **Mineradio 桌面歌词**。组件缺失时，歌词窗口进入等待状态。需要手动配置时，从歌词托盘打开 **网易云连接设置**。

安装向导支持原版网易云 **3.1.42.205594 和 3.1.43.205627 x64**，匹配 BetterNCM 1.3.4 x64、InfLink-rs 3.4.0 和内置 MineradioBridge 0.4.3。播放时收到实际数据后，歌词才会显示连接成功。[安装与连接说明](docs/INSTALL_1.0_RC.md)

网络安装器从 GitHub Release 下载对应版本的完整包并校验。同一文件夹中已有匹配的完整包时可以直接使用。

1.1.0 的安装包未签名，Windows 可能显示 SmartScreen 提示。发布页提供 `SHA256SUMS.txt` 校验文件。[Windows 签名与 GitHub 发布](docs/WINDOWS_SIGNING.md)

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
- **升级**。从托盘退出旧版歌词程序，再运行新版安装器。要安装 BetterNCM 或切换插件目录时，先退出网易云。

## 源码与构建

构建需要 Windows x64、带 C++ 桌面开发组件和 Windows SDK 的 Visual Studio 2022 或更新版、Node.js ≥22.12 及 Python ≥3.10。构建脚本按 `build/runtime.json` 下载和校验 Node.js x64 可执行文件与 WebView2 SDK。Electron 开发入口仍可用，NSIS 使用已经构建的 Win32 应用目录。

```powershell
npm ci
python tools/build-desktop.py --output .runtime/release-1.1.0
npm run build:setup -- --prepackaged .runtime/release-1.1.0 --output artifacts/1.1.0
python tools/package-candidate.py --directory .runtime/release-1.1.0 --release artifacts/1.1.0
```

为每次构建指定新输出目录。`resources/app` 按发布清单装入界面、歌词逻辑、连接设置和内置 Bridge。应用自带 Node.js，复用系统 WebView2。安装向导使用 Windows 自带的 .NET Framework。源码包记录基线提交和实际打包文件的哈希。

以上命令生成未签名安装包。签名构建使用 `npm run build:setup:signed`。[Windows 签名与 GitHub 发布](docs/WINDOWS_SIGNING.md)

## 来源与许可

基于 [XxHuberrr/Mineradio-paused](https://github.com/XxHuberrr/Mineradio-paused) 提交 `d43de565acabfdc1a9c9820a27e81a98ccbebcef` 改造，沿用 GPLv3 与原作者署名。Node.js、WebView2 Loader、Instrument Sans OFL、NSIS 许可及素材来源说明随程序提供。[LICENSE](LICENSE) · [NOTICE](NOTICE.md) · [第三方说明](docs/THIRD_PARTY_RC.md) · [更新记录](CHANGELOG.md)
