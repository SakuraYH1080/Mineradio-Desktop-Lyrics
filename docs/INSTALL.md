# 安装、依赖与回退

接入**现有原版网易云**，不复制客户端，不要求开发者本机路径。ZIP 未签名，不是自动安装器；受保护目录需要自己以合适权限复制。登录／验证码由用户自己完成。

## 固定组件

| 组件 | 来源与说明 |
| --- | --- |
| BetterNCM 1.3.4 x64 | [chromatic Release](https://github.com/std-microblock/chromatic/releases/tag/1.3.4)，BetterNCMII.dll；基准 e89db61f1254554cf0e9dc5866bfd234c7814f15 |
| InfLink-rs 3.4.0 | [原项目 Release](https://github.com/apoint123/inflink-rs/releases/tag/v3.4.0)，InfLink-rs.plugin；插件名 InfLinkrs；基准 e4ad4946ce24f63b99082fe8be3f30ca92d4428e |
| MineradioBridge 0.4.3 | 本仓库 plugins/MineradioBridge，保留 header-compat.js、pcm-freshness.js、pcm-analyzer.js 及 manifest/index |
| Electron 42.4.1 | package-lock.json 固定，ZIP内包含运行时和许可 |

已记录二进制 SHA256，可用 `Get-FileHash -Algorithm SHA256` 核对：

```text
BetterNCMII.dll x64 1.3.4
a7c77af418d7940e63faa58ea036fba1f4baad497947109ea52ed78c8e86608f
InfLink-rs.plugin 3.4.0
7d0b7b863b072a99b88eb614c788099315e690920889aaca22685d3663661468
```

加载器和 InfLink 二进制不包含在本项目源码／附件，请从原项目取得并遵守其许可。

## 接入原安装

1. 确认原 cloudmusic.exe 的实际位置、版本和架构。已验证仅 **3.1.42.205594 x64**，其他版本先隔离确认，不自动升降级。
2. 从托盘正常退出网易云与歌词。备份要修改的原安装文件，尤其 `msimg32.dll`（原来不存在也应记录），记下哈希；备份现有 BetterNCM 数据／插件。私人账号备份不上传 GitHub。
3. 已有兼容 BetterNCM 则复用。需要安装时按原项目说明，把匹配的 x64 BetterNCMII.dll 作为 `msimg32.dll` 放到**原 exe 同目录**；不改 exe、账号、下载、主题。已有来源不明的加载器先查清用途及备份，不能盲目覆盖。
4. BetterNCM 1.3.4 默认读取系统盘根目录 `betterncm`，通常是 `C:\betterncm`。保留现有正常目录／联接。若要移到其他盘，只在确认默认路径不存在并完成备份后，由管理员自己创建目录联接到数据目录；不要覆盖其他 profile。确认原图标直接启动也加载插件，不依靠临时环境变量。
5. 尚未安装 InfLink 时，将固定 `.plugin` 作为 ZIP 解压到实际 profile 的 `plugins_dev/InfLinkrs`，确保 manifest.json 直接位于该目录。已有同名插件不要装第二份。
6. 将本项目 `plugins/MineradioBridge` 整目录放到同一 `plugins_dev`，**不携带旧 connection.json**。其 loadAfter/requirements 指向 InfLinkrs；API 位于网易云插件环境，不是独立 Electron 的 window。
7. 从原网易云图标启动并确认界面、登录及插件正常。运行 `启动桌面歌词.cmd`，首次输入原 exe 与实际 profile 路径，保存在本项目 `.runtime/launch.json`。也可按 README 显式传参。
8. 开始真实在线播放后，插件向本机桥接发送状态。随机端口与令牌每次启动生成于实际 `plugins_dev/MineradioBridge/connection.json`，正常退出清理，异常退出后下次换新；无需公网端口，不共享该文件。启动缓存不直接建立可信播放时钟。

不购买会员、不绕过歌曲权限。试听后自动切回不算完整播放。

## 入口

可手工给 `启动桌面歌词.cmd` 创建快捷方式。保留原网易云图标直接指向自己的客户端，没有任务栏替换或开机服务。首次路径可带引号；有空格也支持。

默认30FPS、真实PCM，无CDP或高频显示审计。另一位置网易云运行时启动器提示正常退出，不强杀音乐。托盘退出或 `退出桌面歌词.cmd` 仅关闭本目录歌词程序。

## 恢复与卸载

1. 先退出歌词和网易云。
2. 只删除本项目 MineradioBridge，或恢复安装前桥接。其他插件及账号保留；InfLink 按自身方式单独卸载。
3. 若不再需要 BetterNCM 和其他插件，原样恢复备份的 `msimg32.dll`；原来无此文件时，只删除自己新装的该加载器。勿删除网易云目录或清空 AppData。
4. 若本次自己创建了目录联接，核实准确路径和目标后只移除联接本身，不递归删除目标数据；其他插件保留。
5. 删除自己解压的歌词目录及其专属快捷方式即可。`%APPDATA%\MineradioExternalLyrics` 设置可选择保留。原网易云仍由原图标使用。

发布包不包含开发者私人备份或旧客户端副本。每个使用者应对自己的写入范围建立备份。
