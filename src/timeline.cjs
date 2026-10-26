const trackKey = (t) =>
  t
    ? JSON.stringify([t.id || "", t.title || "", t.artist || "", t.album || ""])
    : "";
class Timeline {
  constructor({
    now = () => performance.now(),
    wall = () => Date.now(),
    staleMs = 2500,
    allowedSource = null,
  } = {}) {
    Object.assign(this, { now, wall, staleMs, allowedSource });
    this.reset();
  }
  reset() {
    this.sample = null;
    this.anchor = null;
    this.received = -Infinity;
    this.connected = false;
    this.key = "";
    this.resetSerial = (this.resetSerial || 0) + 1;
    this.resetReason = "initial";
  }
  accept(s) {
    if (
      !["gsmtc", "gsmtc-inflink", "replay", "inflink-api"].includes(s.source) ||
      (this.allowedSource && s.source !== this.allowedSource)
    )
      return ["rejected-source"];
    if (
      (s.source === "gsmtc" || s.source === "gsmtc-inflink") &&
      s.connected &&
      !/^cloudmusic\.exe$/i.test(s.sessionId || "")
    )
      return ["rejected-session"];
    if (
      s.source === "inflink-api" &&
      s.connected &&
      (!/^inflink:[a-zA-Z0-9-]+:[a-zA-Z0-9-]+$/.test(s.sessionId || "") ||
        !Number.isSafeInteger(s.generation))
    )
      return ["rejected-session"];
    if (this.sample && s.sampledAtMs < this.sample.sampledAtMs)
      return ["rejected-out-of-order"];
    const events = [];
    const now = this.now();
    if (!s.connected) {
      const position = this.position();
      if (this.anchor)
        this.anchor = { ...this.anchor, position, at: now, deadline: -Infinity, playing: false, pausedConfirmed: false };
      this.connected = false;
      this.resetSerial++;
      this.resetReason = "disconnect";
      this.received = now;
      return ["disconnected"];
    }
    const key =
      trackKey(s.track) +
      (s.generation == null ? "" : `|${s.sessionId}|${s.generation}`);
    const changed = key !== this.key;
    if (changed) {
      this.anchor = null;
      this.key = key;
      events.push("track-changed");
    }
    const reconnected = !this.connected || now - this.received > this.staleMs;
    if (reconnected) events.push("connected");
    const before = this.position();
    if (reconnected && this.anchor)
      this.anchor = { ...this.anchor, position: before, at: now, deadline: -Infinity, playing: false, pausedConfirmed: false };
    this.connected = true;
    this.received = now;
    const valid =
      s.timelineUsable === true &&
      Number.isFinite(s.positionSec) &&
      s.positionSec >= 0 &&
      Number.isFinite(s.durationSec) &&
      s.durationSec > 0 &&
      Number.isFinite(s.updatedAtMs) &&
      s.updatedAtMs > 0 &&
      s.updatedAtMs <= this.wall() + 1000;
    const fresh = valid && this.wall() - s.updatedAtMs <= this.staleMs;
    const newer = !this.anchor || s.updatedAtMs > this.anchor.updatedAtMs;
    // Batched native callbacks can report distinct positions in the same wall
    // millisecond. A repeated heartbeat has the same reported position, whereas
    // a fresh correction/seek must re-anchor even when the timestamp ties.
    const tiedCorrection = this.anchor && s.updatedAtMs === this.anchor.updatedAtMs && s.positionSec !== this.anchor.reportedPosition;
    const statusChanged = this.sample?.status !== s.status;
    if (fresh && (newer || tiedCorrection || s.reset || changed || statusChanged || this.anchor?.deadline === -Infinity)) {
      const rate = Number.isFinite(s.rate)
        ? Math.max(0.25, Math.min(4, s.rate))
        : 1;
      const age = Math.max(0, this.wall() - s.updatedAtMs);
      const position =
        s.positionSec + (s.status === "playing" ? (age / 1000) * rate : 0);
      if (
        !changed &&
        this.anchor &&
        (position < before - 0.08 || Math.abs(position - before) > 0.35)
      )
        events.push(position < before ? "seek-back-or-loop" : "seek-forward");
      this.anchor = {
        position,
        at: now,
        deadline: now + Math.max(0, this.staleMs - age),
        updatedAtMs: s.updatedAtMs,
        reportedPosition: s.positionSec,
        duration: s.durationSec,
        rate,
        playing: s.status === "playing",
        pausedConfirmed: s.status === "paused",
      };
    } else if (statusChanged && this.anchor) {
      // A status-only update cannot make an obsolete timeline valid again.
      this.anchor = {
        ...this.anchor,
        position: before,
        at: now,
        playing: false,
      };
    }
    if (statusChanged) events.push(s.status);
    if (
      changed ||
      reconnected ||
      statusChanged ||
      s.reset ||
      events.some((e) => e.startsWith("seek-"))
    ) {
      this.resetSerial++;
      this.resetReason = changed
        ? "track"
        : reconnected
          ? "reconnect"
          : s.reset || events.find((e) => e.startsWith("seek-")) || "state";
    }
    this.sample = s;
    return events;
  }
  position() {
    const a = this.anchor;
    if (!a) return 0;
    const end = Math.min(this.now(), a.deadline, this.received + this.staleMs);
    return Math.max(
      0,
      Math.min(
        a.duration,
        a.position +
          (a.playing ? (Math.max(0, end - a.at) / 1000) * a.rate : 0),
      ),
    );
  }
  snapshot() {
    const healthy =
      this.connected && this.now() - this.received <= this.staleMs;
    const usable =
      healthy &&
      !!this.anchor &&
      (this.now() <= this.anchor.deadline ||
        (this.anchor.pausedConfirmed && this.sample?.status === "paused"));
    return {
      track: this.sample?.track,
      generation: this.sample?.generation,
      source: this.sample?.source,
      resetSerial: this.resetSerial,
      resetReason: this.resetReason,
      key: this.key,
      connected: healthy,
      usable,
      position: this.position(),
      duration: this.anchor?.duration || 0,
      playing:
        usable && this.sample?.status === "playing" && this.anchor.playing,
      quality: !healthy
        ? "disconnected"
        : usable
          ? this.sample?.status === "paused" ? "confirmed-paused-anchor" : "timestamp-extrapolated"
          : "timeline-unavailable-or-stale",
    };
  }
}
module.exports = { Timeline, trackKey };
