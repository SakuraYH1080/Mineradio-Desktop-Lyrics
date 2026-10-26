const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const { startBridge } = require("../src/bridge-server.cjs");
const { adaptFrame } = require("../src/inflink-adapter.cjs");
const { Timeline } = require("../src/timeline.cjs");
const make = (extra = {}) => ({
  protocol: 1,
  source: "inflink-api",
  kind: "sample",
  instance: "plugin-test-001",
  sequence: 1,
  generation: 1,
  sentAtMs: Date.now(),
  timelineAtMs: Date.now(),
  pluginVersion: "3.4.0",
  positionMs: 12000,
  durationMs: 240000,
  status: "Playing",
  track: {
    id: "12345",
    title: "Protocol fixture",
    artist: "Fixture",
    album: "Test",
    trackId: "12345",
  },
  ...extra,
});
test('zero-PTS audio quality keeps native PTS and receipt separate through the adapter',()=>{
  const now=Date.now(),frame=make({sentAtMs:now,audio:{source:'inflink-pcm',trackId:'12345',generation:1,
    observedAtMs:now,callbackReceivedAtMs:now,ptsMs:0,timingQuality:'callback-receipt/no-native-pts',
    sampleFrames:3200,rms:.2,bass:.3,beatPulse:.4,beatGlow:.5}});
  const sample=adaptFrame(frame,{runId:'test',receivedAtMs:now});
  assert.equal(sample.audio.ptsMs,0);assert.equal(sample.audio.callbackReceivedAtMs,now);
  assert.equal(sample.audio.timingQuality,'callback-receipt/no-native-pts');
  frame.audio.ptsMs=-2147483648;
  assert.equal(adaptFrame(frame,{runId:'test',receivedAtMs:now}).audio.ptsMs,-2147483648);
  delete frame.audio.timingQuality;assert.throws(()=>adaptFrame(frame,{runId:'test',receivedAtMs:now}),/audio/);
  frame.audio.ptsMs=0;frame.audio.timingQuality='pretend-native-clock';assert.throws(()=>adaptFrame(frame,{runId:'test',receivedAtMs:now}),/quality/);
  frame.audio.timingQuality='callback-receipt/no-native-pts';frame.audio.ptsMs=now;
  assert.throws(()=>adaptFrame(frame,{runId:'test',receivedAtMs:now}),/audio/);
});
test("reset serial stays monotonic across collector teardown and same-track reconnect", () => {
  const timeline = new Timeline();
  timeline.accept({
    source: "gsmtc",
    sessionId: "cloudmusic.exe",
    connected: true,
    track: { id: "1" },
    positionSec: 1,
    durationSec: 100,
    updatedAtMs: Date.now(),
    sampledAtMs: Date.now(),
    status: "playing",
    timelineUsable: true,
  });
  const old = timeline.snapshot().resetSerial;
  timeline.reset();
  timeline.accept({
    source: "gsmtc",
    sessionId: "cloudmusic.exe",
    connected: true,
    track: { id: "1" },
    positionSec: 0.2,
    durationSec: 100,
    updatedAtMs: Date.now(),
    sampledAtMs: Date.now(),
    status: "playing",
    timelineUsable: true,
  });
  assert.ok(timeline.snapshot().resetSerial > old);
});
test("explicit API source, milliseconds conversion, generation and reset signal", () => {
  const now = Date.now();
  let t = 0;
  const timeline = new Timeline({
    now: () => t,
    wall: () => now + t,
    allowedSource: "inflink-api",
  });
  const s = adaptFrame(make({ sentAtMs: now, timelineAtMs: now }), {
    runId: "server-test",
    receivedAtMs: now,
  });
  assert.equal(s.source, "inflink-api");
  assert.equal(s.positionSec, 12);
  assert.equal(s.durationSec, 240);
  timeline.accept(s);
  const reset = timeline.snapshot().resetSerial;
  t = 100;
  timeline.accept(
    adaptFrame(
      make({
        sequence: 2,
        positionMs: 12200,
        reset: "seek",
        sentAtMs: now + t,
        timelineAtMs: now + t,
      }),
      { runId: "server-test", receivedAtMs: now + t },
    ),
  );
  assert.ok(timeline.snapshot().resetSerial > reset);
  assert.equal(timeline.position(), 12.2);
  assert.deepEqual(
    timeline.accept({ ...s, source: "gsmtc", sessionId: "cloudmusic.exe" }),
    ["rejected-source"],
  );
  t = 110;
  timeline.accept(
    adaptFrame(
      make({
        kind: "track",
        generation: 2,
        sequence: 3,
        sentAtMs: now + t,
        track: { ...make().track, id: "777" },
        positionMs: undefined,
        durationMs: undefined,
        timelineAtMs: undefined,
      }),
      { runId: "server-test", receivedAtMs: now + t },
    ),
  );
  assert.equal(timeline.snapshot().track.id, "777");
  assert.equal(
    timeline.snapshot().usable,
    false,
    "new metadata must clear the previous anchor before any new progress",
  );
  assert.equal(timeline.position(), 0);
});
test("bridge authenticates, checks origin/units/versions/order and expires without heartbeat", async () => {
  let now = Date.now();
  const events = [],
    samples = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mineradio-bridge-"));
  const file = path.join(dir, "session.json");
  const b = await startBridge({
    onSample: (s) => samples.push(s),
    onEvent: (e) => events.push(e),
    configPath: file,
    now: () => now,
    staleMs: 100,
  });
  try {
    const send = (frame, headers = {}) =>
      fetch(b.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${b.config.token}`,
          ...headers,
        },
        body: JSON.stringify(frame),
      });
    assert.equal(
      (await send(make(), { Authorization: "Bearer bad" })).status,
      401,
    );
    assert.equal(
      (await send(make(), { Origin: "https://evil.example" })).status,
      403,
    );
    assert.equal((await send(make({ pluginVersion: "3.3.0" }))).status, 400);
    assert.equal((await send(make({ positionMs: -1 }))).status, 400);
    assert.equal((await send(make({ sentAtMs: now - 10000 }))).status, 400);
    assert.equal((await send(make())).status, 204);
    assert.equal(samples.at(-1).track.id, "12345");
    assert.equal((await send(make())).status, 409);
    assert.equal(
      (await send(make({ sequence: 2, track: { ...make().track, id: "99" } })))
        .status,
      409,
    );
    assert.equal(
      (
        await send(
          make({
            sequence: 2,
            generation: 2,
            track: { ...make().track, id: "99" },
          }),
        )
      ).status,
      204,
    );
    assert.equal(
      (await send(make({ sequence: 1, instance: "second-instance" }))).status,
      409,
    );
    now += 150;
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(samples.at(-1).connected, false);
    assert.ok(events.some((e) => e.type === "bridge-timeout"));
    assert.equal(
      (
        await send(
          make({
            sequence: 3,
            generation: 2,
            track: { ...make().track, id: "99" },
            sentAtMs: now,
            timelineAtMs: now,
            reset: "reconnect",
          }),
        )
      ).status,
      204,
    );
    assert.equal(fs.existsSync(file), true);
  } finally {
    await b.close();
    assert.equal(fs.existsSync(file), false);
    fs.rmdirSync(dir);
  }
});
test("plugin generation guards stale timelines, preserves event time on heartbeats and unloads", async () => {
  let now = 1800000000000,
    interval,
    stopped = false;
  let holdRequests = false;
  let configReady = false;
  const acknowledgements = [];
  const listeners = new Map(),
    frames = [], urls = [];
  let song = {
      ncmId: 123,
      songName: "Fixture A",
      authorName: "Test",
      albumName: "A",
      trackId: "a",
    },
    status = "Playing";
  const api = {
    version: "3.4.0",
    getCurrentSong: () => song,
    getPlaybackStatus: () => status,
    getTimeline: () => ({ currentTime: 1000, totalTime: 20000 }),
    addEventListener: (k, f) => listeners.set(k, f),
    removeEventListener: (k, f) => {
      if (listeners.get(k) === f) listeners.delete(k);
    },
  };
  const config = {
    protocol: 1,
    runId: "test-run",
    endpoint: "http://127.0.0.1:12345/v1/state",
    token: "a".repeat(64),
    audioRequested: true,
    diagnosticsRequested: true,
  };
  const window = {
    MineradioPcmFreshness: require('../plugins/MineradioBridge/pcm-freshness.js'),
    MineradioPcmAnalyzer: require('../plugins/MineradioBridge/pcm-analyzer.js'),
    InfLinkApi: api,
    addEventListener() {},
    removeEventListener() {},
    crypto: { randomUUID: () => "plugin-test-001" },
  };
  const context = vm.createContext({
    window,
    crypto: window.crypto,
    console,
    Date: { now: () => now },
    Math,
    Number,
    JSON,
    AbortController,
    performance,
    setTimeout,
    clearTimeout,
    fetch: async (_url, options) => {
      urls.push(_url);
      frames.push(JSON.parse(options.body));
      if (holdRequests) await new Promise(resolve=>acknowledgements.push(resolve));
      return { ok: true };
    },
    setInterval: (fn) => ((interval = fn), 1),
    clearInterval: () => (stopped = true),
    plugin: { onLoad: (fn) => fn({ pluginPath: "C:/test-plugin" }) },
    betterncm: { fs: { readFileText: async () => {if(!configReady)throw Error('No overlay session');return JSON.stringify(config);} } },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../plugins/MineradioBridge/index.js"),
      "utf8",
    ),
    context,
  );
  const flush = () => new Promise((r) => setImmediate(r));
  interval();
  await flush();
  assert.ok(listeners.has('rawTimelineUpdate'),'raw callbacks bind before the overlay session exists, including minimized connection');
  assert.equal(listeners.has('audioDataUpdate'),false,'no PCM subscription before an authenticated overlay requests it');
  assert.equal(frames.length,0);
  configReady=true;now+=250;interval();await flush();
  assert.equal(frames.at(-1).track.id, "123");
  assert.equal(frames.at(-1).kind,"track","cold cached getter cannot establish a fresh playback clock");
  assert.equal(frames.at(-1).timelineAtMs,undefined);
  const stamp = frames.at(-1).timelineAtMs;
  now += 500;
  interval();
  await flush();
  assert.equal(
    frames.at(-1).timelineAtMs,
    stamp,
    "heartbeat is not a fresh timeline",
  );
  const oldGeneration = frames.at(-1).generation;
  song = { ...song, ncmId: 456, songName: "Fixture B", trackId: "b" };
  listeners.get("songChange")();
  await flush();
  assert.equal(
    frames.at(-1).kind,
    "track",
    "invalidate old lyrics before a new timeline arrives",
  );
  assert.equal(frames.at(-1).track.id, "456");
  assert.equal(frames.at(-1).timelineAtMs, undefined);
  const count = frames.length;
  now += 250;
  interval();
  await flush();
  assert.ok(frames.length > count, "metadata heartbeat keeps an unconfirmed clock visibly connected");
  assert.equal(frames.at(-1).kind, "track");
  assert.equal(frames.at(-1).timelineAtMs, undefined, "heartbeat never promotes a cold cached clock");
  now += 200;
  listeners.get("rawTimelineUpdate")({
    detail: { currentTime: 200, totalTime: 25000 },
  });
  await flush();
  assert.equal(frames.at(-1).track.id, "456");
  assert.ok(frames.at(-1).generation > oldGeneration);
  assert.equal(frames.at(-1).positionMs, 200);
  const eventAt = frames.at(-1).timelineAtMs;
  now += 100;
  const pcm = new Int16Array(6400).fill(8000);
  listeners.get('audioDataUpdate')({detail:{data:pcm.buffer,pts:200}});
  await flush();
  assert.equal(frames.at(-1).audio.source, 'inflink-pcm');
  assert.equal(frames.at(-1).timelineAtMs,eventAt,'PCM delivery cannot re-date the native clock');
  const eventId=frames.at(-1).trace.event;
  now += 100;
  listeners.get('rawTimelineUpdate')({detail:{currentTime:4000,totalTime:25000}});
  await flush();
  assert.equal(frames.at(-1).audio,undefined,'seek drops the old audio envelope before any new PCM arrives');
  assert.ok(frames.at(-1).trace.event>eventId);
  assert.equal(frames.at(-1).trace.eventAtMs,now);
  now += 100;
  status = "Paused";
  listeners.get("playStateChange")();
  await flush();
  const pauseStamp = frames.at(-1).timelineAtMs;
  assert.equal(pauseStamp, now, "pause transition reads current stationary API position once");
  now += 60000;
  interval();
  await flush();
  assert.equal(frames.at(-1).timelineAtMs, pauseStamp, "60s paused heartbeat must retain original anchor timestamp");
  status = "Playing";
  now += 100;
  listeners.get("playStateChange")();
  await flush();
  assert.equal(frames.at(-1).timelineAtMs, pauseStamp, "resume cannot re-date stale progress");
  config.runId = "test-run-2";
  config.endpoint = "http://127.0.0.1:12346/v1/state";
  now += 1200;
  listeners.get("rawTimelineUpdate")({detail:{currentTime:6000,totalTime:25000}});
  await flush();
  now += 200;
  listeners.get("rawTimelineUpdate")({detail:{currentTime:6200,totalTime:25000}});
  await flush();
  assert.equal(urls.at(-1),config.endpoint,"native events refresh a new bridge endpoint even without interval callbacks");
  holdRequests = true;
  const sentBefore = frames.length;
  now += 200;
  listeners.get('rawTimelineUpdate')({detail:{currentTime:9000,totalTime:25000}});
  await flush();
  now += 200;
  listeners.get('rawTimelineUpdate')({detail:{currentTime:2000,totalTime:25000}});
  await flush();
  assert.equal(frames.length,sentBefore+2,'a delayed first HTTP acknowledgement cannot block a newer real seek');
  acknowledgements.shift()();await flush();
  now += 200;
  listeners.get('rawTimelineUpdate')({detail:{currentTime:2200,totalTime:25000}});
  await flush();
  assert.equal(frames.at(-1).reset,'seek','an older acknowledgement must not clear a newer seek reset');
  holdRequests=false;acknowledgements.splice(0).forEach(resolve=>resolve());await flush();
  window.__mineradioBridgeStop();
  await flush();
  assert.equal(listeners.size, 0);
  assert.equal(stopped, true);
  assert.equal(frames.at(-1).kind, "disconnect");
});
