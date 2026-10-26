// Authenticated protocol replay into the real app, NOT a real NetEase run.
const fs = require("node:fs");
const path = require("node:path");
module.exports = async ({ win, config, runDir }) => {
  const results = [];
  let sequence = 0;
  const instance = "renderer-replay-test";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const observe = () =>
    win.webContents.executeJavaScript(
      "({text:document.querySelector('.line').textContent,progress:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lyric-progress'))/100,paused:document.body.classList.contains('paused')})",
    );
  async function sample(positionMs, status = "Playing", extra = {}) {
    const now = Date.now();
    const frame = {
      protocol: 1,
      source: "inflink-api",
      kind: "sample",
      instance,
      sequence: ++sequence,
      generation: 1,
      pluginVersion: "3.4.0",
      sentAtMs: now,
      timelineAtMs: now,
      positionMs,
      durationMs: 10000,
      status,
      track: {
        id: "9990001",
        title: "BRIDGE QA FIXTURE",
        artist: "Fixture",
        album: "Protocol replay",
        trackId: "fixture",
      },
      ...extra,
    };
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(frame),
    });
    if (response.status !== 204) throw Error("HTTP " + response.status);
  }
  async function expect(name, target, paused) {
    let observed;
    const started = performance.now();
    for (let i = 0; i < 25; i++) {
      await wait(15);
      observed = await observe();
      if (
        observed.text === "你好" &&
        Math.abs(observed.progress - target) < 0.025 &&
        observed.paused === paused
      )
        break;
    }
    const item = {
      name,
      pass:
        observed.text === "你好" &&
        Math.abs(observed.progress - target) < 0.025 &&
        observed.paused === paused,
      observed,
      target,
      elapsedMs: performance.now() - started,
      source: "authenticated-protocol-replay-not-real-client",
    };
    results.push(item);
  }
  try {
    await sample(6200, "Playing", { reset: "track" });
    await expect("bridge-word-80", 0.8, false);
    await sample(800, "Playing", { reset: "seek" });
    await expect("bridge-same-line-back-to-20", 0.2, false);
    await sample(6200, "Playing", { reset: "seek" });
    await expect("bridge-same-line-forward-to-80", 0.8, false);
    await sample(800, "Paused", { reset: "state" });
    await expect("bridge-pause-20", 0.2, true);
    await wait(180);
    const paused = await observe();
    results.push({
      name: "bridge-pause-holds-final-highlight",
      pass: Math.abs(paused.progress - 0.2) < 0.005,
      observed: paused,
    });
    await sample(3000, "Playing", { reset: "seek" });
    await expect("bridge-word-gap-50", 0.5, false);
    await wait(500);
    const gap = await observe();
    results.push({
      name: "bridge-gap-continues-to-hold",
      pass: Math.abs(gap.progress - 0.5) < 0.005,
      observed: gap,
    });
    await sample(800, "Playing", { reset: "loop" });
    await expect("bridge-loop-reset", 0.2, false);
    await sample(6200, "Playing", { reset: "reconnect" });
    await expect("bridge-reconnect-reset", 0.8, false);
  } catch (e) {
    results.push({ name: "execution", pass: false, error: e.message });
  }
  fs.writeFileSync(
    path.join(runDir, "bridge-renderer-qa.json"),
    JSON.stringify(results, null, 2),
  );
  return results;
};
