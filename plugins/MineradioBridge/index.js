/* Runs INSIDE the NetEase BetterNCM plugin environment, never in Electron. */
(function () {
  if (window.__mineradioBridgeStop) window.__mineradioBridgeStop();
  var restoreHeader = window.MineradioHeaderCompat && window.MineradioHeaderCompat();
  var freshness = new window.MineradioPcmFreshness();
  function resetAudio() {
    audioFrame = null;
    freshness.reset();
    if (analyzer) analyzer.reset();
    if (diagnosticAnalyzer) diagnosticAnalyzer.reset();
  }
  var stop = false,
    timer = null,
    api = null,
    bindings = [],
    config = null,
    polling = false,
    lastSendAt = 0,
    lastPollAt = 0,
    audioBound = false,
    audioFrame = null,
    analyzer = null;
  var requests = new Map(), resetVersion = 0;
  var eventSequence = 0, lastEventAt = 0, trace = null;
  var counters = { timeline: 0, pcm: 0, sends: 0, busyDrops: 0, analysisMs: 0, lastAckMs: 0, maxAckMs: 0 };
  function setReset(reason) { pendingReset = reason; resetVersion++; }
  var instance =
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : "bridge-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  var sequence = 0,
    generation = 0,
    key = "",
    timeline = null,
    timelineAt = 0,
    observedNativeTimeline = false,
    timelineOrigin = "native-event",
    previous = null,
    pendingReset = null;
  var pluginPath = "";
  function clean() {
    stop = true;
    if (restoreHeader) restoreHeader();
    clearInterval(timer);
    bindings.forEach(function (b) {
      api.removeEventListener(b[0], b[1]);
    });
    bindings = [];
    requests.forEach(function (_, controller) { controller.abort(); });
    requests.clear();
    window.removeEventListener("pagehide", clean);
    window.removeEventListener("beforeunload", clean);
    if (config) post("disconnect");
  }
  window.__mineradioBridgeStop = clean;
  window.addEventListener("pagehide", clean);
  window.addEventListener("beforeunload", clean);
  async function readConfig() {
    try {
      var c = JSON.parse(
        await betterncm.fs.readFileText(pluginPath + "/connection.json"),
      );
      if (
        c.protocol === 1 &&
        /^http:\/\/127\.0\.0\.1:\d+\/v1\/state$/.test(c.endpoint) &&
        /^[a-f0-9]{64}$/.test(c.token)
      )
        return c;
    } catch (_) {}
    return null;
  }
  function onTrack(notify) {
    var s = api.getCurrentSong();
    var next = s ? String(s.trackId || s.ncmId) + "|" + s.songName : "";
    if (next !== key) {
      key = next;
      generation++;
      timeline = null;
      timelineAt = 0;
      observedNativeTimeline = false;
      previous = null;
      resetAudio();
      setReset("track");
      if (notify !== false) post("track");
    }
  }
  function onTimeline(event) {
    onTrack(false);
    var t = event.detail;
    var now = Date.now();
    if (
      !t ||
      !Number.isFinite(t.currentTime) ||
      !Number.isFinite(t.totalTime) ||
      t.totalTime <= 0
    )
      return;
    // InfLink may restore an old cached song/timeline during a cold start.
    // A getter alone cannot establish the first trustworthy clock for a track.
    if (event.query && !observedNativeTimeline) return;
    if (!event.query) observedNativeTimeline = true;
    if (previous) {
      var expected =
        previous.position + (previous.playing ? now - previous.at : 0);
      if (
        t.currentTime < previous.position - 20 ||
        Math.abs(t.currentTime - expected) > 350
      ) {
        setReset(
          t.currentTime < previous.position && t.currentTime < 1000
            ? "loop"
            : "seek");
        resetAudio();
      }
    }
    timeline = { currentTime: t.currentTime, totalTime: t.totalTime };
    timelineAt = now;
    if (!event.query) {
      counters.timeline++;
      trace = { event: ++eventSequence, eventAtMs: now, intervalMs: lastEventAt ? now-lastEventAt : 0 };
      lastEventAt = now;
    }
    timelineOrigin = event.query ? "paused-query" : "native-event";
    previous = {
      position: t.currentTime,
      at: now,
      playing: api.getPlaybackStatus() === "Playing",
    };
    // CEF may throttle interval callbacks while minimized. Real native timeline
    // events can still refresh a changed bridge session without inventing time.
    if (now - lastPollAt >= 1000) void poll();
    post("sample");
  }
  function onState() {
    void poll();
    setReset("state");
    resetAudio();
    if (api.getPlaybackStatus() !== "Playing") {
      audioFrame = null;
      if (analyzer) analyzer.reset();
    }
    // A one-off current API read on a pause transition establishes a stationary
    // anchor. Heartbeats below never re-date it; Playing still needs raw events.
    if (api.getPlaybackStatus() === "Paused") {
      onTimeline({ detail: api.getTimeline(), query: true });
      return;
    }
    post("sample");
  }
  function bind(name, fn) {
    api.addEventListener(name, fn);
    bindings.push([name, fn]);
  }
  var pcmDiagnostic = { callbacks: 0, bytes: 0, drops: {} }, diagnosticAnalyzer = null;
  function observeRawAudio(d) {
    if (!config || !config.diagnosticsRequested) return;
    pcmDiagnostic.callbacks++;
    pcmDiagnostic.bytes += d && d.data ? d.data.byteLength || 0 : 0;
    pcmDiagnostic.callbackReceivedAtMs = Date.now();
    pcmDiagnostic.nativePtsMs = d && d.pts;
    pcmDiagnostic.timelineMs = timeline && timeline.currentTime;
    pcmDiagnostic.generation = generation;
    pcmDiagnostic.trackId = api && api.getCurrentSong() && String(api.getCurrentSong().ncmId);
    if (!diagnosticAnalyzer && window.MineradioPcmAnalyzer) diagnosticAnalyzer = new window.MineradioPcmAnalyzer();
    var features = diagnosticAnalyzer && d && diagnosticAnalyzer.push(d.data, d.pts, Date.now());
    pcmDiagnostic.rawFeatures = features || null;
  }
  function discardAudio(reason) {
    if (config && config.diagnosticsRequested) pcmDiagnostic.drops[reason] = (pcmDiagnostic.drops[reason] || 0) + 1;
  }
  function onAudio(event) {
    var d = event && event.detail;
    observeRawAudio(d);
    if (!api || !config || !config.audioRequested) { discardAudio("not-requested"); return; }
    if (api.getPlaybackStatus() !== "Playing") { discardAudio("paused"); return; }
    onTrack(false);
    if (!timeline) { discardAudio("no-timeline"); return; }
    var timing = freshness.accept(d, { playing: true, confirmed: observedNativeTimeline,
      timelineAgeMs: Date.now() - timelineAt, positionMs: timeline.currentTime, monotonicMs: performance.now() });
    if (!timing.ok) { discardAudio(timing.reason); audioFrame = null; if (analyzer) analyzer.reset(); return; }
    if (!analyzer && window.MineradioPcmAnalyzer) analyzer = new window.MineradioPcmAnalyzer();
    var analysisStart = performance.now();
    if (analyzer) audioFrame = analyzer.push(d.data, d.pts, Date.now());
    if (audioFrame) {
      audioFrame.timingQuality = timing.quality;
      audioFrame.callbackReceivedAtMs = audioFrame.observedAtMs;
    }
    if (!audioFrame) discardAudio("invalid-buffer");
    counters.pcm++;
    counters.analysisMs += performance.now() - analysisStart;
    if (audioFrame) post("sample");
  }
  function syncAudioSubscription() {
    var wanted = !!(api && config && config.audioRequested && window.MineradioPcmAnalyzer);
    if (wanted && !audioBound) {
      bind("audioDataUpdate", onAudio);
      audioBound = true;
    } else if (!wanted && audioBound) {
      api.removeEventListener("audioDataUpdate", onAudio);
      bindings = bindings.filter(function(b){ return b[0] !== "audioDataUpdate"; });
      audioBound = false;
      audioFrame = null;
      if (analyzer) analyzer.reset();
    }
  }
  async function post(kind) {
    // A delayed CEF promise acknowledgement must not block newer real samples.
    // Bound outstanding requests by both count and monotonic age; never queue PCM.
    var monotonicNow = performance.now();
    requests.forEach(function (at, controller) {
      if (monotonicNow - at > 1800) { controller.abort(); requests.delete(controller); }
    });
    if (requests.size >= 24) { counters.busyDrops++; return; }
    if (!config || (!api && kind === "sample")) return;
    if (kind === "sample" && Date.now() - lastSendAt < 80) return;
    if (kind === "sample") onTrack(false);
    var song = api && api.getCurrentSong();
    if (kind === "sample" && !timeline)
      kind = "track";
    if (kind === "track" && (!song || !song.ncmId)) kind = "disconnect";
    if (kind === "sample" && (!song || !song.ncmId || !timeline || !timelineAt))
      return;
    var frame = {
      protocol: 1,
      source: "inflink-api",
      kind: kind,
      instance: instance,
      sequence: ++sequence,
      generation: Math.max(1, generation),
      sentAtMs: Date.now(),
      pluginVersion: api ? api.version : "3.4.0",
    };
    var reset = pendingReset, sentResetVersion = resetVersion;
    if (kind === "sample" && config.diagnosticsRequested && trace) {
      var sdk = api.getTimeline();
      frame.trace = Object.assign({}, trace, {
        sdkReadAtMs: Date.now(), sdkPositionMs: sdk.currentTime,
        counters: Object.assign({}, counters),
        pcm: JSON.parse(JSON.stringify(pcmDiagnostic))
      });
    }
    if (kind === "sample" && config.audioRequested && audioFrame && Date.now() - audioFrame.observedAtMs <= 500)
      frame.audio = Object.assign({}, audioFrame, { trackId: String(song.ncmId), generation: frame.generation });
    if (kind === "sample" || kind === "track")
      Object.assign(frame, {
        status: api.getPlaybackStatus(),
        positionMs: timeline ? timeline.currentTime : undefined,
        durationMs: timeline ? timeline.totalTime : undefined,
        timelineAtMs: timelineAt || undefined,
        timelineOrigin: timelineOrigin,
        track: {
          id: String(song.ncmId),
          title: song.songName || "",
          artist: song.authorName || "",
          album: song.albumName || "",
          trackId: String(song.trackId || song.ncmId),
        },
        reset: reset || undefined,
      });
    lastSendAt = Date.now();
    counters.sends++;
    var controller = new AbortController();
    requests.set(controller, performance.now());
    var timeout = setTimeout(function () {
      controller.abort();
    }, 1500);
    try {
      var response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + config.token,
        },
        body: JSON.stringify(frame),
        keepalive: kind === "disconnect",
        signal: controller.signal,
      });
      if (!response.ok) throw Error("bridge " + response.status);
      counters.lastAckMs = performance.now() - monotonicNow;
      counters.maxAckMs = Math.max(counters.maxAckMs, counters.lastAckMs);
      if (resetVersion === sentResetVersion) pendingReset = null;
    } catch (e) {
      console.warn("[MineradioBridge]", e.message);
    } finally {
      clearTimeout(timeout);
      requests.delete(controller);
    }
  }
  async function poll() {
      if (stop || polling) return;
      polling = true;
      lastPollAt = Date.now();
      try {
        var nextConfig = await readConfig();
        if (stop) return;
        if (nextConfig && (!config || config.runId !== nextConfig.runId)) {
          config = nextConfig;
          resetAudio();
          setReset("reconnect");
          if (api && api.getPlaybackStatus() === "Paused")
            onTimeline({ detail: api.getTimeline(), query: true });
        }
        if (!nextConfig) {
          config = null;
          syncAudioSubscription();
        }
        if (api && api !== window.InfLinkApi) {
          bindings.forEach(function (b) {
            api.removeEventListener(b[0], b[1]);
          });
          bindings = [];
          api = null;
          audioBound = false;
          audioFrame = null;
          timeline = null;
          timelineAt = 0;
          observedNativeTimeline = false;
          previous = null;
          generation++;
          setReset("reconnect");
        }
        if (!api) {
          api = window.InfLinkApi;
          if (!api) return;
          if (api.version !== "3.4.0") {
            console.error("[MineradioBridge] requires InfLink 3.4.0");
            api = null;
            return;
          }
          bind("songChange", onTrack);
          bind("rawTimelineUpdate", onTimeline);
          // 3.4.0's timelineUpdate is a throttled repeat of the same native
          // position. Do not re-date that repeat or manufacture backward seeks.
          bind("playStateChange", onState);
          onTrack(false);
          var initial = api.getTimeline();
          if (initial) onTimeline({ detail: initial, query: true });
        }
        syncAudioSubscription();
        post("sample");
      } finally {
        polling = false;
      }
  }
  function start(self) {
    pluginPath = self.pluginPath;
    timer = setInterval(poll, 250);
    void poll();
  }
  plugin.onLoad(start);
})();
