// The packaged Node process owns playback and settings. The Win32 process owns
// HWNDs, the tray, and WebView2. Messages travel only over the child process pipes.
const { EventEmitter } = require('node:events');
const { createInterface } = require('node:readline');
const path = require('node:path');

const input = createInterface({ input: process.stdin, terminal: false });
const windows = new Map();
const pending = new Map();
const shortcuts = new Map();
const methods = new Map();
const ipcMain = new EventEmitter();
ipcMain.handle = (channel, handler) => methods.set(channel, handler);
const overlayChannels = new Set([
  'mineradio-visibility-ready', 'mineradio-display-observation',
  'mineradio-desktop-lyrics-set-dragging', 'mineradio-desktop-lyrics-set-hot-bounds',
  'mineradio-desktop-lyrics-set-lock-state', 'mineradio-desktop-lyrics-set-enabled',
]);
const settingsChannels = new Set([
  'mineradio-settings-read', 'mineradio-settings-fonts',
  'mineradio-settings-preview', 'mineradio-settings-save',
]);

let nextCall = 0;
let nextWindow = 0;
let displays;
let ready;
let tray;
let restart;
const initialized = new Promise(resolve => { ready = resolve; });

function send(op, data = {}) {
  process.stdout.write(JSON.stringify({ op, ...data }) + '\n');
}

function call(op, data = {}) {
  const id = ++nextCall;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send(op, { ...data, id });
  });
}

function shutdown() {
  app.isQuitting = true;
  return Promise.all(app.listeners('before-quit').map(listener => listener()));
}

async function quit(code = 0) {
  if (app.isQuitting) return;
  const cleanup = shutdown();
  input.close();
  process.stdin.destroy();
  await cleanup;
  // Node can still have an online fetch in flight. Exit after flushing the
  // final pipe message, independently of outstanding background requests.
  process.stdout.write(JSON.stringify({ op: 'quit', code, restart }) + '\n', () => process.exit(code));
}

const paths = { appData: process.env.APPDATA, exe: process.env.MINERADIO_DESKTOP_EXE };
const app = Object.assign(new EventEmitter(), {
  isPackaged: true,
  getPath: name => paths[name],
  setPath: (name, value) => { paths[name] = value; },
  getAppPath: () => path.join(__dirname, '..'),
  whenReady: () => initialized,
  relaunch: ({ args }) => { restart = args; },
  quit: () => quit(),
  exit: quit,
  getAppMetrics: () => [{ pid: process.pid, type: 'Backend', memory: process.memoryUsage() }],
});

class BrowserWindow extends EventEmitter {
  constructor({ x, y, width, height, minWidth = 0, minHeight = 0, title, transparent }) {
    super();
    this.id = ++nextWindow;
    this.overlay = !!transparent;
    this.bounds = {
      x: x ?? Math.round(displays[0].x + (displays[0].width - width) / 2),
      y: y ?? Math.round(displays[0].y + (displays[0].height - height) / 2),
      width, height,
    };
    this.options = { minWidth, minHeight, title };
    this.webContents = Object.assign(new EventEmitter(), {
      send: (channel, ...args) => this.post({ channel, args }),
    });
    this.locked = false;
    windows.set(this.id, this);
  }

  async loadFile(file) {
    this.created = true;
    await call('load', {
      window: this.id, overlay: this.overlay,
      bounds: this.bounds, locked: this.locked, ...this.options,
      page: path.relative(app.getAppPath(), file).replaceAll('\\', '/'),
    });
    this.loaded = true;
  }

  post(data) { send('web-message', { window: this.id, data }); }
  getBounds() { return { ...this.bounds }; }
  isDestroyed() { return !windows.has(this.id); }
  show() { this.showInactive(); }
  showInactive() { if (this.loaded) send('show', { window: this.id }); }
  hide() { if (this.loaded) send('hide', { window: this.id }); }
  close() { send('close', { window: this.id }); }
  focus() { if (this.loaded) send('focus', { window: this.id }); }
  setIgnoreMouseEvents(locked) {
    this.locked = locked;
    if (this.created) send('locked', { window: this.id, locked });
  }
  setLyricHotBounds(bounds) { send('hot-bounds', { window: this.id, bounds }); }
  setLyricDragging(active) { send('dragging', { window: this.id, active }); }
}

const screen = {
  getPrimaryDisplay: () => ({ workArea: displays[0] }),
  getAllDisplays: () => displays.map(workArea => ({ workArea })),
};

const globalShortcut = {
  async register(accelerator, callback) {
    const key = accelerator.at(-1);
    const registered = await call('register-shortcut', { key });
    if (registered) shortcuts.set(key, callback);
    return registered;
  },
  isRegistered: accelerator => shortcuts.has(accelerator.at(-1)),
  unregisterAll: () => send('unregister-shortcuts'),
};

class Tray {
  constructor(icon) {
    this.actions = [];
    tray = this;
    send('tray', { icon });
  }
  setToolTip(text) { send('tooltip', { text }); }
  setContextMenu(items) {
    this.actions = items.map(item => item.click);
    send('menu', { items: items.map(({ label, enabled }) => ({ label, enabled: enabled !== false })) });
  }
}

const dialog = {
  showMessageBox: options => call('dialog', { options }),
  showOpenDialog: options => call('open-dialog', { options }),
  showErrorBox: (title, message) => send('error-box', { title, message }),
};
const shell = {
  openExternal: async target => {
    const error = await call('open', { target });
    if (error) throw Error(error);
  },
  openPath: target => call('open', { target }),
};

async function webMessage(window, { channel, args, requestId }) {
  const view = windows.get(window);
  if (!view || !(view.overlay ? overlayChannels : settingsChannels).has(channel)) return;
  const event = { sender: view.webContents };
  if (requestId === undefined) {
    ipcMain.emit(channel, event, ...args);
    return;
  }
  try {
    view.post({ requestId, value: await methods.get(channel)(event, ...args) });
  } catch (error) {
    view.post({ requestId, error: error.message });
  }
}

input.on('line', line => {
  const message = JSON.parse(line);
  const view = windows.get(message.window);
  switch (message.event) {
    case 'reply': {
      const response = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) response.reject(Error(message.error));
      else response.resolve(message.value);
      break;
    }
    case 'ready': displays = message.displays; ready(); break;
    case 'displays': displays = message.displays; break;
    case 'second-instance': app.emit('second-instance'); break;
    case 'quit': quit(); break;
    case 'shortcut': shortcuts.get(message.key)?.(); break;
    case 'menu': tray.actions[message.index]?.(); break;
    case 'middle-button': view.emit('middle-button'); break;
    case 'bounds': {
      const old = view.bounds;
      view.bounds = message.bounds;
      if (old.x !== view.bounds.x || old.y !== view.bounds.y) view.emit('move');
      if (old.width !== view.bounds.width || old.height !== view.bounds.height) view.emit('resize');
      break;
    }
    case 'closed': windows.delete(message.window); view.emit('closed'); break;
    case 'renderer-gone': view.webContents.emit('render-process-gone', null, message.detail); break;
    case 'web-message': void webMessage(message.window, message.data); break;
  }
});

input.on('close', () => {
  if (!app.isQuitting) void shutdown().then(() => process.exit(0));
});

module.exports = {
  app, BrowserWindow, ipcMain, screen, globalShortcut, Tray,
  Menu: { buildFromTemplate: items => items },
  dialog, shell,
  enumerateFonts: samples => call('system-fonts', { samples }),
  decodeCover: async bytes => Buffer.from(await call('decode-cover', { bytes: bytes.toString('base64') }), 'base64'),
};
