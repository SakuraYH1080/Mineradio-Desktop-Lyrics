/* Shared, local-only script selection. Indices remain UTF-16 lyric/word indices. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LyricTypography = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var scripts = Object.freeze(['zh', 'latin', 'ja', 'ko', 'cyrillic']);
  var languageModes = Object.freeze(['auto', 'zh', 'ja', 'ko', 'latin', 'cyrillic']);
  var samples = Object.freeze({
    default: '让音乐继续 · Music keeps going · 0123456789',
    zh: '让旋律陪伴此刻，愿每一个字都清晰。',
    latin: 'The music keeps going. À bientôt, mañana! 0123456789',
    ja: '音楽と一緒に、今日も歩いていこう。カタカナ',
    ko: '음악과 함께 오늘도 한 걸음씩 걸어가요.',
    cyrillic: 'Музыка объединяет мир. Ёжик, любовь и мечты.',
  });
  var han = /\p{Script=Han}/u;
  var kana = /[\p{Script=Hiragana}\p{Script=Katakana}\u30fc\uff70\u3031-\u3035]/u;
  var hangul = /\p{Script=Hangul}/u;
  var latin = /\p{Script=Latin}/u;
  var cyrillic = /\p{Script=Cyrillic}/u;
  var letter = /\p{Letter}/u;
  var mark = /\p{Mark}/u;
  var credit = /^(?:作词|作詞|作曲|编曲|編曲|词曲|詞曲|词|詞|曲|制作人|製作人|演唱|歌手|lyricist|lyrics?|composer|music|arranger|arrangement|vocals?)(?:\s*[\/／&・]\s*(?:作词|作詞|作曲|编曲|編曲|词曲|詞曲))*\s*[:：]/iu;
  var opening = /^\s*[\(\[\{«‹“‘「『【〔〈《〖〘〚]+\s*$/u;
  var segmenter;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter)
      segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  } catch (_) {}

  function normalizeLanguage(value) {
    return languageModes.indexOf(value) >= 0 ? value : 'auto';
  }

  function hangulClass(point) {
    if ((point >= 0x1100 && point <= 0x115f) || (point >= 0xa960 && point <= 0xa97c)) return 'L';
    if ((point >= 0x1160 && point <= 0x11a7) || (point >= 0xd7b0 && point <= 0xd7c6)) return 'V';
    if ((point >= 0x11a8 && point <= 0x11ff) || (point >= 0xd7cb && point <= 0xd7fb)) return 'T';
    if (point >= 0xac00 && point <= 0xd7a3) return (point - 0xac00) % 28 ? 'LVT' : 'LV';
    return '';
  }

  function joinsHangul(before, after) {
    return before === 'L' && ['L', 'V', 'LV', 'LVT'].indexOf(after) >= 0 ||
      (before === 'LV' || before === 'V') && (after === 'V' || after === 'T') ||
      (before === 'LVT' || before === 'T') && after === 'T';
  }

  function fallbackGraphemes(text) {
    // Current Electron uses Intl.Segmenter. This conservative fallback also keeps
    // combining marks, variation selectors, emoji joins/flags and Hangul Jamo intact.
    var result = [], offset = 0, previousPoint = -1, regionalCount = 0;
    for (var ch of text) {
      var point = ch.codePointAt(0);
      var regional = point >= 0x1f1e6 && point <= 0x1f1ff;
      var variation = point >= 0xfe00 && point <= 0xfe0f || point >= 0xe0100 && point <= 0xe01ef;
      var modifier = point >= 0x1f3fb && point <= 0x1f3ff;
      var tag = point >= 0xe0020 && point <= 0xe007f;
      var join = result.length && (mark.test(ch) || variation || modifier || tag || point === 0x200d || previousPoint === 0x200d ||
        previousPoint === 0x0d && point === 0x0a ||
        joinsHangul(hangulClass(previousPoint), hangulClass(point)) || regional && regionalCount % 2 === 1);
      if (join) {
        var last = result[result.length - 1];
        last.text += ch;
        last.end += ch.length;
      } else result.push({ text: ch, start: offset, end: offset + ch.length });
      offset += ch.length;
      regionalCount = regional ? regionalCount + 1 : 0;
      previousPoint = point;
    }
    return result;
  }

  function graphemes(value) {
    var text = value == null ? '' : String(value);
    if (!segmenter) return fallbackGraphemes(text);
    return Array.from(segmenter.segment(text), function (part) {
      return { text: part.segment, start: part.index, end: part.index + part.segment.length };
    });
  }

  function scriptOf(text) {
    if (kana.test(text)) return 'ja';
    if (hangul.test(text)) return 'ko';
    if (han.test(text)) return 'han';
    if (latin.test(text)) return 'latin';
    if (cyrillic.test(text)) return 'cyrillic';
    return letter.test(text) ? 'default' : '';
  }

  function counts(text) {
    var result = { ja: 0, ko: 0, han: 0, latin: 0, cyrillic: 0 };
    for (var ch of String(text || '')) {
      var script = scriptOf(ch);
      if (Object.prototype.hasOwnProperty.call(result, script)) result[script]++;
    }
    return result;
  }

  function cjkEvidence(count) {
    if (count.ja && !count.ko) return 'ja';
    if (count.ko && !count.ja) return 'ko';
    // Mixed evidence is not a reliable single-language decision unless one
    // script clearly dominates. The user can override ambiguous Han selection.
    if (count.ja > count.ko * 1.5) return 'ja';
    if (count.ko > count.ja * 1.5) return 'ko';
    return 'auto';
  }

  function detectLanguage(text) {
    var count = counts(text), cjk = cjkEvidence(count);
    if (cjk !== 'auto') return cjk;
    if (count.ja || count.ko) return 'auto';
    if (count.latin > count.cyrillic) return 'latin';
    if (count.cyrillic > count.latin) return 'cyrillic';
    // Han alone is deliberately not labelled Chinese or Japanese.
    return 'auto';
  }

  function contextLanguage(lines) {
    var evidence = { ja: 0, ko: 0 };
    for (var line of Array.isArray(lines) ? lines : []) {
      if (line && typeof line === 'object' && line.fallback) continue;
      var text = typeof line === 'string' ? line : line && typeof line.text === 'string' ? line.text : '';
      if (!text || credit.test(text.trim())) continue;
      // Only the main lyric text participates; translation/artist/title metadata
      // is never consulted when choosing the Han context for a song.
      var count = counts(text);
      evidence.ja += count.ja;
      evidence.ko += count.ko;
    }
    return cjkEvidence(evidence);
  }

  function familyFor(script, families) {
    var value = families[script];
    if (typeof value === 'string' && value.trim()) return value;
    return typeof families.default === 'string' ? families.default : '';
  }

  function createRuns(value, options) {
    var text = value == null ? '' : String(value);
    options = options || {};
    var families = options.families && typeof options.families === 'object' ? options.families : {};
    var language = normalizeLanguage(options.language), context = normalizeLanguage(options.context);
    var local = cjkEvidence(counts(text));
    var hanScript = ['zh', 'ja', 'ko'].indexOf(language) >= 0 ? language
      : local !== 'auto' ? local : ['zh', 'ja', 'ko'].indexOf(context) >= 0 ? context : 'default';
    var detected = detectLanguage(text);
    var neutralScript = language !== 'auto' ? language : detected !== 'auto' ? detected
      : context !== 'auto' ? context : han.test(text) ? hanScript : 'default';
    var units = graphemes(text).map(function (part) {
      var script = scriptOf(part.text);
      return { text: part.text, start: part.start, end: part.end, script: script === 'han' ? hanScript : script };
    });
    // Attach whole neutral stretches, rather than creating numeric/punctuation
    // nodes. Opening punctuation follows the right-hand text; most other shared
    // symbols follow the left, unless an explicit context resolves the boundary.
    for (var i = 0; i < units.length;) {
      if (units[i].script) { i++; continue; }
      var start = i;
      while (i < units.length && !units[i].script) i++;
      var left = start ? units[start - 1].script : '';
      var right = i < units.length ? units[i].script : '';
      var gapText = text.slice(units[start].start, units[i - 1].end);
      var chosen = left && left === right ? left : !left ? right || neutralScript : !right ? left
        : opening.test(gapText) ? right
        : language !== 'auto' && (left === language || right === language) ? language : left;
      for (var n = start; n < i; n++) units[n].script = chosen;
    }
    var runs = [];
    for (var unit of units) {
      var family = familyFor(unit.script, families);
      var previous = runs[runs.length - 1];
      if (previous && previous.script === unit.script && previous.fontFamily === family && previous.end === unit.start) {
        previous.text += unit.text;
        previous.end = unit.end;
      } else runs.push({ start: unit.start, end: unit.end, text: unit.text, script: unit.script, fontFamily: family });
    }
    return runs;
  }

  return Object.freeze({
    scripts: scripts,
    languageModes: languageModes,
    samples: samples,
    normalizeLanguage: normalizeLanguage,
    graphemes: graphemes,
    detectLanguage: detectLanguage,
    contextLanguage: contextLanguage,
    createRuns: createRuns,
  });
});
