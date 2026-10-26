const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { adaptFrame } = require("./inflink-adapter.cjs");
async function startBridge({
  onSample,
  onEvent = () => {},
  configPath,
  now = () => Date.now(),
  staleMs = 2500,
  enableAudio = false,
  diagnostics = false,
}) {
  const token = crypto.randomBytes(32).toString("hex");
  const runId = crypto.randomUUID();
  let owner = null,
    lastAt = 0,
    connected = false,
    windowAt = 0,
    count = 0;
  const cursors = new Map();
  const origins = new Set(["orpheus://orpheus", "null"]);
  const server = http.createServer(async (req, res) => {
    const fail = (code, reason) => {
      onEvent({ type: "bridge-rejected", code, reason });
      res.writeHead(code);
      res.end(reason);
    };
    if (
      req.socket.remoteAddress !== "127.0.0.1" ||
      req.headers.host !== `127.0.0.1:${server.address().port}`
    )
      return fail(403, "loopback host");
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return fail(403, "origin");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Cache-Control", "no-store");
    if (req.url !== "/v1/state") return fail(404, "path");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      res.writeHead(204);
      return res.end();
    }
    const given = Buffer.from(String(req.headers.authorization || ""));
    const wanted = Buffer.from(`Bearer ${token}`);
    if (
      given.length !== wanted.length ||
      !crypto.timingSafeEqual(given, wanted)
    )
      return fail(401, "authentication");
    if (
      req.method !== "POST" ||
      !/^application\/json(?:;|$)/.test(req.headers["content-type"] || "")
    )
      return fail(415, "JSON POST required");
    if (now() - windowAt >= 1000) {
      windowAt = now();
      count = 0;
    }
    if (++count > 30) return fail(429, "rate");
    let bytes = 0,
      chunks = [];
    try {
      for await (const b of req) {
        bytes += b.length;
        if (bytes > 16384) {
          fail(413, "size");
          return;
        }
        chunks.push(b);
      }
      const frame = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const sample = adaptFrame(frame, { runId, receivedAtMs: now() });
      if (owner && owner !== frame.instance && connected)
        return fail(409, "producer already connected");
      const previous = cursors.get(frame.instance);
      if (
        previous &&
        (frame.sequence <= previous.sequence ||
          frame.generation < previous.generation)
      )
        return fail(409, "replayed or regressed frame");
      if (
        previous &&
        frame.generation === previous.generation &&
        sample.track &&
        previous.id &&
        previous.id !== sample.track.id
      )
        return fail(409, "track generation not advanced");
      cursors.set(frame.instance, {
        sequence: frame.sequence,
        generation: frame.generation,
        id: sample.track?.id || previous?.id,
      });
      if (cursors.size > 32) cursors.delete(cursors.keys().next().value);
      owner = frame.instance;
      lastAt = now();
      connected = sample.connected;
      onSample(sample);
      onEvent({
        type: "bridge-accepted",
        instance: frame.instance,
        sequence: frame.sequence,
        generation: frame.generation,
      });
      res.writeHead(204);
      res.end();
    } catch (e) {
      if (!res.headersSent) fail(400, e.message);
    }
  });
  server.requestTimeout = 3000;
  server.headersTimeout = 3000;
  server.maxConnections = 8;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const config = {
    protocol: 1,
    audioRequested: !!enableAudio,
    diagnosticsRequested: !!diagnostics,
    runId,
    endpoint: `http://127.0.0.1:${server.address().port}/v1/state`,
    token,
  };
  if (configPath) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  }
  const watchdog = setInterval(() => {
    if (connected && now() - lastAt > staleMs) {
      connected = false;
      onSample({
        source: "inflink-api",
        sessionId: `inflink:${runId}:${owner}`,
        connected: false,
        sampledAtMs: now(),
      });
      onEvent({ type: "bridge-timeout" });
    }
  }, 100);
  return {
    config,
    async close() {
      clearInterval(watchdog);
      if (connected)
        onSample({
          source: "inflink-api",
          connected: false,
          sampledAtMs: now(),
        });
      connected = false;
      if (configPath && fs.existsSync(configPath)) {
        try {
          if (JSON.parse(fs.readFileSync(configPath, "utf8")).runId === runId)
            fs.unlinkSync(configPath);
        } catch {}
      }
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
module.exports = { startBridge };
