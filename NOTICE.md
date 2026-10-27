This phase-one prototype reuses Mineradio source under GPL-3.0-only.

Upstream: https://github.com/XxHuberrr/Mineradio-paused
Revision: d43de565acabfdc1a9c9820a27e81a98ccbebcef

- vendor/desktop-lyrics.html: original renderer, with a synthetic-beat gate and local-only CSP.
- vendor/overlay-preload.js: unchanged original IPC bridge.
- vendor/lyrics-fetch-parse.js: unchanged original lyrics module; only parser definitions run in an isolated Node VM with explicit text/clone helpers.
- desktop window and global middle-button handling follow desktop/main.js.
- src/palette.cjs: small adaptation of luminance/chroma scoring, bright text HSL and 520ms palette interpolation from public/js/modules/02-visual/07-lyrics-palette-text-utils.js at the same upstream revision. The original palette module SHA256 is 51a4db8492da0b298be967e0e001a7a97635c8781c969e17a1623eca93ec4a3d. No Three.js scene is loaded.

The original license is included in LICENSE. No original player services, login,
home page, Three.js scenes, or audio playback engine are started by this project.

Reference projects inspected, not bundled:
https://github.com/Widdit/now-playing-service at c6cfc33997ca5b63fe64975ca3037acc72ae7366
https://github.com/apoint123/inflink-rs at acbaa505f61395b90c71db186f8cc2e9de0a7934

Electron is distributed under its own license, available in node_modules/electron/LICENSE.

Phase two adds an independently implemented BetterNCM read-only bridge consuming
the documented InfLink-rs 3.4.0 API. Pinned reference revisions:
InfLink-rs e4ad4946ce24f63b99082fe8be3f30ca92d4428e;
BetterNCM 1.3.4 e89db61f1254554cf0e9dc5866bfd234c7814f15.
Downloaded client/plugin binaries remain local test inputs and are not included
in this source archive. Their origins and hashes are in logs/phase2/components.json.
