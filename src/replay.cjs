const fs = require("node:fs");
const path = require("node:path");
const lrc = fs.readFileSync(
  path.join(__dirname, "../fixtures/demo.lrc"),
  "utf8",
);
const yrc = fs.readFileSync(
  path.join(__dirname, "../fixtures/demo.yrc"),
  "utf8",
);
const tracks = [
  {
    id: "demo-line",
    title: "演示一：普通 LRC",
    artist: "Mineradio",
    album: "本地测试",
  },
  {
    id: "demo-word",
    title: "演示二：逐字数据",
    artist: "Mineradio",
    album: "本地测试",
  },
  {
    id: "demo-none",
    title: "演示三：纯音乐",
    artist: "Mineradio",
    album: "本地测试",
  },
];
function demoSample(elapsed, wall = Date.now()) {
  const index = Math.floor(elapsed / 20) % 3;
  const phase = elapsed % 20;
  // Pause at 5–7 s; a forward seek at 12 s; next track every 20 s.
  const position =
    phase < 5 ? phase : phase < 7 ? 5 : phase < 12 ? phase - 2 : phase - 1;
  return {
    source: "replay",
    connected: true,
    sessionId: "fixture-only",
    track: tracks[index],
    status: phase >= 5 && phase < 7 ? "paused" : "playing",
    positionSec: position,
    durationSec: 20,
    sampledAtMs: wall,
    updatedAtMs: wall,
    timelineUsable: true,
    rate: 1,
  };
}
function demoLyrics(track, parse) {
  if (track.id === "demo-line")
    return {
      ...parse({ lyric: lrc }),
      status: "本地 LRC · 按行同步",
      source: "fixture",
    };
  if (track.id === "demo-word")
    return {
      ...parse({ yrc }),
      status: "本地 YRC · 逐字同步",
      source: "fixture",
    };
  return {
    lines: [],
    status: "纯音乐 · 无歌词（测试曲三）",
    source: "fixture",
  };
}
module.exports = { demoSample, demoLyrics };
