# Mineradio 外部桌面歌词

保留 **Mineradio 的透明桌面动态歌词**，继续用**官方网易云 Windows 客户端**选歌和播放。独立 Electron 程序只负责歌词与视觉效果，不播放第二份音乐。

**0.2.2 · 个人试用版**。基于 [XxHuberrr/Mineradio-paused](https://github.com/XxHuberrr/Mineradio-paused) 改造，非原项目官方发行，也非网易云官方产品。提取基准：`d43de565acabfdc1a9c9820a27e81a98ccbebcef`，采用 GPLv3，保留原作者署名。

## 功能

- 透明桌面窗口、锁定穿透、解锁拖动；保留漂浮、缩放、柔光及真实 PCM 节奏动效。
- InfLinkApi 读取当前歌曲 ID、真实时间轴和状态，自动取词；普通 LRC 按行同步，可取得的 YRC 支持逐字高亮。
- 暂停、恢复、跳转、切歌、重连校正；同句跳转重置高亮；长歌词按本句播放位置滚动。
- 封面自动配色／固定颜色；未连接、纯音乐、暂无歌词、获取中字幕可定制，支持 `{歌名}`、`{歌手}`，留空隐藏。
- 开放式设置面板、双栏共享滚动、粉／蓝紫／薄荷静态背景、通透胶囊玻璃控件与原生玻璃下拉菜单。
- “面板外观 → 面板标题”支持即时预览与保存；默认“桌面歌词”，空白回退，最多40字符，按普通文本显示。
- 本机字体切换和列表字形预览；保存后重启保留，含 EFS 保存兼容处理。
- **Ctrl+Alt+H** 立即显隐，**Ctrl+Alt+L** 锁定／解锁；托盘独立退出，音乐继续。重复启动唤回已有窗口。

![最终设置面板](docs/images/settings-0.2.2.png)

[查看字体下拉展开效果](docs/images/settings-fonts-0.2.2.png)。图片复用此前已完成的最终前端记录，来自真实 Electron 设置界面验证窗口，使用现有设置页及 preload，播放通信由验证桩替代；不作为实机播放验证。本轮没有重新截图或采样。主图展示最终胶囊控件，展开图展示同轮材质改造的原生弹层。

## 已知可用环境

| 组件 | 实际使用记录 |
| --- | --- |
| Windows | Windows 11 Pro x64，26H2，build 26300.9711；另有 VMware Windows 客体阶段验证 |
| 网易云官方客户端 | **3.1.42.205594 x64**，接入原安装，无客户端副本 |
| BetterNCM | **1.3.4 x64**，framework 44b4df2 |
| InfLink-rs | **3.4.0**，插件名 InfLinkrs |
| MineradioBridge | **0.4.3** |
| Electron | **42.4.1**，锁定版本 |
| 源码构建 | Node.js **22.22.1**、npm；构建 ZIP 另需 Python 3.10+ |

只说明上述组合曾实际使用，不承诺所有 Windows／客户端版本兼容。更新组件后需重新确认；不要为了本项目自动降级、升级或重装网易云。

## 安装到现有原版网易云

完整组件来源、哈希与恢复步骤见 **[安装说明](docs/INSTALL.md)**。

1. 从 [Releases](https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics/releases) 下载 `win-x64.zip`，完整解压到自己选择的可写目录。路径可以有空格，不要求 D 盘。包内不含网易云客户端、BetterNCM 加载器或 InfLink 二进制。
2. 退出网易云和歌词，备份原安装将修改的加载器及已有插件；按安装说明接入匹配的 BetterNCM 1.3.4 x64、InfLink 3.4.0。已有兼容组件优先复用；不要盲目覆盖来源不明的 `msimg32.dll`。
3. 将本项目 `plugins/MineradioBridge` 放入实际 BetterNCM profile 的 `plugins_dev` 目录；确保 InfLinkrs 已加载。保留其他插件，不复制他人的账号缓存。
4. 双击 **启动桌面歌词.cmd**，首次输入自己的原版 `cloudmusic.exe` 完整路径和实际 BetterNCM 数据目录。以后复用此配置。也可显式指定：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\Start.ps1 `
  -ClientExe 'E:\Apps\CloudMusic\cloudmusic.exe' -Profile 'C:\betterncm'
```

这些仅是示例路径。BetterNCM 1.3.4 默认从系统盘根目录 `betterncm` 读取 profile；输入目录应为原图标启动客户端时实际使用的目录或其联接目标。启动器不注入临时 profile 环境变量，不安装加载器，不改原快捷方式，不添加开机启动。

## 日常使用

- 继续从原**网易云音乐**图标启动，再运行**启动桌面歌词.cmd**；歌词入口也能启动所配置的原客户端。
- **Ctrl+Alt+H** 隐藏／显示，连接仍工作，音乐不中断；托盘也可恢复。
- **Ctrl+Alt+L** 解锁后左键拖动，摆好后再次锁定穿透；中键亦可切换定位状态。
- 歌词托盘右键 → **歌词设置**：字幕、配色、**歌词字体**、**面板标题**。面板标题仅影响顶部设置标题，留空使用“桌面歌词”，不会替代状态字幕。展开字体列表可查看对应字体名称的字形。系统字体按需读取并缓存，不复制文件；卸载字体后自动回退。
- “预览”不等于保存；“恢复默认”后点击保存才写入配置。暂停保留当前歌词。
- 托盘“退出”或 **退出桌面歌词.cmd** 只关闭歌词，音乐继续；再次启动即可连接。

## 源码运行与构建

```powershell
git clone https://github.com/SakuraYH1080/Mineradio-Desktop-Lyrics.git
cd Mineradio-Desktop-Lyrics
npm ci
# 先完成插件安装，再配置路径启动
.\启动桌面歌词.cmd
# 或直接运行，指定实际桥接目录
npm run start:bridge -- --bridge-config='C:\betterncm\plugins_dev\MineradioBridge\connection.json'
# 构建含固定 Electron 的 Windows x64 离线 ZIP
npm run build:win
```

`npm start` 默认使用原生 GSMTC；目标客户端的原生时间轴曾无效，真实同步请使用上述 InfLink 路线。`npm run demo` 是合成回放，不代表真实同步或节奏已完成。既有测试源码保留供维护，本次发布不运行测试套件或播放测试。

ZIP 构建使用 `tools/package-release.py`，沿用离线运行时打包方式、缩小到公开白名单；包含对应源码、Electron、许可和构建清单。下载 ZIP 后无需另装 Node；源码构建需要 npm 下载固定 Electron。

## 配置与卸载

- 歌词设置：`%APPDATA%\MineradioExternalLyrics\lyrics-settings.json`，独立于网易云账号，保留 EFS 兼容保存处理。
- 本项目路径配置：`.runtime/launch.json`，运行数据：`.runtime`，日志：`logs`。可能含本机路径、曲目信息，勿公开上传。
- 每次启动随机生成回环端口与认证令牌，写入桥接 `connection.json`，退出清理。不要共享它；不需开放公网端口。PCM 只在本机分析，不读麦克风、不上传音频。自动歌词与封面访问网易云在线接口。
- 卸载：退出歌词与网易云，只移除本项目桥接；不再需要其他插件时才按安装前备份恢复加载器。保留账号、音乐和其他插件；最后删除自己解压的歌词目录。独立歌词设置可选择保留。详见安装说明。

## 常见问题与限制

- **有歌名不同步**：元数据不代表有效进度。核对真实 exe、InfLink／桥接加载位置及实际播放状态；不要将缓存或浏览器媒体作为网易云时间轴。
- **没有跳动**：需要 `--audio=inflink-pcm` 及新鲜非静音 PCM。PTS 为 0 或已知无效哨兵时使用带质量标记的新鲜度处理，回调接收时间不冒充原生采样时间；无输入时不伪造节拍。
- **无词或无逐字数据**：在线接口、版权和版本可用性有限，普通 LRC 按行同步。可用既有 `--lrc 文件路径` 暂时绑定首次当前曲目，或参考 `lyrics-bindings.example.json`；本地绑定不代表自动获取成功。
- **关闭区布局不同**：桥接有已知 BetterNCM header 冲突修补，保留官方布局；更新后规则可能需要重新适配。
- **快捷键冲突**：注册失败会提示，仍可用托盘操作。
- **字体缺字／列表字体不明显**：字体未必覆盖中文，缺字使用后备字体；玻璃弹层使用已知 Electron 42.4.1 支持的 base-select；其他 WebView 的原生下拉呈现可能不同。安装或卸载字体后重启歌词刷新列表。
- 多屏 DPI、资源占用及其他版本兼容仍有改进空间。SDK 对照的毫秒指标不是实际声音与歌词的声学对齐精度。
- 0.2.2整理已完成并获用户认可的设置面板改造；本轮只做静态文件／许可／版本核对与构建打包，没有运行测试套件、操作网易云、截图采样或开展长时间验证。下载包对应新源码，但不宣称本轮播放测试通过；其他机器与版本仍需自行确认。

## 许可、致谢与更新

感谢 **XxHuberrr 与 Mineradio 原作者／贡献者**的歌词渲染和设计，以及 InfLink-rs、BetterNCM、now-playing-service 的接口与研究参考。本项目不加载原播放器首页、登录或 Three.js 场景。

详见 [NOTICE](NOTICE.md)、[第三方说明](THIRD_PARTY_NOTICES.md)、[原始上游署名](docs/UPSTREAM_NOTICE.md) 和 [GPLv3 LICENSE](LICENSE)。Instrument Sans OFL 原样保留；系统字体、网易云客户端及音频不分发。

后续通过本仓库 Releases 更新，暂不提供自动更新、安装器或默认开机自启。更新前退出歌词并备份自己的设置，只替换本项目代码及说明要求更新的桥接，不覆盖账号或其他插件。
