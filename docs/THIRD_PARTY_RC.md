# 1.1.0 的许可与第三方组件

此文件记录 `1.1.0` 的来源与分发范围。完整许可随各组件附带。

## Mineradio 改造关系

上游为 [XxHuberrr/Mineradio-paused](https://github.com/XxHuberrr/Mineradio-paused)，复用基线提交 `d43de565acabfdc1a9c9820a27e81a98ccbebcef`；上游 `package.json` 署名 Mineradio，许可 GPL-3.0-only。原 `LICENSE`、`NOTICE.md` 与相关署名保持不变。

本项目由官方网易云播放，并独立显示桌面歌词。复用和适配了桌面歌词渲染、解析、交互、配色及玻璃材质代码。`MineradioBridge 0.4.3` 源码按本项目 GPL-3.0-only 分发。

## 随应用分发

| 内容 | 许可／来源 | 随包位置 |
| --- | --- | --- |
| 本项目、上游改造代码 | GPL-3.0-only | `LICENSE`、`NOTICE.md`，及 `resources/app` 中代码 |
| Node.js 22.23.5 | Node.js contributors，MIT 及内含组件的各自许可 | `licenses/Node.js.txt` |
| Microsoft WebView2 Loader 1.0.3537.50 | Microsoft，可再分发许可 | `licenses/WebView2Loader.txt` |
| NSIS 3.0.4.1 安装器运行代码／压缩模块 | zlib/libpng、bzip2、CPL 1.0 等，以工具链实际 COPYING 为准 | `licenses/NSIS-COPYING.txt`；同份文本保留在源码 `build/licenses` |
| Instrument Sans 400／500／600 | Instrument Sans Project Authors，SIL OFL 1.1 | `resources/app/public/fonts/OFL.txt` |
| 本项目原创应用／托盘图标 | 本项目 GPL-3.0-only | 启动程序图标、`resources/app/public/icons/tray.ico` |
| 设置面板人物 WebP | imagegen 生成，原素材的无损转码 | `resources/app/public/assets/settings/SOURCES.md` |
| PowerShell 系统媒体辅助 | 本项目代码，调用 Windows 系统 API | `resources/app/tools/probe.ps1` |

Instrument Sans 是应用界面自带字体，与用户自行选择的系统字体分开。Windows 本机安装的其他字体文件没有复制到工程、Setup 或附件。

人物插画的素材来源与使用范围见随包 `SOURCES.md`。

## 外部插件依赖，不随 Setup 捆绑二进制

| 组件 | 固定参考与许可 | 本轮处理 |
| --- | --- | --- |
| 网易云音乐 Windows 客户端 | 官方客户端，本项目不授予其分发权 | 不打包客户端本体、账号、Cookie、登录库、歌曲或副本 |
| BetterNCM 1.3.4 | [上游发布](https://github.com/std-microblock/chromatic/releases/tag/1.3.4)，提交 `e89db61f1254554cf0e9dc5866bfd234c7814f15`；本地对应 LICENSE 为 GPLv3 | 安装时复用已匹配的加载器，或经确认从上游下载并校验 |
| InfLink-rs 3.4.0 | apoint123；[发布](https://github.com/apoint123/inflink-rs/releases/tag/v3.4.0)，提交 `e4ad4946ce24f63b99082fe8be3f30ca92d4428e`；GPL-3.0-only | 安装时复用匹配的插件，或经确认下载并校验上游 `.plugin` |
| MineradioBridge 0.4.3 | 本项目自有 GPL-3.0-only 源码 | 程序内置 5 个源文件，由安装向导或托盘设置部署，另外提供带 GPL／NOTICE 的恢复 ZIP |

先前只读参考过 Widdit/now-playing-service 等项目；没有因此把其整套服务或二进制加入本候选运行时。

## 构建工具

Visual C++ 构建 Win32 启动程序，electron-builder 生成 NSIS 安装包。应用在用户电脑上调用共享的 WebView2 Evergreen Runtime。Node.js 二进制与 WebView2 SDK 的构建版本和 SHA-256 记录在 `build/runtime.json`。

NSIS 工具链来源为 [electron-builder-binaries 的 nsis-3.0.4.1](https://github.com/electron-userland/electron-builder-binaries/releases/tag/nsis-3.0.4.1)，保留它随附的完整版权与许可文本，不将 NSIS 安装器本身误称为本项目原创。

## 公开附件边界

安装包、便携目录压缩包、Bridge ZIP 与源码附件均不得包含：个人 `desktop-launch.json`、账号配置、Cookie、令牌／密钥、`connection.json`、EFS 备份、私有运行日志、测试录像、测试状态、VMware ISO 或客户端副本。会话认证信息只在用户本机启动时生成。

许可文件、作者署名及本地素材说明应随未来重新打包保留。Setup 的生成与静态清单核对不构成安装、卸载、播放或所有客户端版本兼容性验收。
