const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Timeline } = require("../src/timeline.cjs");
const { Lyrics, parse, locate, selectCandidate } = require("../src/lyrics.cjs");
const { demoSample, demoLyrics } = require("../src/replay.cjs");
const { motion } = require("../src/rhythm.cjs");
function harness() {
  let t = 0;
  const wall = 1_800_000_000_000;
  const clock = new Timeline({ now: () => t, wall: () => wall + t });
  return {
    clock,
    advance: (n) => (t += n),
    sample: (position = 10, extra = {}) => ({
      source: "gsmtc",
      sessionId: "cloudmusic.exe",
      connected: true,
      track: { title: "A", artist: "B", album: "C", id: "1" },
      status: "playing",
      positionSec: position,
      durationSec: 100,
      updatedAtMs: wall + t,
      sampledAtMs: wall + t,
      timelineUsable: true,
      rate: 1,
      ...extra,
    }),
  };
}
test("browser cannot seize the timeline; ambiguous disconnected does not advance", () => {
  const h = harness();
  h.clock.accept(h.sample());
  h.advance(500);
  assert.deepEqual(h.clock.accept(h.sample(80, { sessionId: "chrome.exe" })), [
    "rejected-session",
  ]);
  assert.equal(h.clock.position(), 10.5);
  h.clock.accept({ source: "gsmtc", connected: false });
  h.advance(10000);
  assert.equal(h.clock.snapshot().playing, false);
});
test('batched equal-timestamp seeks correct immediately; reset cannot renew an obsolete clock',()=>{
 const h=harness(),first=h.sample(80,{status:'paused'}),stamp=first.updatedAtMs;
 h.clock.accept(first);h.advance(100);
 h.clock.accept(h.sample(20,{status:'paused',updatedAtMs:stamp,reset:'seek'}));
 assert.equal(h.clock.position(),20,'same-millisecond backwards correction is not discarded');
 h.advance(100);h.clock.accept(h.sample(70,{status:'paused',updatedAtMs:stamp}));
 assert.equal(h.clock.position(),70,'changed provider position at a tied timestamp is a real correction');
 h.advance(3000);h.clock.accept(h.sample(5,{status:'playing',updatedAtMs:stamp,reset:'seek'}));
 assert.equal(h.clock.position(),70,'an explicit reset cannot promote an expired position');
 assert.equal(h.clock.snapshot().usable,false);
});
test("timestamp smoothing, pause/resume, seeks, loop, reconnect", () => {
  const h = harness();
  h.clock.accept(h.sample());
  h.advance(500);
  assert.equal(h.clock.position(), 10.5);
  h.clock.accept(h.sample(10.5, { status: "paused" }));
  h.advance(600);
  assert.equal(h.clock.position(), 10.5);
  h.clock.accept(h.sample(10.5));
  h.advance(300);
  assert.equal(h.clock.position(), 10.8);
  assert.ok(h.clock.accept(h.sample(70)).includes("seek-forward"));
  h.advance(1);
  assert.ok(h.clock.accept(h.sample(3)).includes("seek-back-or-loop"));
  h.advance(1);
  h.clock.accept(h.sample(99));
  h.advance(300);
  assert.ok(h.clock.accept(h.sample(0)).includes("seek-back-or-loop"));
  h.clock.accept({ source: "gsmtc", connected: false });
  assert.equal(h.clock.snapshot().usable, false);
  h.advance(1);
  assert.ok(h.clock.accept(h.sample(40)).includes("connected"));
  assert.equal(h.clock.position(), 40);
});
test("stale timestamp heartbeats never renew interpolation; invalid data and future timestamps rejected", () => {
  const h = harness();
  const initial = h.sample();
  h.clock.accept(initial);
  for (let i = 0; i < 10; i++) {
    h.advance(500);
    h.clock.accept({ ...initial, sampledAtMs: initial.sampledAtMs + i * 500 });
  }
  assert.equal(h.clock.snapshot().usable, false);
  assert.equal(h.clock.position(), 12.5);
  h.clock.accept(h.sample(40, { updatedAtMs: 0 }));
  assert.equal(h.clock.snapshot().usable, false);
  h.clock.accept(h.sample(50, { updatedAtMs: 1_900_000_000_000 }));
  assert.equal(h.clock.snapshot().usable, false);
});
test("out-of-order old track cannot replace the latest", () => {
  const h = harness();
  const old = h.sample();
  h.advance(200);
  h.clock.accept(h.sample(0, { track: { title: "New" } }));
  assert.deepEqual(h.clock.accept(old), ["rejected-out-of-order"]);
  assert.equal(h.clock.snapshot().track.title, "New");
});
test("confirmed pause survives 60s heartbeats without refreshing timeline; disconnect requires a fresh anchor", () => {
  const h=harness();
  const paused=h.sample(13.5,{status:"paused"});
  h.clock.accept(paused);
  for(let i=0;i<120;i++){
    h.advance(500);
    h.clock.accept({...paused,sampledAtMs:paused.sampledAtMs+(i+1)*500});
    assert.equal(h.clock.snapshot().usable,true);
    assert.equal(h.clock.position(),13.5);
    assert.equal(h.clock.anchor.updatedAtMs,paused.updatedAtMs);
  }
  h.clock.accept({...paused,status:"playing",sampledAtMs:paused.sampledAtMs+60000});
  assert.equal(h.clock.snapshot().usable,false);
  assert.equal(h.clock.position(),13.5);
  h.clock.accept(h.sample(14));
  assert.equal(h.clock.snapshot().playing,true);
  h.clock.accept({source:"gsmtc",connected:false});
  h.clock.accept({...paused,sampledAtMs:paused.sampledAtMs+60001});
  assert.equal(h.clock.snapshot().usable,false);
  h.clock.accept(h.sample(28,{status:"paused",sampledAtMs:paused.sampledAtMs+60002}));
  assert.equal(h.clock.position(),28);
  assert.equal(h.clock.snapshot().usable,true);
});
test("LRC from original parser: repeated tags, milliseconds, intro and line-only display", () => {
  const p = parse({ lyric: "[00:01.25][00:05.000]第一行\n[00:09.50]第二行" });
  assert.equal(p.lines.length, 3);
  assert.equal(p.lines[0].t, 1.25);
  assert.equal(locate(p, 0).highlightFollow, false);
  assert.equal(locate(p, 6).text, "第一行");
  assert.equal(locate(p, 6).progress, 0);
  assert.equal(locate(p, 10).text, "第二行");
});
test("YRC from original parser retains real words; instrumental clears previous text", () => {
  const p = parse({ yrc: "[1000,3000](1000,1000,0)你(2000,2000,0)好" });
  assert.equal(p.hasNativeKaraoke, true);
  assert.equal(locate(p, 2).progress, 0.5);
  assert.equal(locate(p, 2).highlightFollow, true);
  const none = parse({ lyric: "[00:00.00]纯音乐，请欣赏" });
  assert.equal(none.usableLyric, false);
  assert.equal(locate(none, 10).highlightFollow, false);
});
test("async lyrics are bound to current track, including no lyrics and request failure", async () => {
  let finish;
  const l = new Lyrics((track) =>
    track.id === "old"
      ? new Promise((r) => (finish = r))
      : Promise.resolve({ lines: [], status: "纯音乐" }),
  );
  const old = l.change({ id: "old" }, 30);
  await l.change({ id: "new" }, 30);
  finish({ lines: [{ text: "OLD" }] });
  await old;
  assert.equal(l.value.status, "纯音乐");
  assert.equal(l.value.lines.length, 0);
  l.loader = async () => {
    throw Error("offline");
  };
  await l.change({ id: "offline" }, 30);
  assert.equal(l.value.lines.length, 0);
  assert.match(l.value.error, /offline/);
});
test("instrumental response with timed empty credits clears lyric text; later sung text is retained", () => {
  const actualShape = parse({lrc:{lyric:"[00:00.00] 作词 : 无\n[00:01.00] 作曲 : 无\n[00:05.00]纯音乐，请欣赏\n"}});
  assert.equal(actualShape.usableLyric,false);
  assert.deepEqual(actualShape.lines,[]);
  assert.equal(locate({...actualShape,status:"无歌词 / 纯音乐"},10).text,"无歌词 / 纯音乐");
  assert.equal(parse({lyric:"[00:10.00]作词：向前走"}).usableLyric,true);
  assert.equal(parse({nolyric:true,lyric:"[00:00.00]outdated response text"}).usableLyric,false);
});
test("metadata matching rejects live/studio and missing album or duration", () => {
  const candidate = {
    id: 1,
    title: "Song",
    artist: "Singer",
    album: "Studio",
    duration: 200,
  };
  assert.equal(
    selectCandidate({ title: "Song", artist: "Singer", album: "Live" }, 200, [
      candidate,
    ]).track,
    null,
  );
  assert.equal(
    selectCandidate({ title: "Song", artist: "Singer" }, 200, [candidate])
      .certainty,
    "uncertain",
  );
  assert.equal(selectCandidate(candidate, 220, [candidate]).track, null);
  assert.equal(selectCandidate(candidate, 200, [candidate]).track.id, 1);
  assert.equal(
    selectCandidate(candidate, 200, [candidate, candidate]).track,
    null,
  );
});
test("ten minute deterministic replay: three tracks, pause/seek/loop and no accumulated clock drift", () => {
  let t = 0;
  const wall = 1_800_000_000_000;
  const clock = new Timeline({ now: () => t, wall: () => wall + t });
  let maxError = 0;
  const tracks = new Set();
  for (t = 0; t < 600000; t += 50) {
    const elapsed = t / 1000;
    const s = demoSample(elapsed, wall + t);
    if (t % 250 === 0) clock.accept(s);
    const snap = clock.snapshot();
    tracks.add(snap.track.id);
    maxError = Math.max(maxError, Math.abs(snap.position - s.positionSec));
    if (snap.track.id === "demo-none")
      assert.equal(demoLyrics(snap.track, parse).lines.length, 0);
  }
  assert.equal(tracks.size, 3);
  assert.ok(maxError < 0.001, `max=${maxError}`);
  console.log(
    JSON.stringify({
      type: "virtual-replay",
      durationSec: 600,
      maxErrorSec: maxError,
      frameStepMs: 50,
      sourceIntervalMs: 250,
      notRealTime: true,
    }),
  );
});
test("live rhythm never uses test oscillator and all mapping ranges are bounded", () => {
  for (let t = 0; t < 20; t += 0.01) {
    assert.equal(motion({ playing: true, time: t }).beatPulse, 0);
    const v = motion({ demo: true, playing: true, time: t });
    assert.ok(v.beatPulse <= 1.4 && v.bass <= 1.2 && v.beatGlow <= 1.7);
  }
  assert.equal(motion({ demo: true, playing: false, time: 3 }).beatPulse, 0);
});
test("LRC offset and same-track duration recovery do not require a manual retry", async () => {
  const p = parse({ lyric: "[offset:500]\n[00:01.00]一句" });
  assert.equal(p.lines[0].t, 1.5);
  let calls = 0;
  const lyrics = new Lyrics(async () => {
    calls++;
    return { lines: [] };
  });
  await lyrics.change({ id: "same" }, 0);
  await lyrics.change({ id: "same" }, 200);
  await lyrics.change({ id: "same" }, 200);
  assert.equal(calls, 2);
});
test("explicit disconnect freezes immediately, recovery needs a fresh anchor", () => {
  const h = harness();
  h.clock.accept(h.sample());
  h.advance(500);
  h.clock.accept({ source: "gsmtc", connected: false });
  h.advance(500);
  assert.equal(h.clock.position(), 10.5);
  assert.equal(h.clock.snapshot().playing, false);
  h.clock.accept(h.sample(12));
  assert.equal(h.clock.position(), 12);
});
