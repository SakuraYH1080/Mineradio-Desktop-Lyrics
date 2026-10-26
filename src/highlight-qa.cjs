const fs = require("node:fs");
const path = require("node:path");
module.exports = async function ({ win, runDir }) {
  const results = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const apply = (state) =>
    win.webContents.executeJavaScript(
      `window.__mineradioDesktopLyricsApplyState(${JSON.stringify(state)})`,
    );
  const progress = () =>
    win.webContents.executeJavaScript(
      "parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lyric-progress'))/100",
    );
  function check(name, pass, details) {
    results.push({ name, pass, details });
  }
  await win.webContents.executeJavaScript(
    "document.documentElement.style.background='#000';document.querySelector('.line').style.animation='none';document.querySelector('.line').style.opacity='1'",
  );
  const base = {
    enabled: true,
    text: "同一句歌词高亮位置测试",
    lineKey: "one-line",
    trackGeneration: "track-1",
    playing: true,
    progressMode: "word",
    progressSpan: 20,
    cinema: false,
    highlightFollow: true,
    motion: { lyricGlow: false, lyricGlowBeat: false },
    colors: { primary: "#ffffff", highlight: "#ff0000", glow: "#ff0000" },
  };
  const screenshot = async (name) => {
    await wait(40);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(runDir, `highlight-${name}.png`), img.toPNG());
    const pixels = img.toBitmap();
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (
        pixels[i + 2] > 150 &&
        pixels[i + 1] < 110 &&
        pixels[i] < 110 &&
        pixels[i + 3] > 100
      )
        red++;
    }
    return red;
  };
  await apply({ ...base, progress: 0.8, progressResetSerial: 1 });
  await wait(80);
  const before = await progress();
  const red80 = await screenshot("80");
  await apply({ progress: 0.2, progressResetSerial: 2 });
  await wait(70);
  const back = await progress();
  const red20 = await screenshot("20");
  check(
    "same-line-backward-final-css-and-pixels",
    Math.abs(back - 0.2) < 0.005 && red20 < red80 * 0.65,
    { before, back, red80, red20, withinMs: 110 },
  );
  await apply({ progress: 0.75, progressResetSerial: 3 });
  await wait(70);
  const forward = await progress();
  check("same-line-forward-reset", Math.abs(forward - 0.75) < 0.005, {
    forward,
    withinMs: 70,
  });
  // A word gap has a constant authoritative progress; rendering must not invent a slope.
  await apply({
    progress: 0.5,
    progressResetSerial: 4,
    progressMode: "word",
    playing: true,
  });
  await wait(100);
  const gapStart = await progress();
  await wait(650);
  const gapEnd = await progress();
  check(
    "word-gap-no-invented-progress",
    Math.abs(gapEnd - 0.5) < 0.005 && Math.abs(gapEnd - gapStart) < 0.002,
    { gapStart, gapEnd, waitMs: 650 },
  );
  await apply({ progress: 0.28, playing: false, progressResetSerial: 5 });
  await wait(70);
  const pause = await progress();
  await wait(300);
  const pausedLater = await progress();
  check(
    "pause-final-highlight-freezes",
    Math.abs(pause - 0.28) < 0.005 && pause === pausedLater,
    { pause, pausedLater },
  );
  await apply({
    playing: true,
    progress: 0.18,
    progressResetSerial: 6,
    trackGeneration: "track-2",
  });
  await wait(70);
  const track = await progress();
  check("same-text-new-generation", Math.abs(track - 0.18) < 0.005, { track });
  await apply({ progress: 0.6 });
  await wait(40);
  const smooth = await progress();
  check(
    "normal-word-progress-remains-smoothed",
    smooth > 0.18 && smooth < 0.6,
    { smooth },
  );
  fs.writeFileSync(
    path.join(runDir, "highlight-qa.json"),
    JSON.stringify(results, null, 2),
  );
  return results;
};
