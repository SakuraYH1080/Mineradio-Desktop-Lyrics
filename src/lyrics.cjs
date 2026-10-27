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
function lyricField(value) {
  if (value == null) return { text: '', state: 'absent' };
  const text = typeof value === 'string' ? value
    : typeof value === 'object' && !Array.isArray(value) ? value.lyric : undefined;
  if (typeof text !== 'string') return { text: '', state: 'invalid-type' };
  return { text, state: text.trim() ? 'text' : 'empty', version: typeof value === 'object' && Number.isFinite(value.version) ? value.version : undefined };
}
function normalizeLrcTimeTags(text) {
  // LRC fields also use [mm:ss:decimal]. Keep decimal precision, Unicode,
  // existing dot timestamps and offset tags intact; never touch YRC milliseconds.
  return text.replace(/\[(\d{1,2}):([0-5]?\d):(\d{1,3})\]/g, '[$1:$2.$3]');
}
function instrumentalText(text) {
  const compact = String(text || '').replace(/\s+/g, '').replace(/[，,。.!！?？、~～]/g, '');
  return /^(?:纯音乐(?:请欣赏)?|此歌曲为没有填词的纯音乐请您欣赏)$/.test(compact);
}
function creditText(text) {
  // This scores candidate completeness only; selected timed credits are not removed.
  return /^(?:作词|作詞|作曲|编曲|編曲|词曲|詞曲|词|詞|曲|制作人|製作人|演唱|歌手|lyricist|lyrics?|composer|music|arranger|arrangement|vocals?)(?:\s*[\/／&・]\s*(?:作词|作詞|作曲|编曲|編曲|词曲|詞曲))*\s*[:：]/iu.test(String(text || '').trim());
}
function lineQuality(parsed) {
  const timed = (parsed.lines || []).filter(l => !l.fallback && Number.isFinite(l.t) && String(l.text || '').trim());
  const display = timed.filter(l => !context.isNoLyricText(l.text) && !instrumentalText(l.text));
  const body = display.filter(l => !creditText(l.text));
  return {
    timed: timed.length, display: display.length, body: body.length,
    wordBody: body.filter(l => l.words?.some(w => Number.isFinite(w.t) && Number.isFinite(w.d) && w.d > 0 && w.c1 > w.c0)).length,
    bodyCharacters: body.reduce((sum,l) => sum + l.text.replace(/\s/g,'').length, 0),
    // Upstream caps display durations; real word endpoints can extend farther.
    bodyEnd: body.reduce((end,l) => (l.words || []).reduce((edge,w) =>
      Number.isFinite(w.t) && Number.isFinite(w.d) ? Math.max(edge,w.t+w.d) : edge,
      Math.max(end,l.t + (Number.isFinite(l.duration) ? l.duration : 0))), 0),
    lastBodyStart: body.length ? body[body.length-1].t : 0,
    instrumental: timed.some(l => instrumentalText(l.text)),
  };
}
function parse(payload = {}) {
  const fields = Object.fromEntries(['lyric','lrc','yrc','tlyric','ytlrc'].map(k => [k, lyricField(payload[k])]));
  const lyric = normalizeLrcTimeTags(fields.lyric.state === 'text' ? fields.lyric.text : fields.lrc.text);
  const translations = { tlyric: normalizeLrcTimeTags(fields.tlyric.text), ytlrc: fields.ytlrc.text };
  const candidates = {};
  // Parse independently: a broken or credit-only YRC must not hide a valid LRC.
  const responses = {
    yrc: { yrc: fields.yrc.text, ...translations },
    lrc: { lyric, ...translations },
  };
  if (fields.lyric.state === 'text' && fields.lrc.state === 'text' && fields.lyric.text !== fields.lrc.text)
    responses.lrcAlternative = { lyric:normalizeLrcTimeTags(fields.lrc.text), ...translations };
  for (const [name, response] of Object.entries(responses)) {
    try {
      // Keep marker evidence before the upstream fallback removes marker-only rows.
      const rawText = name === 'yrc' ? fields.yrc.text : response.lyric;
      const rawLines = name === 'yrc' ? context.parseYrcText(rawText) : context.parseLyricText(rawText);
      const parsed = JSON.parse(JSON.stringify(context.parseLyricResponseToOriginalState({}, response)));
      const markerOnly = rawLines.length ? rawLines.every(l => context.isNoLyricText(l.text) || instrumentalText(l.text))
        : context.isNoLyricText(rawText) || instrumentalText(rawText);
      const quality = lineQuality({lines:rawLines});
      if (!rawLines.length && instrumentalText(rawText)) quality.instrumental = true;
      candidates[name] = { parsed, quality, rawText, malformed:!!rawText.trim() && !rawLines.length && !markerOnly };
    } catch (error) {
      candidates[name] = { parsed: { lines: [] }, quality: { timed:0, display:0, body:0, wordBody:0, bodyCharacters:0, bodyEnd:0, lastBodyStart:0, instrumental:false }, error:error.message };
    }
  }
  const alternative = candidates.lrcAlternative?.quality, primary = candidates.lrc.quality;
  const useAlternative = alternative && ((alternative.body && (!primary.body || alternative.bodyCharacters > primary.bodyCharacters)) ||
    (!primary.display && alternative.display));
  const plain = candidates[useAlternative ? 'lrcAlternative' : 'lrc'];
  const y = candidates.yrc.quality, l = plain.quality;
  // Reject an obviously truncated word prefix when the same response has a
  // substantially fuller LRC; differing line granularity alone is not evidence.
  const incompleteYrc = y.wordBody && l.body > y.body &&
    y.bodyCharacters < l.bodyCharacters * .5 && y.bodyEnd + 3 < l.lastBodyStart;
  const source = y.wordBody && !incompleteYrc ? 'yrc' : l.body ? 'lrc' : y.body ? 'yrc' : l.display ? 'lrc' : y.display ? 'yrc' : null;
  const diagnostics = {
    apiCode: payload.code ?? null,
    fields: Object.fromEntries(Object.entries(fields).map(([key,v]) => [key, { state:v.state, characters:v.text.length, version:v.version }])),
    candidates: Object.fromEntries(Object.entries(candidates).map(([key,v]) => [key, { ...v.quality, error:v.error }])),
    selected: source,
    lrcField: useAlternative || fields.lyric.state !== 'text' ? 'lrc' : 'lyric',
    reason: incompleteYrc && source === 'lrc' ? 'incomplete-yrc-use-lrc' : source === 'yrc' && y.wordBody ? 'valid-word-body' : source === 'lrc' && l.body ? 'lrc-body-fallback' : source ? 'timed-content' : 'no-displayable-timed-content',
  };
  const pure = payload.nolyric === true || (!y.body && !l.body && Object.values(candidates).some(v => v.quality.instrumental));
  if (source && !pure) {
    const parsed = source === 'lrc' ? plain.parsed : candidates.yrc.parsed;
    // Preserve the selected real timed credits and the original offset rules.
    parsed.lines = parsed.lines.filter(line => !line.fallback && Number.isFinite(line.t) && !context.isNoLyricText(line.text) && !instrumentalText(line.text));
    const offset = (plain.rawText || lyric).match(/\[offset:([+-]?\d+)\]/i);
    if (offset && !parsed.hasNativeKaraoke) {
      const seconds = Number(offset[1]) / 1000;
      parsed.lines.forEach(line => { line.t = Math.max(0, line.t + seconds); });
    }
    return { ...parsed, usableLyric:true, kind:'lyrics', diagnostics };
  }
  const malformed = Object.values(candidates).some(v => v.error) ||
    Object.values(candidates).some(v => v.malformed) ||
    [fields.lyric,fields.lrc,fields.yrc].some(v => v.state === 'invalid-type');
  return {
    lines: [], usableLyric:false, hasNativeKaraoke:false, timingSource:'none',
    kind: pure ? 'instrumental' : malformed ? 'parse-failure' : 'missing',
    diagnostics,
  };
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
function checkedApiResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw Error('Invalid lyric API response structure');
  if (data.code != null && Number(data.code) !== 200)
    throw Error(`Lyric API error ${String(data.code)}`);
  return data;
}
async function online(track, duration) {
  let id = track.id;
  let certainty = "song-id";
  if (!id) {
    const data = checkedApiResponse(await request("https://music.163.com/api/search/get", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        s: [track.title, track.artist].join(" "),
        type: "1",
        limit: "10",
        offset: "0",
      }),
    }));
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
  const data = checkedApiResponse(await request(
    `https://music.163.com/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1&yv=-1`,
  ));
  const parsed = parse(data);
  return {
    ...parsed,
    status: parsed.kind === 'lyrics' ? '在线歌词' : parsed.kind === 'instrumental' ? '确认纯音乐'
      : parsed.kind === 'parse-failure' ? '歌词解析失败' : '暂无歌词',
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
    this.inFlight = null;
    this.retryAt = Infinity;
    this.value = { lines: [], status: "等待曲目" };
  }
  canRetry(now = Date.now()) {
    return !this.inFlight && !this.value.usableLyric && now >= this.retryAt;
  }
  async change(track, duration, force = false, retryExpired = false) {
    const key = trackKey(track);
    if (!force && key === this.key && this.inFlight) return this.inFlight;
    if (!force && key === this.key && (this.duration > 0 || !(duration > 0)) && !(retryExpired && this.canRetry()))
      return;
    this.key = key;
    this.duration = duration;
    const token = ++this.token;
    this.retryAt = Infinity;
    this.value = { lines: [], kind: 'loading', status: "正在获取歌词" };
    const pending = Promise.resolve().then(() => this.loader(track, duration)).then(value => {
      if (token !== this.token) return;
      this.value = value;
      this.retryAt = value.usableLyric || value.kind === 'instrumental' ? Infinity
        : Date.now() + (value.kind === 'parse-failure' || value.kind === 'failure' ? 30000 : 120000);
    }).catch(e => {
      if (token === this.token) {
        this.value = {
          lines: [],
          kind: 'failure',
          status: "歌词获取失败，请使用本地 LRC",
          error: e.message,
        };
        this.retryAt = Date.now() + 30000;
      }
    }).finally(() => { if (token === this.token && this.inFlight === pending) this.inFlight = null; });
    this.inFlight = pending;
    return pending;
  }
}
function locate(value, time) {
  const lines = (value.lines || []).filter((l) => l && !l.fallback && Number.isFinite(l.t) && !context.isNoLyricText(l.text));
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= time) index = i;
    else break;
  }
  if (index < 0)
    return {
      // Fetch/diagnostic status is never a lyric. The presentation layer owns
      // the metadata caption until the first genuine timed line (credits included).
      phase: lines.length && Number.isFinite(time) && time < lines[0].t ? 'intro' : 'empty',
      text: '',
      highlightFollow: false,
      progress: 0,
      scrollProgress: 0,
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
