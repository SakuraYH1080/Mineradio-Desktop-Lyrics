const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
  Menu,
  Tray,
  nativeImage,
  dialog,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Timeline, trackKey } = require("./timeline.cjs");
const { Lyrics, parse, locate, online } = require("./lyrics.cjs");
const { motion } = require("./rhythm.cjs");
const { demoSample, demoLyrics } = require("./replay.cjs");
const preferences = require('./preferences.cjs');
const systemFonts = require('./system-fonts.cjs');
const { CoverPalette, fromHex } = require('./palette.cjs');
const { Visibility } = require('./visibility.cjs');
const { dragTarget } = require('./drag.cjs');
const root = path.join(__dirname, "..");
const demo = process.argv.includes("--demo");
const capture = process.argv.includes("--capture");
const frameRateArg = process.argv.find(a => a.startsWith("--frame-rate="));
const frameRate = frameRateArg ? Number(frameRateArg.split("=")[1]) : 60;
if (![24,30,60,120].includes(frameRate)) throw Error("Unsupported frame rate");
const sourceArg = process.argv.find((a) => a.startsWith("--source="));
const source = demo ? "replay" : sourceArg ? sourceArg.split("=")[1] : "gsmtc";
const enableAudio = !demo && process.argv.includes("--audio=inflink-pcm");
const diagnostics = process.argv.includes("--stability-audit");
let wireSequence = 0;
if (enableAudio && source !== "inflink-api") throw Error("PCM audio requires explicit InfLink API source");
if (
  !["gsmtc", "gsmtc-inflink", "inflink-api", "replay"].includes(source) ||
  (!demo && source === "replay")
)
  throw Error("Unsupported source");
const phase2 =
  source !== "gsmtc" ||
  process.argv.includes("--highlight-qa") ||
  process.argv.includes("--phase2");
const runDir =
  process.env.MINERADIO_LOG_DIR ||
  path.join(root, "logs", ...(phase2 ? ["phase2"] : []));
// Isolate Electron data from original Mineradio and NetEase user data.
app.setPath(
  "userData",
  path.join(
    root,
    ".runtime",
    process.argv.includes("--interaction-qa") ||
      process.argv.includes("--renderer-qa")
      ? "qa"
      : capture
        ? "capture"
        : demo
          ? "demo"
          : "live",
  ),
);
if (!demo && !process.argv.includes("--bridge-qa") && !app.requestSingleInstanceLock()) app.exit(0);
let win, probe, poller, timer, metrics, tray;
let settingsWindow;
let visibility, visibilityRegistered=false;
const visibilityWaiters=new Map();
app.on('second-instance',()=>{if(visibility)void visibility.set(true,'launch').catch(e=>record({type:'visibility-error',error:e.message}));});
const legacySettingsPath = path.join(app.getPath('userData'), 'lyrics-settings.json');
const settingsPath = demo || capture ? legacySettingsPath : path.join(app.getPath('appData'), 'MineradioExternalLyrics', 'lyrics-settings.json');
let settings = preferences.load(fs.existsSync(settingsPath) ? settingsPath : legacySettingsPath);
let lyricFontFamily=systemFonts.cssFamily(settings.fontFamily);
let hot = null,
  pointer = false,
  locked = true;
let lastMiddle = 0;
let wire = {};
let buffer = "";
let localKey = null;
let dragResidual = { x: 0, y: 0 };
let overlayDimensions;
let dragAnchor=null;
fs.mkdirSync(runDir, { recursive: true });
const log = fs.createWriteStream(
  path.join(runDir, `overlay-${demo ? "demo" : "live"}-${Date.now()}.ndjson`),
);
function record(v) {
  log.write(
    JSON.stringify({
      atMs: Date.now(),
      provenance: demo
        ? "fixture"
        : process.argv.includes("--bridge-qa")
          ? "authenticated-protocol-replay-not-real-client"
          : "live-source",
      ...v,
    }) + "\n",
  );
}
const timeline = new Timeline({ allowedSource: source });
const palette = new CoverPalette({record,decode:bytes=>{
  const image=nativeImage.createFromBuffer(bytes);
  if(image.isEmpty()) throw Error('Invalid cover image');
  return image.resize({width:64,height:64,quality:'good'}).toBitmap();
}});
let bridge = null;
const bindingsPath = path.join(root, "lyrics-bindings.json");
const bindings = fs.existsSync(bindingsPath)
  ? JSON.parse(fs.readFileSync(bindingsPath, "utf8"))
  : {};
const lrcArg = process.argv.indexOf("--lrc");
const localFile = lrcArg >= 0 ? path.resolve(process.argv[lrcArg + 1]) : null;
const lyrics = new Lyrics(async (track, duration) => {
  if (process.argv.includes("--bridge-qa"))
    return {
      ...parse({
        yrc: fs.readFileSync(
          path.join(root, "fixtures/phase2-highlight.yrc"),
          "utf8",
        ),
      }),
      status: "BRIDGE QA FIXTURE",
      source: "test-only",
    };
  if (demo) return demoLyrics(track, parse);
  if (localFile && localKey === null) localKey = trackKey(track);
  const binding = bindings[track.id] || bindings[trackKey(track)];
  const file =
    binding?.file || (localKey === trackKey(track) ? localFile : null);
  if (file) {
    const parsed = parse({
      lyric: fs.readFileSync(path.resolve(root, file), "utf8"),
    });
    return {
      ...parsed,
      status: parsed.usableLyric ? "本地 LRC · 手动绑定" : "无歌词 / 纯音乐",
      source: "local-binding",
    };
  }
  return online(binding?.id ? { ...track, id: binding.id } : track, duration);
});
function send() {
  if (win && !win.isDestroyed() && (!visibility || visibility.visible))
    win.webContents.send("mineradio-desktop-lyrics-state", wire);
}
function mouse() {
  if (win && !win.isDestroyed())
    // Unlock is a positioning mode. Hover forwarding must not remove native
    // mouse capture before a pointer-down reaches the renderer.
    win.setIgnoreMouseEvents(locked, { forward: true });
}
function setLock(value) {
  locked = value;
  if(locked)dragAnchor=null;
  pointer = !locked;
  wire.clickThrough = locked;
  mouse();
  send();
  record({ type: "lock", locked });
}
function receive(s) {
  const events = timeline.accept(s);
  record({ type: "source", sample: s, events });
  const state = timeline.snapshot();
  if (state.track) {
    const key = trackKey(state.track);
    const fetchNeeded =
      key !== lyrics.key || (!(lyrics.duration > 0) && state.duration > 0);
    const requestedGeneration = state.key;
    const pending = lyrics.change(state.track, state.duration);
    if (fetchNeeded)
      void pending.then(() => {
        if (timeline.snapshot().key === requestedGeneration)
          record({
            type: "lyrics-ready",
            trackId: state.track.id,
            trackGeneration: requestedGeneration,
            source: lyrics.value.source,
            status: lyrics.value.status,
            match: lyrics.value.match,
            timingSource: lyrics.value.timingSource,
            lineCount: lyrics.value.lines?.length || 0,
            error: lyrics.value.error,
          });
      });
  }
}
function tick() {
  const s = timeline.snapshot();
  void palette.change(s.track, settings);
  const statusCaption = preferences.presentation(s, lyrics.value, settings);
  const lyric = statusCaption ? {text:statusCaption.text, progress:0, highlightFollow:false}
    : s.usable
    ? locate(lyrics.value, s.position)
    : {
        text: s.connected
          ? "网易云时间轴不可用 · 等待有效进度"
          : "等待网易云连接",
        progress: 0,
        highlightFollow: false,
      };
  wire = {
    enabled: !statusCaption || !!statusCaption.text,
    opacity: 0.96,
    size: 1,
    cinema: true,
    frameRate,
    colors: palette.current(),
    fontFamily: lyricFontFamily,
    clickThrough: locked,
    lyricGlowParticles: true,
    ...lyric,
    progressResetSerial: s.resetSerial,
    visibilityResetSerial: visibility?.serial || 0,
    progressResetReason: s.resetReason,
    trackGeneration: s.key,
    playing: s.playing,
    playback: { time: s.position, duration: s.duration, rate: 1 },
    motion: motion({ demo, playing: s.playing, time: s.position, audio: enableAudio ? timeline.sample?.audio : null }),
    allowSyntheticBeat: demo,
    beatMap: null,
    beatMapKey: "none",
    diagnostic: diagnostics ? {
      wire: ++wireSequence, mainAtMs: Date.now(),
      positionMs: s.position * 1000, playing: s.playing, usable: s.usable,
      durationMs: s.duration * 1000,
      track: s.track?.id, reset: s.resetSerial,
      sourceSequence: timeline.sample?.sequence,
      receivedAtMs: timeline.sample?.sampledAtMs,
      sourceAtMs: timeline.sample?.updatedAtMs,
      sourcePositionMs: (timeline.sample?.positionSec || 0) * 1000,
      sentAtMs: timeline.sample?.sentAtMs,
      trace: timeline.sample?.trace,
      expectedText: lyric.text, expectedProgress: lyric.progress,
      captionKind: statusCaption?.kind || 'lyrics', colors: palette.current(),
    } : undefined,
  };
  send();
}
function attachProbe() {
  probe = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "tools/probe.ps1"),
      "-Seconds",
      "0",
      "-SourceMode",
      source === "gsmtc-inflink" ? "inflink" : "native",
    ],
    { windowsHide: true },
  );
  probe.stdout.on("data", (b) => {
    buffer += b.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines)
      try {
        receive(JSON.parse(line));
      } catch (e) {
        record({ type: "probe-parse-error", error: e.message });
      }
  });
  probe.stderr.on("data", (b) =>
    record({ type: "probe-stderr", text: b.toString() }),
  );
  probe.on("error", (e) => record({ type: "probe-error", error: e.message }));
  probe.on("exit", (code) => {
    record({ type: "probe-exit", code });
    timeline.reset();
    if (!app.isQuitting) setTimeout(attachProbe, 2000);
  });
}
function middlePoll() {
  poller = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "tools/mouse-poll.ps1"),
    ],
    { windowsHide: true },
  );
  let pending = "";
  poller.stdout.on("data", (b) => {
    pending += b.toString();
    let lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) {
      if(line.startsWith('HUP ')){visibility?.released(Number(line.slice(4)));continue;}
      if(visibility && !visibility.visible)continue;
      if (line !== "MMB" || Date.now() - lastMiddle < 260) continue;
      const p = screen.getCursorScreenPoint(),
        bounds = win.getBounds();
      const h = hot || {
        left: 0,
        top: 0,
        right: bounds.width,
        bottom: bounds.height,
      };
      if (
        p.x >= bounds.x + h.left &&
        p.x <= bounds.x + h.right &&
        p.y >= bounds.y + h.top &&
        p.y <= bounds.y + h.bottom
      ) {
        lastMiddle = Date.now();
        setLock(!locked);
      }
    }
  });
  poller.on("error", (e) =>
    record({ type: "mouse-poller-error", error: e.message }),
  );
}
const channel = "mineradio-desktop-lyrics-";
function openSettings(){
  if(settingsWindow&&!settingsWindow.isDestroyed()){settingsWindow.show();settingsWindow.focus();return}
  const area=screen.getPrimaryDisplay().workArea;
  settingsWindow=new BrowserWindow({width:Math.min(980,area.width-40),height:Math.min(870,area.height-40),minWidth:420,minHeight:560,title:'Mineradio · 歌词设置',autoHideMenuBar:true,backgroundColor:'#E8E1F4',webPreferences:{preload:path.join(root,'src/settings-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  settingsWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  settingsWindow.webContents.on('will-navigate',e=>e.preventDefault());
  settingsWindow.loadFile(path.join(root,'public/settings.html'));
  settingsWindow.on('closed',()=>{settingsWindow=null;});
}
function refreshTray(){
  if(!tray)return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:demo?'测试回放模式':`网易云 ${source} 模式`,enabled:false},
    {id:'visibility',label:visibility?.visible?'隐藏桌面歌词':'显示桌面歌词',accelerator:visibilityRegistered?'Control+Alt+H':undefined,registerAccelerator:false,click:()=>void visibility.toggle('tray').catch(e=>record({type:'visibility-error',error:e.message}))},
    {label:'锁定 / 解锁（Ctrl+Alt+L）',click:()=>setLock(!locked)},
    {label:'歌词设置',click:openSettings},
    {label:'重试当前歌词',click:()=>{const s=timeline.snapshot();if(s.track)void lyrics.change(s.track,s.duration,true);}},
    {label:'退出',click:()=>app.quit()}
  ]));
}
ipcMain.on('mineradio-visibility-ready',(event,serial,observed)=>{
  if(event.sender!==win?.webContents)return;
  const ready=visibilityWaiters.get(serial);
  if(ready){record({type:'visibility-ready',serial,observed,expected:ready.expected});ready();}
});
function settingsSender(event){if(event.sender!==settingsWindow?.webContents)throw Error('Settings window required')}
ipcMain.handle('mineradio-settings-read',event=>{settingsSender(event);return {settings,defaults:preferences.defaults,colors:palette.current(),track:timeline.snapshot().track}});
ipcMain.handle('mineradio-settings-fonts',async event=>{settingsSender(event);const rows=await systemFonts.listFonts();lyricFontFamily=systemFonts.cssFamily(settings.fontFamily);tick();return rows;});
ipcMain.handle('mineradio-settings-preview',(event,value)=>{settingsSender(event);const p=preferences.normalize(value);return {...(p.colorMode==='fixed'?fromHex(p.fixedColor):palette.current()),fontFamily:systemFonts.cssFamily(p.fontFamily),fontWeight:900}});
ipcMain.handle('mineradio-settings-save',(event,value)=>{
  settingsSender(event);
  const previous=settings;
  settings=preferences.save(settingsPath,value);
  record({type:'settings-saved',settings});
  // The panel title is local presentation; saving it alone does not refresh lyrics.
  if(previous.fontFamily!==settings.fontFamily || previous.colorMode!==settings.colorMode || previous.fixedColor!==settings.fixedColor || JSON.stringify(previous.captions)!==JSON.stringify(settings.captions)){
    lyricFontFamily=systemFonts.cssFamily(settings.fontFamily);tick();
  }
  return settings;
});
ipcMain.on("mineradio-display-observation", (event, payload) => {
  if (!diagnostics || event.sender !== win?.webContents || !payload || !Number.isFinite(payload.atMs)) return;
  record({type: "stability-display", ...payload, mainReceivedAtMs: Date.now()});
});
ipcMain.handle(channel + "set-dragging", (event,active) => {
  if(event.sender!==win?.webContents)return {ok:false};
  dragAnchor=active&&!locked?{cursor:screen.getCursorScreenPoint(),bounds:win.getBounds(),ink:hot?{...hot}:null}:null;
  return {ok:true};
});
ipcMain.handle(channel + "set-pointer-capture", (_e, v) => {
  pointer = !!v && !locked;
  mouse();
  return { ok: true };
});
ipcMain.handle(channel + "set-hot-bounds", (_e, b) => {
  if (["left", "top", "right", "bottom"].every((k) => Number.isFinite(b[k])))
    hot = b;
  return { ok: true };
});
ipcMain.handle(channel + "set-lock-state", (_e, v) => {
  setLock(!!v);
  return { ok: true };
});
ipcMain.handle(channel + "move-by", (_e, dx, dy) => {
  if (locked || !dragAnchor || !Number.isFinite(dx) || !Number.isFinite(dy))
    return { ok: false };
  const b = win.getBounds();
  const cursor=screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const area = display.workArea;
  const ink=dragAnchor.ink||{left:0,top:0,right:b.width,bottom:b.height};
  const target=dragTarget(dragAnchor,cursor,area,ink);
  // setPosition repeatedly rounds the size up on fractional DPI in Electron.
  // Preserve the content size explicitly instead of reapplying rounded bounds.
  win.setBounds({ ...target, ...overlayDimensions });
  record({ type: "drag", dx, dy, cursor, anchor:dragAnchor, before: b, after: win.getBounds() });
  return { ok: true };
});
ipcMain.handle(channel + "set-enabled", () => {
  app.quit();
  return { ok: true };
});
app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(area.width - 40, 1200),
    height = Math.min(area.height - 40, 400);
  overlayDimensions = { width, height };
  win = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height * 0.68 - height / 2),
    title: "Mineradio External Lyrics",
    transparent: true,
    frame: false,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(root, "vendor/overlay-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  visibility=new Visibility({
    hide:()=>{dragAnchor=null;win.hide();},
    prepare:serial=>new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{visibilityWaiters.delete(serial);reject(Error('歌词窗口未及时回应显隐请求'));},1500);
      const ready=()=>{clearTimeout(timeout);visibilityWaiters.delete(serial);resolve();};
      visibilityWaiters.set(serial,ready);
      tick();
      ready.expected={text:wire.text,progress:wire.progress,track:timeline.snapshot().track?.id};
    }),
    show:()=>{mouse();win.showInactive();record({type:'visibility-shown',serial:visibility.serial,bounds:win.getBounds(),locked});},
    changed:(visible,reason,serial)=>{refreshTray();record({type:'visibility',visible,reason,serial,bounds:win.getBounds(),locked});}
  });
  mouse();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("console-message", (_e, ...args) =>
    record({ type: "renderer-console", args: args.map(String) }),
  );
  win.webContents.on("render-process-gone", (_e, details) =>
    record({ type: "renderer-gone", details }),
  );
  await win.loadFile(path.join(root, "vendor/desktop-lyrics.html"));
  await visibility.set(true,'startup');
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  );
  tray = new Tray(icon);
  tray.setToolTip("Mineradio 外部歌词");
  visibilityRegistered=globalShortcut.register('Control+Alt+H',()=>{void visibility.shortcut()?.catch(e=>record({type:'visibility-error',error:e.message}));});
  visibilityRegistered=visibilityRegistered&&globalShortcut.isRegistered('Control+Alt+H');
  record({type:'visibility-shortcut',accelerator:'Control+Alt+H',registered:visibilityRegistered});
  refreshTray();
  if(!visibilityRegistered)void dialog.showMessageBox({type:'warning',title:'歌词快捷键不可用',message:'Ctrl+Alt+H 注册失败',detail:'该组合键可能已被其他程序占用。请使用 Mineradio 托盘中的“隐藏桌面歌词／显示桌面歌词”。音乐连接不受影响。'});
  globalShortcut.register("Control+Alt+L", () => setLock(!locked));
  globalShortcut.register("Control+Alt+S", openSettings);
  globalShortcut.register("Control+Alt+Q", () => app.quit());
  middlePoll();
  const started = performance.now();
  if (demo) {
    receive(demoSample(0));
    if (!process.argv.includes("--renderer-qa"))
      setInterval(
        () => receive(demoSample((performance.now() - started) / 1000)),
        250,
      ).unref();
  } else if (source === "inflink-api") {
    const configArg = process.argv.find((a) =>
      a.startsWith("--bridge-config="),
    );
    const configPath = configArg
      ? path.resolve(configArg.slice("--bridge-config=".length))
      : path.join(root, ".runtime/phase2/bridge-session.json");
    bridge = await require("./bridge-server.cjs").startBridge({
      onSample: receive,
      onEvent: record,
      configPath,
      enableAudio,
      diagnostics,
    });
    record({
      type: "bridge-ready",
      configPath,
      runId: bridge.config.runId,
      port: new URL(bridge.config.endpoint).port,
    });
  } else attachProbe();
  timer = setInterval(tick, 33);
  metrics = setInterval(
    () =>
      record({
        type: "metrics",
        processes: app.getAppMetrics(),
        timeline: timeline.snapshot(),
        lyricStatus: lyrics.value.status,
        lyricMatch: lyrics.value.match,
      }),
    5000,
  );
  tick();
  if (process.argv.includes("--live-audit")) {
    let auditBusy = false;
    const auditSeconds = Number(process.argv.find(a=>a.startsWith("--live-audit-seconds="))?.split("=")[1] || 180);
    if (!Number.isInteger(auditSeconds) || auditSeconds < 5 || auditSeconds > 1800) throw Error("Invalid bounded audit duration");
    const auditUntil = Date.now() + auditSeconds * 1000;
    let lastAuditReset = null, auditScreenshots = 0;
    const auditTimer = setInterval(async () => {
      if (Date.now() > auditUntil || !win || win.isDestroyed()) {
        clearInterval(auditTimer);
        return;
      }
      if (auditBusy) return;
      auditBusy = true;
      try {
        const expected = { text: wire.text, progress: wire.progress, playing: wire.playing, resetSerial: wire.progressResetSerial, motion: wire.motion, synthetic: wire.allowSyntheticBeat };
        const visible = await win.webContents.executeJavaScript(`(() => {const e=document.querySelector('.line');return {text:e?.textContent,progress:getComputedStyle(document.documentElement).getPropertyValue('--lyric-progress'),background:e?getComputedStyle(e).backgroundImage:null,bodyClass:document.body.className,stageTransform:document.getElementById('stage')?.style.transform,beatGlow:getComputedStyle(document.documentElement).getPropertyValue('--lyric-css-beat-glow')};})()`);
        record({ type: "live-display-audit", expected, visible, timeline: timeline.snapshot() });
        if (lastAuditReset !== expected.resetSerial && auditScreenshots < 12) {
          const file = `actual-overlay-${Date.now()}-${auditScreenshots++}.png`;
          fs.writeFileSync(path.join(runDir, file), (await win.webContents.capturePage()).toPNG());
          record({type:"live-display-capture",file,expected,visible});
          lastAuditReset = expected.resetSerial;
        }
      } catch (error) { record({ type: "live-display-audit-error", error: String(error) }); }
      finally { auditBusy = false; }
    }, 250);
    app.once("before-quit", () => clearInterval(auditTimer));
  }
  record({
    type: "ready",
    demo,
    bounds: win.getBounds(),
    source,
    frameRate,
    audio: enableAudio ? "inflink-pcm-local-analysis" : "disabled",
  });
  const durationArg = process.argv.find((a) => a.startsWith("--duration="));
  if (durationArg) {
    const seconds = Number(durationArg.split("=")[1]);
    if (seconds > 0) setTimeout(() => app.quit(), seconds * 1000);
  }
  if (process.argv.includes("--interaction-qa")) {
    const results = await require("./interaction-qa.cjs")({
      win,
      isLocked: () => locked,
      setLock,
      record,
      root,
      setDimensions: (value) => (overlayDimensions = value),
    });
    app.isQuitting = true;
    clearInterval(timer);
    clearInterval(metrics);
    probe?.kill();
    poller?.kill();
    globalShortcut.unregisterAll();
    log.end(() => app.exit(results.some((r) => !r.pass) ? 1 : 0));
  }
  if (process.argv.includes("--renderer-qa")) {
    const results = await require("./renderer-qa.cjs")({
      win,
      receive,
      root,
      record,
    });
    app.isQuitting = true;
    clearInterval(timer);
    clearInterval(metrics);
    probe?.kill();
    poller?.kill();
    globalShortcut.unregisterAll();
    log.end(() => app.exit(results.some((r) => !r.pass) ? 1 : 0));
  }
  if (process.argv.includes("--highlight-qa")) {
    clearInterval(timer);
    const results = await require("./highlight-qa.cjs")({ win, root, runDir });
    app.isQuitting = true;
    clearInterval(timer);
    clearInterval(metrics);
    poller?.kill();
    globalShortcut.unregisterAll();
    log.end(() => app.exit(results.some((r) => !r.pass) ? 1 : 0));
  }
  if (process.argv.includes("--bridge-qa")) {
    if (!bridge) throw Error("--bridge-qa requires --source=inflink-api");
    const results = await require("./bridge-renderer-qa.cjs")({
      win,
      config: bridge.config,
      runDir,
    });
    await bridge.close();
    bridge = null;
    app.isQuitting = true;
    clearInterval(timer);
    clearInterval(metrics);
    poller?.kill();
    globalShortcut.unregisterAll();
    log.end(() => app.exit(results.some((r) => !r.pass) ? 1 : 0));
  }
  if (capture) {
    // Screenshots are the actual reused renderer, with explicit QA backgrounds.
    for (const [name, color] of [
      ["black", "#000"],
      ["white", "#fff"],
    ]) {
      await win.webContents.executeJavaScript(
        `document.documentElement.style.background=${JSON.stringify(color)}`,
      );
      await new Promise((r) => setTimeout(r, 1200));
      fs.writeFileSync(
        path.join(runDir, `demo-${name}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    await win.webContents.executeJavaScript(
      "document.documentElement.style.background='transparent'",
    );
    const audit = await win.webContents.executeJavaScript(
      "({text:document.querySelector('.line').textContent,bodyClass:document.body.className,background:getComputedStyle(document.documentElement).backgroundColor,errors:0})",
    );
    record({ type: "capture-audit", audit });
    app.quit();
  }
});
app.on("before-quit", () => {
  app.isQuitting = true;
  clearInterval(timer);
  clearInterval(metrics);
  probe?.kill();
  void bridge?.close();
  poller?.kill();
  globalShortcut.unregisterAll();
  log.end();
});
app.on("window-all-closed", () => app.quit());
