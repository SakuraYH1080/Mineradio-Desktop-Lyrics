# 公开发布范围 · 0.2.1

- 来源：主机最新工程 f58060db015a24e7d4b4a4a9f5e65d87afcaf80e。
- 静态 SHA256 对照：src、vendor、设置文件、字体二进制与实际 app 一致；桥接五个文件与实际 profile 一致。唯一差异是字体说明文档，不影响运行。发布仅调整元数据、通用启动／构建入口和文档，不更换运行逻辑。
- 独立干净目录、全新 Git 根提交，不推送原开发历史；原工程、私人备份、安装原样保留。
- 白名单包含 src、vendor、public、合成 fixtures、既有 tests、必要 PowerShell 工具、专用发布脚本、许可及公开文档。排除旧主机／VM工具及记录、私人日志、Cookie、数据库、运行时认证、host.json、connection.json、launch.json、客户端本体。
- GPLv3及上游署名、Instrument Sans OFL原样保留；Electron运行时保留MIT／Chromium许可。不分发系统字体或BetterNCM／InfLink二进制。
- README复用已有实际窗口图，已检查不含账号、私人路径。截图早于字体下拉框，明确注明，不伪装最终截图。
- 仅做静态核对、语法检查、ZIP构建与公开访问核对；不执行测试套件，不控制播放、采样、录屏或重跑VM。通用启动脚本未做动态客户端复验，最近字体列表呈现待手动确认。
- 版本仍为0.2.1试用版，不宣称1.0稳定或全版本兼容。
