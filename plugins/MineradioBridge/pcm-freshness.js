// Receipt time is a freshness bound, NEVER an audio sample timestamp.
// Observed missing clocks: zero, or the signed INT32_MIN value. Neither is
// replaced by a made-up sample timestamp. Other negative values remain invalid.
(function (root) {
  class PcmFreshness {
    constructor() { this.reset(); }
    reset() { this.last = null; this.streak = 0; this.since = null; }
    accept(d, ctx) {
      const now = ctx.monotonicMs;
      if (!ctx.playing || !ctx.confirmed || ctx.timelineAgeMs < 0 || ctx.timelineAgeMs > 500) {
        this.reset(); return { ok: false, reason: 'stale-context' };
      }
      if (!d || !(d.data instanceof ArrayBuffer) || d.data.byteLength < 4 ||
          d.data.byteLength > 1048576 || d.data.byteLength % 4 || !Number.isFinite(d.pts) || (d.pts < 0 && d.pts !== -2147483648))
        return { ok: false, reason: 'invalid-buffer-or-pts' };
      if (d.pts > 0) {
        this.reset();
        return Math.abs(d.pts - ctx.positionMs) <= 1000
          ? { ok: true, quality: 'native-pts' } : { ok: false, reason: 'pts-skew' };
      }
      const expectedMs = d.data.byteLength / 4 / 48000 * 1000;
      const gap = this.last === null ? null : now - this.last;
      this.last = now;
      if (gap === null || gap < Math.max(2, expectedMs * .25) || gap > Math.max(200, expectedMs * 3)) {
        this.since = now; this.streak = 1;
        return { ok: false, reason: 'zero-pts-quarantine' };
      }
      this.streak++;
      if (this.streak < 3 || now - this.since < 300)
        return { ok: false, reason: 'zero-pts-quarantine' };
      return { ok: true, quality: 'callback-receipt/no-native-pts' };
    }
  }
  if (typeof module === 'object' && module.exports) module.exports = PcmFreshness;
  else root.MineradioPcmFreshness = PcmFreshness;
})(typeof window === 'object' ? window : globalThis);
