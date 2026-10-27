# 1.0.0 的许可与第三方组件

本说明对应 `1.0.0` 正式交付。它记录实际来源与分发范围，不替代各组件随附的完整许可文本。

## Mineradio 改造关系

上游为 [XxHuberrr/Mineradio-paused](https://github.com/XxHuberrr/Mineradio-paused)，复用基线提交 `d43de565acabfdc1a9c9820a27e81a98ccbebcef`；上游 `package.json` 署名 Mineradio，许可 GPL-3.0-only。原 `LICENSE`、`NOTICE.md` 与相关署名保持不变。

本项目改造为官方网易云播放、独立 Electron 桌面歌词的应用，复用和适配了桌面歌词渲染、解析、交互与最小配色／玻璃逻辑，不加载上游首页、完整场景或音频播放引擎。本项目自有桥接 `MineradioBridge 0.4.3` 源码按本项目 GPL-3.0-only 分发。提供与候选二进制对应的干净源码附件及提交记录，未把个人工程历史、私有日志或账号备份作为源码包。

## 随应用分发

| 内容 | 许可／来源 | 随包位置 |
| --- | --- | --- |
| 本项目、上游改造代码 | GPL-3.0-only | `LICENSE`、`NOTICE.md`，及 `resources/app` 中代码 |
| Electron 42.4.1 | Electron contributors，MIT | `LICENSE.electron.txt` |
| Chromium 及 Electron 内含第三方组件 | 各自许可，完整集合随 Electron 运行时提供 | `LICENSES.chromium.html` |
| NSIS 3.0.4.1 安装器运行代码／压缩模块 | zlib/libpng、bzip2、CPL 1.0 等，以工具链实际 COPYING 为准 | `licenses/NSIS-COPYING.txt`；同份文本保留在源码 `build/licenses` |
| Instrument Sans 400／500／600 | Instrument Sans Project Authors，SIL OFL 1.1 | `resources/app/public/fonts/OFL.txt` |
| 本项目原创应用／托盘 SVG、PNG、ICO | 本项目 GPL-3.0-only，未使用其他应用 Logo | `resources/app/public/icons/README.md` |
| 设置面板人物 PNG | 本轮内置 imagegen 生成，参考构图与服务适用条款说明 | `resources/app/public/assets/settings/SOURCES.md` |
| PowerShell 鼠标／系统媒体辅助 | 本项目代码；调用 Windows 系统 API | 作为真实 `.ps1` 文件随程序资源分发 |

Instrument Sans 是应用界面自带字体，与用户自行选择的系统字体分开。Windows 本机安装的其他字体文件没有复制到工程、Setup 或附件。

参考图本身、其中作者的授权或商标权没有被本项目转授；素材说明没有宣称取得参考图作者的独立再授权。候选包只保留已生成的本地人物 PNG 及来源说明，不捆绑整张参考截图。

## 外部插件依赖，不随 Setup 捆绑二进制

| 组件 | 固定参考与许可 | 本轮处理 |
| --- | --- | --- |
| 网易云音乐 Windows 客户端 | 官方客户端，本项目不授予其分发权 | 不打包客户端本体、账号、Cookie、登录库、歌曲或副本 |
| BetterNCM 1.3.4 | [上游发布](https://github.com/std-microblock/chromatic/releases/tag/1.3.4)，提交 `e89db61f1254554cf0e9dc5866bfd234c7814f15`；本地对应 LICENSE 为 GPLv3 | 用户按实际已有加载器与备份手动配置，不在安装时覆盖未知 DLL |
| InfLink-rs 3.4.0 | apoint123；[发布](https://github.com/apoint123/inflink-rs/releases/tag/v3.4.0)，提交 `e4ad4946ce24f63b99082fe8be3f30ca92d4428e`；GPL-3.0-only | 不捆绑插件 DLL；复用已有兼容版本或用户按上游自行安装 |
| MineradioBridge 0.4.3 | 本项目自有 GPL-3.0-only 源码 | 程序资源中提供 5 个桥接源文件，首次连接经确认部署，另给带 GPL／NOTICE 的单独部署／恢复 ZIP，不含认证会话 |

先前只读参考过 Widdit/now-playing-service 等项目；没有因此把其整套服务或二进制加入本候选运行时。

## 构建工具

目录构建继续使用本地固定 Electron，NSIS 安装器由本轮固定版本的 electron-builder 工具链生成；具体构建版本、源码提交、文件列表和 SHA-256 以本次构建记录与校验附件为准。构建机 Node、Python、Pillow 和 npm 工具环境不是普通用户需要安装的运行依赖，也不把开发机工具缓存打进安装包。

NSIS 工具链来源为 [electron-builder-binaries 的 nsis-3.0.4.1](https://github.com/electron-userland/electron-builder-binaries/releases/tag/nsis-3.0.4.1)，保留它随附的完整版权与许可文本，不将 NSIS 安装器本身误称为本项目原创。

## 公开附件边界

安装包、便携目录压缩包、Bridge ZIP 与源码附件均不得包含：个人 `desktop-launch.json`、账号配置、Cookie、令牌／密钥、`connection.json`、EFS 备份、私有运行日志、测试录像、测试状态、VMware ISO 或客户端副本。会话认证信息只在用户本机启动时生成。

许可文件、作者署名及本地素材说明应随未来重新打包保留。Setup 的生成与静态清单核对不构成安装、卸载、播放或所有客户端版本兼容性验收。
