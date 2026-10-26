const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { trackKey } = require("./timeline.cjs");
// Keep upstream parser intact; load definitions only, never load the player or DOM.
const context = vm.createContext({
  window: {},
  document: null,
  console,
  normalizeStageLyricText: (s) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim(),
  cloneLyricLines: (ls) => JSON.parse(JSON.stringify(ls)),
});
vm.runInContext(
  fs.readFileSync(
    path.join(__dirname, "../vendor/lyrics-fetch-parse.js"),
    "utf8",
  ),
  context,
);
function parse(payload) {
  const normalized = {
    lyric: payload.lyric || payload.lrc?.lyric || "",
    yrc:
      typeof payload.yrc === "string" ? payload.yrc : payload.yrc?.lyric || "",
    tlyric:
      typeof payload.tlyric === "string"
        ? payload.tlyric
        : payload.tlyric?.lyric || "",
  };
  // Upstream does not apply the standard LRC offset tag. Apply once at boundary.
  const parsed = JSON.parse(
    JSON.stringify(context.parseLyricResponseToOriginalState({}, normalized)),
  );
  // Some real instrumental responses contain timed "作词: 无 / 作曲: 无"
  // credits before the no-lyrics marker. Credits alone are not sung lyrics.
  const content = parsed.lines.filter(line => !line.fallback);
  const instrumental = payload.nolyric === true || content.some(line => /纯音乐|没有填词/.test(line.text));
  const hasSungText = content.some(line => {
    if (context.isNoLyricText(line.text)) return false;
    return !(line.t <= 2 && /^(作词|作曲|编曲|词曲|词|曲|制作人|composer|lyricist)\s*[:：]/i.test(line.text));
  });
  if (payload.nolyric === true || !hasSungText) {
    parsed.lines = [];
    parsed.usableLyric = false;
    parsed.hasNativeKaraoke = false;
    parsed.timingSource = "none";
  }
  parsed.kind = parsed.usableLyric ? 'lyrics' : instrumental ? 'instrumental' : 'missing';
  const offset = normalized.lyric.match(/\[offset:([+-]?\d+)\]/i);
  if (offset && !parsed.hasNativeKaraoke) {
    const seconds = Number(offset[1]) / 1000;
    parsed.lines.forEach((line) => {
      line.t = Math.max(0, line.t + seconds);
    });
  }
  return parsed;
}
const norm = (s) =>
  String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
function selectCandidate(track, duration, candidates) {
  const exact = candidates.filter(
    (c) =>
      norm(c.title) === norm(track.title) &&
      norm(c.artist) === norm(track.artist) &&
      track.album &&
      norm(c.album) === norm(track.album) &&
      duration > 0 &&
      Math.abs(c.duration - duration) <= 2,
  );
  return exact.length === 1
    ? { track: exact[0], certainty: "metadata-exact" }
    : { track: null, certainty: "uncertain", candidates };
}
async function request(url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}
async function online(track, duration) {
  let id = track.id;
  let certainty = "song-id";
  if (!id) {
    const data = await request("https://music.163.com/api/search/get", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        s: [track.title, track.artist].join(" "),
        type: "1",
        limit: "10",
        offset: "0",
      }),
    });
    const candidates = (data.result?.songs || []).map((c) => ({
      id: c.id,
      title: c.name,
      artist: (c.artists || []).map((a) => a.name).join(" / "),
      album: c.album?.name || "",
      duration: c.duration / 1000,
    }));
    const match = selectCandidate(track, duration, candidates);
    if (!match.track)
      return {
        lines: [],
        usableLyric: false,
        status: "匹配不确定，请绑定歌曲 ID 或本地 LRC",
        match,
      };
    id = match.track.id;
    certainty = match.certainty;
  }
  if (!/^\d+$/.test(String(id))) throw Error("Invalid Netease song ID");
  const data = await request(
    `https://music.163.com/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1&yv=-1`,
  );
  const parsed = parse(data);
  return {
    ...parsed,
    status: parsed.usableLyric ? "在线歌词" : "无歌词 / 纯音乐",
    match: { id, certainty },
    source: "netease-public-api",
  };
}
class Lyrics {
  constructor(loader = online) {
    this.loader = loader;
    this.key = "";
    this.token = 0;
    this.duration = 0;
    this.value = { lines: [], status: "等待曲目" };
  }
  async change(track, duration, force = false) {
    const key = trackKey(track);
    if (!force && key === this.key && (this.duration > 0 || !(duration > 0)))
      return;
    this.key = key;
    this.duration = duration;
    const token = ++this.token;
    this.value = { lines: [], kind: 'loading', status: "正在获取歌词" };
    try {
      const value = await this.loader(track, duration);
      if (token === this.token) this.value = value;
    } catch (e) {
      if (token === this.token)
        this.value = {
          lines: [],
          kind: 'failure',
          status: "歌词获取失败，请使用本地 LRC",
          error: e.message,
        };
    }
  }
}
function locate(value, time) {
  const lines = (value.lines || []).filter((l) => !l.fallback);
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= time) index = i;
    else break;
  }
  if (index < 0)
    return {
      text: value.status || "等待歌词",
      highlightFollow: false,
      progress: 0,
      progressSpan: 4.8,
    };
  const line = lines[index];
  const span = Math.max(
    0.75,
    (lines[index + 1]?.t || line.t + line.duration) - line.t,
  );
  // LRC has no word timing: deliberately disable word/highlight interpolation.
  let progress = 0;
  if (line.words?.length) {
    let count = 0;
    for (const w of line.words)
      count += Math.max(0, Math.min(1, (time - w.t) / w.d)) * (w.c1 - w.c0);
    progress = Math.min(1, count / line.charCount);
  }
  return {
    text: line.text,
    progress,
    // Separate line time from karaoke progress: LRC has no word highlight,
    // but still needs a complete, playback-bound clock for horizontal scroll.
    scrollProgress: Math.max(0, Math.min(1, (time - line.t) / span)),
    progressMode: line.words?.length ? "word" : "line",
    // Renderer must not invent uniform progress through a word-timing gap.
    progressVelocity: line.words?.length ? 0 : null,
    lineKey: `${index}|${line.t}|${line.text}`,
    progressSpan: span,
    highlightFollow: !!line.words?.length,
  };
}
module.exports = { parse, locate, Lyrics, online, selectCandidate };
