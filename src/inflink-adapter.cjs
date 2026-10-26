// This module accepts the documented InfLink API units (milliseconds).
// It never relabels an API message as native GSMTC.
function validateFrame(frame, now = Date.now()) {
  if (!frame || frame.protocol !== 1 || frame.source !== "inflink-api")
    throw Error("protocol/source");
  if (
    typeof frame.instance !== "string" ||
    !/^[a-zA-Z0-9-]{8,80}$/.test(frame.instance)
  )
    throw Error("instance");
  for (const key of ["sequence", "generation"])
    if (!Number.isSafeInteger(frame[key]) || frame[key] < 1) throw Error(key);
  if (!["sample", "track", "disconnect"].includes(frame.kind))
    throw Error("kind");
  if (!Number.isFinite(frame.sentAtMs) || Math.abs(frame.sentAtMs - now) > 5000)
    throw Error("sent timestamp");
  if (frame.kind === "disconnect") return frame;
  if (frame.pluginVersion !== "3.4.0") throw Error("unpinned plugin version");
  if (!["Playing", "Paused"].includes(frame.status)) throw Error("status");
  const t = frame.track;
  if (
    !t ||
    !["id", "title", "artist", "album", "trackId"].every(
      (k) => typeof t[k] === "string" && t[k].length <= 1000,
    )
  )
    throw Error("track fields");
  if (!/^\d+$/.test(t.id) || t.id === "0" || !t.title)
    throw Error("real online song ID required");
  if (frame.kind === "track") return frame;
  if (frame.trace != null) {
    const t = frame.trace;
    for (const key of ["event", "eventAtMs", "intervalMs", "sdkReadAtMs", "sdkPositionMs"])
      if (!Number.isFinite(t[key]) || t[key] < 0) throw Error("trace bounds");
    if (!Number.isSafeInteger(t.event) || t.event < 1 || t.sdkReadAtMs > frame.sentAtMs + 100 || t.eventAtMs > frame.sentAtMs + 100)
      throw Error("trace timestamp");
  }
  for (const key of ["positionMs", "durationMs", "timelineAtMs"])
    if (!Number.isFinite(frame[key])) throw Error(key);
  if (
    frame.positionMs < 0 ||
    frame.durationMs <= 0 ||
    frame.durationMs > 86400000 ||
    frame.positionMs > frame.durationMs + 2000
  )
    throw Error("timeline bounds");
  if (
    frame.timelineAtMs > now + 1000 ||
    frame.timelineAtMs > frame.sentAtMs + 100
  )
    throw Error("timeline timestamp");
  if (
    !t ||
    !["id", "title", "artist", "album", "trackId"].every(
      (k) => typeof t[k] === "string" && t[k].length <= 1000,
    )
  )
    throw Error("track fields");
  if (!/^\d+$/.test(t.id) || t.id === "0" || !t.title)
    throw Error("real online song ID required");
  if (
    frame.reset != null &&
    !["seek", "loop", "track", "reconnect", "state"].includes(frame.reset)
  )
    throw Error("reset");
  if (frame.timelineOrigin != null && !["native-event","paused-query"].includes(frame.timelineOrigin))
    throw Error("timeline origin");
  if (frame.audio != null) {
    const a = frame.audio;
    if (a.source !== "inflink-pcm" || a.trackId !== t.id || a.generation !== frame.generation ||
        !Number.isFinite(a.observedAtMs) || a.observedAtMs <= 0 || a.observedAtMs > frame.sentAtMs + 100 ||
        !Number.isFinite(a.ptsMs) || (a.ptsMs < 0 && !(a.ptsMs === -2147483648 && a.timingQuality === "callback-receipt/no-native-pts")) || a.ptsMs > frame.durationMs + 2000 ||
        !Number.isSafeInteger(a.sampleFrames) || a.sampleFrames < 1 || a.sampleFrames > 262144)
      throw Error("audio identity/timestamp");
    for (const [key,max] of [["rms",1],["bass",1.2],["beatPulse",1.4],["beatGlow",1.7]])
      if (!Number.isFinite(a[key]) || a[key] < 0 || a[key] > max) throw Error("audio range");
    if (a.timingQuality != null) {
      if (!["native-pts", "callback-receipt/no-native-pts"].includes(a.timingQuality) ||
          a.callbackReceivedAtMs !== a.observedAtMs ||
          (a.timingQuality === "callback-receipt/no-native-pts" && a.ptsMs !== 0 && a.ptsMs !== -2147483648))
        throw Error("audio timing quality");
    }
  }
  return frame;
}
function adaptFrame(frame, { runId, receivedAtMs = Date.now() }) {
  validateFrame(frame, receivedAtMs);
  const base = {
    source: "inflink-api",
    sessionId: `inflink:${runId}:${frame.instance}`,
    generation: frame.generation,
    sequence: frame.sequence,
    sampledAtMs: receivedAtMs,
    sentAtMs: frame.sentAtMs,
    trace: frame.trace,
    connected: frame.kind !== "disconnect",
    reset: frame.reset,
    sourceMeta: {
      pluginVersion: frame.pluginVersion,
      transport: "authenticated-loopback-http",
    },
  };
  if (!base.connected) return base;
  if (frame.kind === "track")
    return {
      ...base,
      track: frame.track,
      status: frame.status.toLowerCase(),
      timelineUsable: false,
      positionSec: 0,
      durationSec: 0,
      updatedAtMs: 0,
      reset: "track",
    };
  return {
    ...base,
    track: frame.track,
    status: frame.status.toLowerCase(),
    positionSec: frame.positionMs / 1000,
    durationSec: frame.durationMs / 1000,
    updatedAtMs: frame.timelineAtMs,
    rate: 1,
    timelineUsable: true,
    audio: frame.audio,
    fields: {
      id: "observed-inflink-api",
      position: "observed-ms-inflink-api",
      duration: "observed-ms-inflink-api",
      updatedAt: frame.timelineOrigin === "paused-query" ? "paused-api-read-receipt-estimate" : "plugin-event-receipt-estimate",
    },
  };
}
module.exports = { validateFrame, adaptFrame };
