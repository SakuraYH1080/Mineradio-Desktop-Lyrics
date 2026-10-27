# Mineradio 桌面歌词图标

原创图形，与本项目一同按 GPL-3.0-only 授权。未使用网易云或其他应用的 Logo、系统字体或下载的素材。

- `app.svg`：主图可编辑源文件；`app.png`：1024×1024 RGBA 主图。
- `app-{尺寸}.png` 与 `app.ico`：16、20、24、32、40、48、64、128、256 像素；ICO 含九个真实 32 位图像条目。
- `tray.svg`：小尺寸简化源图；`tray.png`：64×64；`tray-{尺寸}.png` 和 `tray.ico` 含 16、20、24、32、40、48、64 像素。
- `icon-preview.png`：图标资源在深浅底色上的预览，小图按原像素大小排列；不是系统截图。

编辑 SVG 后运行 `python tools/generate-icons.py` 重新生成。生成脚本只接受当前 SVG 使用的圆角矩形及分组，不支持的绘图特性会明确报错；运行歌词程序无需该工具或 Pillow。Windows EXE、窗口、托盘及后续安装器图标路径统一配置在 `build/windows-app.json`。
