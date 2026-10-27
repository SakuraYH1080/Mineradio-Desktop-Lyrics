# 暖白设置主题素材

## 人物插画

- `hero-duo.png`：1774×887，透明 RGBA，顶部蓝发／金发双人半身插画。
- `chibi.png`：1310×1201，透明 RGBA，同主题蓝发小角色与简化书桌。
- 来源：本轮使用内置 imagegen 工具生成，并结合用户补充的状态卡参考调整。最终文件已复制到本项目，页面只读取本地资源，无外部热链。未把整张参考卡、其中的文字或系统信息作为背景打包。
- 用户提供的两张参考只用于构图／配色与玻璃材质指导，未将参考图片作者的版权或商标声明转移到本项目。新生成 PNG 按图像生成服务适用条款用于本项目界面；不宣称已取得参考图作者的独立再授权。本轮没有改动项目 GPL 或第三方字体许可。

## 最终生成提示词

工具模式：内置 imagegen；透明背景。未使用 CLI/API 密钥或随机网络图片。

顶部插画先按文档描述生成，再以生成图与用户的第一张参考卡进行一次定向修改：

> Actual transparent horizontal header artwork, not a UI screenshot. Preserve the high-resolution airy 2D anime painting and the large blue-haired / golden-blonde duo in cream-white and red costume details. Use only the top illustration of the reference card for the side-by-side composition, white ruffled bonnets, red bows and soft ruby-red eyes. Make the blonde hair a tied side ponytail. Keep complete hats, faces, forehead and important ribbons within the canvas with transparent breathing room. Natural proportions; no sexualization. No Genius, AstrBot, monitoring statistics, card UI, caption, frame, scenery, watermark, large glows or particles. Genuine transparent alpha.

小角色：

> A single complete chibi of the blue-haired character: short soft sky-blue hair, white ruffled bonnet with a small red bow, ruby-red eyes, cream-white clothing with restrained red details, tiny stylized bat-wing accents. Gentle cheerful expression, seated at a very small simple desk with chin resting on hands. Airy warm grey linework with pale blue, rose and ivory tint; a clear complete silhouette suitable at 100–150px display size. Full cap, body and desk within canvas, genuine transparent alpha. No environment, UI, card frame, logo, caption, letters, numbers, watermark or generic emoji.

## 材质和装饰

- SVG 折射、RGB 合成和贴图算法的小型适配来自 Mineradio 上游 `d43de565acabfdc1a9c9820a27e81a98ccbebcef` 的 `docs/GLASS_SVG_TEXTURE.md`、`public/index.html`、`public/css/index.css` 和 `public/js/modules/05-playback/15-control-glass-animations.js`，沿用项目 GPL-3.0-only。
- 爪印与顶部曲线是设置页内的简单本地 SVG 几何装饰，不依赖人物占位图。
- 界面使用项目已有 Instrument Sans 与系统中文后备，许可仍在 `public/fonts/OFL.txt`；用户选择的桌面歌词字体不受主题影响。
