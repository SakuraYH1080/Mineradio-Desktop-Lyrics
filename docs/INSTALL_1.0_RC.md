# Mineradio 桌面歌词安装与使用

## 安装包做什么

网易云官方 Windows 客户端负责选歌和播放。Mineradio 提供独立桌面歌词、同步、长句滚动、真实 PCM 动效及设置功能。

1.1.0 使用系统共享的 Microsoft Edge WebView2 Evergreen Runtime。缺少时，启动程序会提供微软官方下载入口。歌词后端随包提供，可直接从 GUI EXE 启动。[WebView2 下载](https://developer.microsoft.com/microsoft-edge/webview2/#download)

安装向导可为受支持的原版网易云配置 BetterNCM、InfLink-rs 和内置 MineradioBridge。第三方组件按需从上游发布页取得，使用固定版本与 SHA-256 校验。

## 1. 安装

1. 核对附件中的 `SHA256SUMS.txt`，确认下载文件与交付校验值一致。
2. 运行 x64 的 `WebSetup.exe` 或完整的 `Setup.exe`，选择歌词安装目录。若要升级，请先从托盘退出旧版歌词程序。
3. 核对检测到的原版 `cloudmusic.exe`。在 **BetterNCM 插件目录** 中选择文件夹，例如 `D:\BetterNCM`。安装插件或切换目录前，先从网易云托盘退出，然后点 **配置并下载安装** 或 **配置并继续**。向导会把选择写入当前 Windows 用户的 `BETTERNCM_PROFILE`，网易云重开后从所选目录加载插件。[BetterNCM 的插件目录说明](https://github.com/std-microblock/chromatic/wiki/%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E#修改插件数据位置)
4. 向导复用匹配的组件；缺失时从上游下载 BetterNCM 1.3.4 和 InfLink-rs 3.4.0。网络安装器随后从对应 GitHub 发布附件下载并校验完整包。同目录存在一致的完整安装包时，网络安装器会直接使用它。
5. 安装器部署内置 Bridge 并保存连接。若网易云已打开，请从托盘退出后重开。播放歌曲后，从桌面或开始菜单打开 **Mineradio 桌面歌词**。

如果当前无法配置插件，可在安装向导选 **仅安装歌词** 或 **稍后配置**。歌词会等待连接，可以从托盘补配或重新运行安装向导。若 Windows 限制写入网易云或 BetterNCM 的安装目录，可按对应上游安装流程准备组件后再继续。

未签名的安装包可能触发 Windows SmartScreen 提示。[微软 SmartScreen 说明](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)

## 2. 手动检查与恢复连接

从歌词托盘打开 **网易云连接设置**，可以查看客户端实际路径、文件版本与架构，以及 BetterNCM 加载器、InfLink-rs 和 MineradioBridge 的文件状态。该窗口从托盘手动打开，日常启动歌词时直接显示播放或等待状态。

- **选择网易云**：选择自己正在使用的官方 `cloudmusic.exe`。路径可包含中文或空格，不需要迁移客户端。
- **选择插件目录**：选择 BetterNCM 实际 profile 根目录，根目录下应有 `plugins_dev`；不要误选网易云账号数据目录或单个插件文件夹。
- **查看连接说明**：打开随程序分发的本地说明。
- **配置／更新内置 Bridge**：受支持的第三方依赖就绪后，明确确认目标，只部署随 EXE 内置的本项目五个文件；已有文件匹配时不重复复制。
- **第三方依赖下载**：打开 BetterNCM 1.3.4 或 InfLink-rs 3.4.0 的上游发布页。
- **保存并继续／仅启动歌词等待**：保存本机连接路径并打开桌面歌词。

连接路径保存在 `%APPDATA%\MineradioExternalLyrics\desktop-connection.json`。网易云加载对应插件并发出有效播放数据后，歌词才会显示连接成功。

### 已有兼容插件的用户

优先复用原 profile。确认 `plugins_dev\InfLinkrs\manifest.json` 为 3.4.0，`plugins_dev\MineradioBridge\manifest.json` 为 0.4.3，并保留其他插件。主机旧试用中如果使用 `C:\betterncm` 联接，它指向的原 profile 仍可继续使用；不要为安装歌词程序重建或清空它。

### 尚未配置插件的用户

优先使用安装向导。若向导检测到其他加载器，或有多个 InfLink-rs，请按上游说明整理已有插件后重试。便携版用户可以按上游说明安装这两项，随后从歌词托盘打开连接设置并点 **配置／更新内置 Bridge**。[BetterNCM 1.3.4](https://github.com/std-microblock/chromatic/releases/tag/1.3.4) · [InfLink-rs 3.4.0](https://github.com/apoint123/inflink-rs/releases/tag/v3.4.0)

内置 Bridge 默认写入 `<实际 profile>\plugins_dev\MineradioBridge`，已有本项目目录时复用其位置。更新时在 `%APPDATA%\MineradioExternalLyrics\bridge-backups` 备份旧的桥接源文件。独立 Bridge ZIP 用于单独部署或恢复。

## 3. 日常操作

- `Ctrl+Alt+H`：显示／隐藏歌词。隐藏满 5 秒释放歌词窗口。再次打开程序会唤回已有实例并同步当前歌词。
- `Ctrl+Alt+L`：解锁拖动／锁定穿透。托盘菜单显示当前可执行动作。
- 托盘 → **歌词设置**：状态字幕、封面／固定配色、通用与分文字系统字体、字幕预览、面板标题、保存和恢复默认。
- 托盘 → **网易云连接设置**：仅重启歌词以重新打开连接向导，音乐继续。
- 从歌词托盘退出只退出歌词，网易云继续播放。不要同时保留旧试用程序与新安装程序的两个不同入口运行；安装后的入口名称与网易云图标不同。

字体来自本机安装列表，程序只附带界面使用的 Instrument Sans。代表字符覆盖提示不保证所有歌词字形都存在；纯汉字语言不确定时可用“汉字语言判断”纠正。没有自动下载字体。

## 4. 升级与设置迁移

新版沿用 `%APPDATA%\MineradioExternalLyrics\lyrics-settings.json`，保留字幕、配色、面板标题、原单字体和分语言覆盖；原单字体仍作为通用默认。保存继续使用已有 EFS 兼容逻辑，不为了升级重建设置文件。

连接路径在独立 `desktop-connection.json`；窗口位置／锁定状态在独立 `window-state.json`。新候选会保存后续位置。早期试用未持久化窗口坐标时，只能尽力从本程序自己的旧日志恢复最后记录的窗口边界；找不到可靠记录或显示器布局已变化时回到可见的默认位置，不声称可以精确恢复不存在的记录。

升级前先退出旧歌词，音乐可以继续。已有同一安装器登记的版本沿原安装位置升级；历史 `D:\MineradioDesktopLyrics` 手工试用不作为可自动删除的旧安装。其配置、profile 和私人备份原地保留，用户确认新入口可用后再自行处理旧快捷方式。

连接检查提供程序旁旧 `desktop-launch.json` 的兼容路径发现；不把开发机的这个文件复制到发布包。不要复制 VMware 的网易云 Cookie、账号数据库或调试数据来迁移。

## 5. 卸载与回退

在 Windows“已安装的应用”中卸载 Mineradio 桌面歌词。卸载器仅处理本程序登记的安装文件及它建立的入口；保留 `%APPDATA%\MineradioExternalLyrics` 中的用户设置、连接配置、位置记录与日志。不会清空网易云、歌曲、插件 profile、下载目录或私人备份。

卸载歌词程序后，BetterNCM、InfLink-rs 和 Bridge 仍可由插件管理流程处理。恢复 Bridge 时，用 `bridge-backups` 中对应时间目录内的 `deployment.json` 核对目标，再还原其中列明的本项目文件。撤销第三方加载器请参照其上游说明。

回退歌词版本时先退出歌词，保留用户数据，安装已有旧版本或打开此前保留的手工试用入口。不要用旧源码包覆盖当前用户配置；也不要把历史客户端副本重新建回来。

## 已知兼容范围与待验收项

| 组件 | 既有记录 |
| --- | --- |
| Windows | Windows 11 x64；本机记录为 Pro 26H2、26300.9711，不代表所有 Windows 版本通过 |
| 网易云官方 Windows 客户端 | 3.1.42.205594、3.1.43.205627 x64 |
| BetterNCM | 1.3.4 x64 |
| InfLink-rs | 3.4.0 |
| MineradioBridge | 0.4.3，保留 header-compat 与 PCM 新鲜度修补 |
| 界面运行时 | Microsoft Edge WebView2 Evergreen Runtime |

现有在线歌词接口和音源权限会影响歌词与 PCM 可用性。SDK 某些音源不提供可靠原生 PCM PTS，桥接沿用带质量标记的新鲜度处理，不能将回调接收时间当作精确声学采样时间。
