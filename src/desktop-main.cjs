// Packaged GUI entry: no shell launcher, no global Node/npm, durable diagnostics.
const {app, dialog} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const identity = require('../build/windows-app.json');
app.setName(identity.productName);
app.setAppUserModelId(identity.appId);
const directory = path.join(app.getPath('appData'), 'MineradioExternalLyrics', 'logs', 'desktop-'+new Date().toISOString().replace(/[:.]/g, '-')+'-'+process.pid);
fs.mkdirSync(directory, {recursive:true});
process.env.MINERADIO_LOG_DIR = directory;
app.commandLine.appendSwitch('enable-logging', 'file');
app.commandLine.appendSwitch('log-file', path.join(directory, 'chromium.log'));
for (const level of ['log','info','warn','error','debug']) {
  console[level] = (...values) => fs.appendFileSync(path.join(directory, level==='error'||level==='warn'?'stderr.log':'stdout.log'),
    new Date().toISOString()+' '+level+' '+util.format(...values)+'\n');
}
let failing = false;
function fail(error) {
  if (failing) return;
  failing = true;
  const detail = error?.stack || String(error);
  fs.appendFileSync(path.join(directory, 'startup-error.log'), detail+'\n');
  dialog.showErrorBox('Mineradio 桌面歌词启动失败', detail+'\n\n日志目录：'+directory);
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
try { require('./main.cjs'); } catch (error) { fail(error); }
