// Packaged entry started by MineradioLyrics.exe. Stdout is the WebView2 protocol.
const fs = require('node:fs');
const path = require('node:path');
const { format } = require('node:util');
const { app, dialog } = require('./webview-host.cjs');

const directory = process.env.MINERADIO_LOG_DIR ||
  path.join(app.getPath('appData'), 'MineradioExternalLyrics', 'logs');
fs.mkdirSync(directory, { recursive: true });
process.env.MINERADIO_LOG_DIR = directory;

const consoleFile = path.join(directory, 'desktop-console.log');
fs.writeFileSync(consoleFile, '');
let logged = 0;
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...values) => {
    if (logged >= 1024 * 1024) return;
    const line = new Date().toISOString() + ' ' + level + ' ' + format(...values) + '\n';
    fs.appendFileSync(consoleFile, line);
    logged += Buffer.byteLength(line);
  };
}

function fail(error) {
  const detail = error?.stack || String(error);
  fs.writeFileSync(path.join(directory, 'startup-error.log'), detail + '\n');
  dialog.showErrorBox('Mineradio 桌面歌词启动失败', detail + '\n\n日志目录：' + directory);
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
try { require('./main.cjs'); } catch (error) { fail(error); }
