// Desktop-entry discovery only. Playback and the authenticated bridge stay in main.cjs.
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
function expandPath(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const expanded = value.replace(/%([^%]+)%/g, (match, name) => process.env[name] || match);
  return path.resolve(base, expanded);
}
function executable(file) { try { return !!file && fs.statSync(file).isFile() && path.basename(file).toLowerCase() === 'cloudmusic.exe'; } catch { return false; } }
function identity(file) { try { return fs.realpathSync.native(file).toLowerCase(); } catch { return path.resolve(file).toLowerCase(); } }
function resolveConfig(app) {
  const base = path.dirname(process.execPath);
  const argument = process.argv.find(value => value.startsWith('--desktop-config='));
  const file = argument ? expandPath(argument.slice('--desktop-config='.length), base) : path.join(base, 'desktop-launch.json');
  const userDirectory=path.join(app.getPath('appData'),'MineradioExternalLyrics');
  const userFile=path.join(userDirectory,'desktop-connection.json');
  const warnings=[];
  function read(file){
    if(!fs.existsSync(file))return {};
    try{const value=readJson(file);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('不是配置对象');return value;}
    catch(error){warnings.push('连接配置读取失败，原文件保留：'+file+'（'+error.message+'）');return {};}
  }
  const legacy=read(file),saved=read(userFile);
  // An explicit maintenance config still takes precedence; ordinary upgrades
  // use the independent user-data config without changing lyric preferences.
  const config=argument?legacy:{...legacy,...saved};
  const savedBase=!argument&&Object.prototype.hasOwnProperty.call(saved,'profile')?userDirectory:base;
  const explicitProfile=expandPath(config.profile,savedBase);
  const profileCandidates=[explicitProfile,path.resolve(base,'../betterncm'),path.join(path.parse(base).root,'betterncm'),'C:\\betterncm'].filter(Boolean);
  const selectedProfile=!argument&&saved.profile?explicitProfile:argument&&legacy.profile?explicitProfile:null;
  const profile=selectedProfile || profileCandidates.find(value=>fs.existsSync(path.join(value,'plugins_dev/MineradioBridge/index.js'))) ||
    profileCandidates.find(value=>fs.existsSync(value)) || expandPath(config.profile,savedBase) || null;
  const autoStartClientPreference=config.autoStartClient!==false;
  return {configFile:file,userConfigFile:userFile,userDirectory,profile,
    bridgeConfig:profile?path.join(profile,'plugins_dev/MineradioBridge/connection.json'):path.join(userDirectory,'runtime/pending-bridge/connection.json'),
    clientExecutable:expandPath(config.clientExecutable,!argument&&Object.prototype.hasOwnProperty.call(saved,'clientExecutable')?userDirectory:base),
    autoStartClientPreference,autoStartClient:autoStartClientPreference&&!process.argv.includes('--lyrics-only'),
    acknowledgedFingerprint:typeof config.acknowledgedFingerprint==='string'?config.acknowledgedFingerprint:'',warnings};
}
function windowsState() {
  const script = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$players=@(Get-CimInstance Win32_Process -Filter "Name='cloudmusic.exe'" | ForEach-Object {[pscustomobject]@{pid=$_.ProcessId;executable=$_.ExecutablePath}})
$installed=@(foreach($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\cloudmusic.exe','HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\cloudmusic.exe','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\cloudmusic.exe')){if(Test-Path -LiteralPath $key){$value=(Get-Item -LiteralPath $key).GetValue('');if($value){$value}}})
@{players=$players;installed=$installed}|ConvertTo-Json -Compress -Depth 4
`;
  return new Promise((resolve, reject) => execFile(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    {windowsHide:true, encoding:'utf8', timeout:10000, maxBuffer:256*1024}, (error, stdout, stderr) => {
      if (error) { error.message += stderr ? '\n'+stderr.trim() : ''; reject(error); return; }
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, ''))); } catch (error) { reject(error); }
    }));
}
async function ensureClient(config, {record, dialog, runDir}) {
  if (!config.autoStartClient) { record({type:'client-start-skipped', reason:config.setupStatus&&!config.setupStatus.filesReady?'connection-files-not-ready':'lyrics-only'}); return; }
  try {
    // Read once; an unknown/other installation is never killed or silently replaced.
    const state = await windowsState();
    const candidates = [config.clientExecutable, ...(state.installed || []),
      ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(value => path.join(value, 'NetEase/CloudMusic/cloudmusic.exe'))];
    const client = candidates.find(executable);
    const players = Array.isArray(state.players) ? state.players : [];
    if (players.length) {
      const matched = client && players.some(value => value.executable && identity(value.executable) === identity(client));
      record({type:'client-reused', configuredExecutable:client || null, identityConfirmed:!!matched, processes:players});
      if (client && players.some(value => value.executable && identity(value.executable) !== identity(client)))
        await dialog.showMessageBox({type:'info', title:'Mineradio 桌面歌词', message:'另一位置的网易云正在运行', detail:'歌词程序不会中断音乐或重复启动客户端。请自行从网易云托盘退出后，再打开配置好的原版客户端。'});
      return;
    }
    if (!client) throw Error('没有找到官方网易云客户端。请重新打开连接设置，选择实际的 cloudmusic.exe。');
    const stdout = fs.openSync(path.join(runDir, 'client.stdout.log'), 'a');
    let stderr;
    try {
      stderr = fs.openSync(path.join(runDir, 'client.stderr.log'), 'a');
      await new Promise((resolve, reject) => {
        const child = spawn(client, [], {cwd:path.dirname(client), windowsHide:true, detached:true, stdio:['ignore',stdout,stderr]});
        child.once('error', reject);
        child.once('spawn', () => {record({type:'client-started', executable:client, pid:child.pid});child.unref();resolve();});
      });
    } finally { fs.closeSync(stdout); if (stderr !== undefined) fs.closeSync(stderr); }
  } catch (error) {
    record({type:'client-start-error', error:error.stack || error.message});
    await dialog.showMessageBox({type:'warning', title:'Mineradio 桌面歌词', message:'未能自动连接或启动网易云', detail:error.message+'\n\n可以手动打开原版网易云，歌词程序将继续等待连接。日志：'+runDir});
  }
}
async function prepare(config,context){
  return require('./desktop-setup.cjs').prepare(config,{...context,powershell,windowsState,executable});
}
module.exports = {powershell, resolveConfig, prepare, ensureClient};
