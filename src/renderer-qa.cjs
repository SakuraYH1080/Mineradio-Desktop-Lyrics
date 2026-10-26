const fs = require("node:fs");
const path = require("node:path");
const { demoSample } = require("./replay.cjs");
module.exports = async ({ win, receive, root, record }) => {
  const results = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function state() {
    return win.webContents.executeJavaScript(
      "({text:document.querySelector('.line').textContent,paused:document.body.classList.contains('paused'),highlight:document.body.classList.contains('highlight')})",
    );
  }
  async function check(name, s, expected) {
    const began = performance.now();
    receive(s);
    let observed;
    let pass = false;
    for (let i = 0; i < 50; i++) {
      await wait(10);
      observed = await state();
      pass = Object.entries(expected).every(([k, v]) => observed[k] === v);
      if (pass) break;
    }
    const item = {
      name,
      pass,
      source: "fixture-to-real-electron-dom",
      elapsedMs: performance.now() - began,
      expected,
      observed,
    };
    results.push(item);
    record({ type: "renderer-qa", ...item });
  }
  try {
    await check("lrc-line-1", demoSample(0), {
      text: "Mineradio · 外部播放器歌词演示",
      highlight: false,
    });
    await check("pause-holds-line", demoSample(6), {
      text: "透明窗口 · 漂浮与柔光",
      paused: true,
    });
    await check("forward-seek", demoSample(14), {
      text: "当前为测试回放，非真实节奏同步",
      paused: false,
    });
    await check("backward-seek", demoSample(1), {
      text: "Mineradio · 外部播放器歌词演示",
    });
    await check("word-track", demoSample(22), {
      text: "逐字时间数据演示",
      highlight: true,
    });
    await check("no-lyrics-clears-old", demoSample(42), {
      text: "纯音乐 · 无歌词（测试曲三）",
      highlight: false,
    });
    await check(
      "disconnect-clears-display",
      { source: "replay", connected: false, sampledAtMs: Date.now() },
      { text: "等待网易云连接", paused: true },
    );
    await check("reconnect-corrects", demoSample(10), {
      text: "中键锁定或解锁 · 解锁后拖动",
      paused: false,
    });
  } catch (e) {
    results.push({ name: "execution", pass: false, error: e.message });
  }
  fs.writeFileSync(
    path.join(root, "logs/renderer-qa.json"),
    JSON.stringify(results, null, 2),
  );
  return results;
};
