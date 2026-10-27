// First-use connection guidance. Checks are read-only; the explicit Bridge
// action deploys only our five bundled files, never third-party loaders/plugins.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {execFile}=require('node:child_process');
const KNOWN_LOADER='a7c77af418d7940e63faa58ea036fba1f4baad497947109ea52ed78c8e86608f';
const BRIDGE_FILES=['manifest.json','index.js','header-compat.js','pcm-freshness.js','pcm-analyzer.js'];
function exists(file){try{return fs.statSync(file).isFile();}catch{return false;}}
function json(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function architecture(file){
  let descriptor;
  try{
    descriptor=fs.openSync(file,'r');const dos=Buffer.alloc(64);fs.readSync(descriptor,dos,0,64,0);
    const offset=dos.readUInt32LE(60);if(dos.readUInt16LE(0)!==0x5a4d||offset>1024*1024)return '未知';
    const pe=Buffer.alloc(6);fs.readSync(descriptor,pe,0,6,offset);if(pe.readUInt32LE(0)!==0x4550)return '未知';
    return ({0x8664:'x64',0x14c:'x86',0xaa64:'ARM64'})[pe.readUInt16LE(4)]||'未知';
  }catch{return '未知';}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
}
function fileVersion(file,powershell){
  const encoded=Buffer.from(file,'utf16le').toString('base64');
  const script='[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String("'+encoded+'"));[Diagnostics.FileVersionInfo]::GetVersionInfo($p).FileVersion';
  return new Promise(resolve=>execFile(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {windowsHide:true,encoding:'utf8',timeout:5000,maxBuffer:16384},(error,stdout)=>resolve(error?'未能读取':stdout.replace(/^\uFEFF/,'').trim()||'未知')));
}
function archiveManifest(file){
  // Read only the small manifest from an existing BetterNCM .plugin ZIP. No
  // extraction, native-library loading or dependency execution is involved.
  if(fs.statSync(file).size>32*1024*1024)return null;
  const data=fs.readFileSync(file);let end=-1;
  for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)return null;
  let cursor=data.readUInt32LE(end+16),count=data.readUInt16LE(end+10);
  for(let n=0;n<count&&cursor+46<=data.length;n++){
    if(data.readUInt32LE(cursor)!==0x02014b50)return null;
    const flags=data.readUInt16LE(cursor+8),method=data.readUInt16LE(cursor+10),size=data.readUInt32LE(cursor+20),plain=data.readUInt32LE(cursor+24);
    const length=data.readUInt16LE(cursor+28),extra=data.readUInt16LE(cursor+30),comment=data.readUInt16LE(cursor+32),local=data.readUInt32LE(cursor+42);
    const name=data.toString('utf8',cursor+46,cursor+46+length).replace(/\\/g,'/');cursor+=46+length+extra+comment;
    if(!/(^|\/)manifest\.json$/i.test(name)||plain>262144||flags&1)continue;
    if(local+30>data.length||data.readUInt32LE(local)!==0x04034b50)return null;
    const start=local+30+data.readUInt16LE(local+26)+data.readUInt16LE(local+28);if(start+size>data.length)return null;
    const packed=data.subarray(start,start+size),body=method===0?packed:method===8?zlib.inflateRawSync(packed,{maxOutputLength:262144}):null;
    return body?JSON.parse(body.toString('utf8').replace(/^\uFEFF/,'')):null;
  }
  return null;
}
function pluginManifests(profile){
  const values=[];
  if(!profile)return values;
  for(const folder of ['plugins_dev','plugins']){
    const directory=path.join(profile,folder);let files=[];
    try{files=fs.readdirSync(directory,{withFileTypes:true});}catch{continue;}
    for(const item of files){
      try{
        const file=path.join(directory,item.name);
        const manifest=item.isDirectory()?json(path.join(file,'manifest.json')):item.isFile()&&/\.plugin$/i.test(item.name)?archiveManifest(file):null;
        if(manifest&&typeof manifest.name==='string')values.push({directory:file,manifest});
      }catch{/* Unreadable manifests are reported as unconfirmed, never loaded. */}
    }
  }
  return values;
}
function safeSave(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const previous=file+'.previous',temporary=file+'.tmp',existed=fs.existsSync(file);
  if(existed)fs.copyFileSync(file,previous);
  fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n','utf8');
  try{fs.renameSync(temporary,file);}catch(error){
    if(error.code!=='EXDEV')throw error;
    // Match the lyric settings' Windows EFS replace fallback without passing
    // connection data through the unrelated lyric-preference normalizer.
    try{fs.copyFileSync(temporary,file);}catch(failure){if(existed)fs.copyFileSync(previous,file);throw failure;}
    fs.unlinkSync(temporary);
  }
}
async function inspect(config,context){
  if(!context.executable(config.clientExecutable)){
    let state;
    try{state=await context.windowsState();}catch(error){context.record({type:'connection-discovery-error',error:error.message});}
    const values=[...(state?.players||[]).map(value=>value.executable),...(state?.installed||[]),
      ...[process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean).map(value=>path.join(value,'NetEase/CloudMusic/cloudmusic.exe'))];
    config.clientExecutable=values.find(context.executable)||config.clientExecutable;
  }
  const clientFound=context.executable(config.clientExecutable);
  const version=clientFound?await fileVersion(config.clientExecutable,context.powershell):'未找到';
  const arch=clientFound?architecture(config.clientExecutable):'未知';
  const loader=clientFound?path.join(path.dirname(config.clientExecutable),'msimg32.dll'):null;
  const loaderFound=!!loader&&exists(loader);
  let loaderHash=null;
  if(loaderFound)try{loaderHash=crypto.createHash('sha256').update(fs.readFileSync(loader)).digest('hex');}
  catch(error){context.record({type:'connection-loader-read-error',error:error.message});}
  const manifests=pluginManifests(config.profile);
  const inflink=manifests.find(value=>/^InfLink(?:-rs|rs)$/i.test(value.manifest.name));
  const bridge=manifests.find(value=>value.manifest.name==='MineradioBridge');
  // The bridge must be a real folder: its session file is read next to index.js.
  const bridgeDirectory=bridge&&fs.existsSync(path.join(bridge.directory,'index.js'))?bridge.directory:null;
  const bridgeFiles=bridgeDirectory?BRIDGE_FILES.every(name=>exists(path.join(bridgeDirectory,name))):false;
  let writable=false;if(bridgeFiles)try{fs.accessSync(bridgeDirectory,fs.constants.W_OK);writable=true;}catch{}
  const status={clientExecutable:config.clientExecutable||null,clientFound,version,architecture:arch,loaderFound,loaderHash,
    loaderKnown:loaderHash===KNOWN_LOADER,profile:config.profile||null,inflinkVersion:pluginVersion(inflink),bridgeVersion:bridge?.manifest.version||null,
    bridgeDirectory,bridgeFiles,writable,filesReady:clientFound&&arch==='x64'&&loaderFound&&!!pluginVersion(inflink)&&bridgeFiles&&writable};
  status.compatibilityKnown=status.filesReady&&version==='3.1.42.205594'&&status.loaderKnown&&status.inflinkVersion==='3.4.0'&&status.bridgeVersion==='0.4.3';
  status.fingerprint=crypto.createHash('sha256').update(JSON.stringify(status)).digest('hex');
  return status;
}
function pluginVersion(value){return typeof value?.manifest.version==='string'?value.manifest.version:null;}
function bridgeDeploymentAllowed(status){
  return status.clientFound&&status.architecture==='x64'&&status.version==='3.1.42.205594'&&
    status.loaderKnown&&status.inflinkVersion==='3.4.0'&&!!status.profile;
}
function deployBridge(config,status,context){
  if(!bridgeDeploymentAllowed(status))throw Error('请先选择已支持的原版网易云及实际 profile，并配置 BetterNCM 1.3.4 x64 / InfLink 3.4.0。未知版本或 DLL 不会被修改。');
  const source=path.join(context.app.getAppPath(),'plugins/MineradioBridge');
  const profile=fs.realpathSync.native(config.profile);
  const target=status.bridgeDirectory?path.resolve(status.bridgeDirectory):path.join(profile,'plugins_dev','MineradioBridge');
  const parent=path.dirname(target);
  const resolvedParent=fs.existsSync(parent)?fs.realpathSync.native(parent):parent;
  if(!['plugins','plugins_dev'].some(folder=>resolvedParent.toLowerCase()===path.join(profile,folder).toLowerCase()))throw Error('现有桥接目录不属于所选 profile，未写入。');
  if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw Error('plugins_dev 是目录链接，请选择实际 profile 后重试。');
  if(fs.existsSync(target)){
    if(fs.lstatSync(target).isSymbolicLink()||!fs.statSync(target).isDirectory())throw Error('桥接目标不是普通目录，不覆盖。');
    if(!exists(path.join(target,'manifest.json'))||json(path.join(target,'manifest.json')).name!=='MineradioBridge')throw Error('目标目录身份不明，不覆盖。');
  }
  const contents=new Map();
  const previous=new Map();
  for(const name of BRIDGE_FILES){
    contents.set(name,fs.readFileSync(path.join(source,name)));
    const destination=path.join(target,name);
    if(fs.existsSync(destination)){
      if(fs.lstatSync(destination).isSymbolicLink()||!fs.statSync(destination).isFile())throw Error('桥接文件不是普通文件：'+name);
      previous.set(name,fs.readFileSync(destination));
    }
  }
  if(JSON.parse(contents.get('manifest.json').toString('utf8')).name!=='MineradioBridge')throw Error('随包桥接清单无效。');
  if(BRIDGE_FILES.every(name=>previous.get(name)?.equals(contents.get(name))))return {changed:false,target,backup:null};
  const backup=path.join(config.userDirectory,'bridge-backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID());
  fs.mkdirSync(backup,{recursive:true});
  for(const [name,data] of previous)fs.writeFileSync(path.join(backup,name),data);
  fs.writeFileSync(path.join(backup,'deployment.json'),JSON.stringify({target,files:BRIDGE_FILES,previousFiles:[...previous.keys()],sessionFilePreserved:true},null,2)+'\n');
  fs.mkdirSync(target,{recursive:true});
  const written=[];
  try{
    for(const [name,data] of contents){written.push(name);fs.writeFileSync(path.join(target,name),data);}
  }catch(error){
    const rollback=[];
    for(const name of written)try{
      const destination=path.join(target,name);
      if(previous.has(name))fs.writeFileSync(destination,previous.get(name));else fs.unlinkSync(destination);
    }catch(failure){rollback.push(name+': '+failure.message);}
    throw Error(error.message+'\n备份：'+backup+(rollback.length?'\n需手动恢复：'+rollback.join('; '):'\n本次已写入的文件已恢复。'));
  }
  return {changed:true,target,backup};
}
function details(config,status){
  return [
    '歌词程序已安装，不等于网易云插件已连接。以下仅检查本机文件，真正连接以后续收到的播放数据为准。',
    '网易云：'+(status.clientExecutable||'未找到，请选择原版 cloudmusic.exe'),
    '客户端版本／架构：'+status.version+' / '+status.architecture,
    'BetterNCM 加载器：'+(!status.loaderFound?'未找到 msimg32.dll':status.loaderKnown?'找到已记录的 1.3.4 x64 文件（尚未确认进程已加载）':'存在未知 msimg32.dll，不覆盖、不改动'),
    '插件目录：'+(status.profile||'尚未选择'),
    'InfLink-rs：'+(status.inflinkVersion?'manifest '+status.inflinkVersion+'（仅文件检查）':'未找到可读 manifest，未确认安装'),
    'MineradioBridge：'+(status.bridgeVersion?'manifest '+status.bridgeVersion:'未找到')+(status.bridgeFiles?'；必要文件齐全':'；必要文件未齐')+(status.bridgeFiles&&!status.writable?'；目录不可写':''),
    status.compatibilityKnown?'版本组合与已记录范围一致，仍需用户实际连接验收。':'当前记录仅验证 Windows 11 x64 / 网易云 3.1.42.205594 / BetterNCM 1.3.4 / InfLink 3.4.0 / Bridge 0.4.3；其他组合尚未验证。',
    '内置 Bridge 可在确认后配置到已有 profile；仅写本项目文件并备份，不改 DLL 或其他插件。第三方依赖缺失时请查看安装说明。',
    ...(config.warnings||[]),
  ].join('\n');
}
function applyStatus(config,status){
  config.setupStatus=status;
  config.bridgeConfig=status.bridgeFiles&&status.writable?path.join(status.bridgeDirectory,'connection.json'):path.join(config.userDirectory,'runtime/pending-bridge/connection.json');
  config.autoStartClient=config.autoStartClientPreference&&status.filesReady&&!process.argv.includes('--lyrics-only');
  return config;
}
async function prepare(config,context){
  const {app,dialog,record}=context;
  let status=await inspect(config,context);
  applyStatus(config,status);
  const force=context.force===true||process.argv.includes('--configure-connection');
  if(!force&&status.filesReady&&config.acknowledgedFingerprint===status.fingerprint){record({type:'connection-file-check',status});return config;}
  const {shell}=require('electron');
  while(true){
    const choice=await dialog.showMessageBox({type:status.filesReady?'info':'warning',title:'Mineradio · 网易云连接设置',
      message:status.filesReady?'插件文件已找到，连接仍待播放数据确认':'先确认网易云与插件，再开始使用',detail:details(config,status),
      buttons:[status.filesReady?'保存并继续':'仅启动歌词等待','选择网易云程序','选择插件目录','查看连接说明','配置／更新内置 Bridge','第三方依赖下载','退出歌词'],defaultId:0,cancelId:6,noLink:true});
    if(choice.response===6){record({type:'connection-setup-cancelled'});app.quit();return null;}
    if(choice.response===1){
      const selected=await dialog.showOpenDialog({title:'选择现有官方网易云 cloudmusic.exe',defaultPath:config.clientExecutable||undefined,properties:['openFile'],filters:[{name:'网易云程序',extensions:['exe']}]});
      if(!selected.canceled&&selected.filePaths[0]){
        if(context.executable(selected.filePaths[0]))config.clientExecutable=selected.filePaths[0];
        else await dialog.showMessageBox({type:'warning',title:'请选择网易云',message:'请选择实际存在的 cloudmusic.exe。',buttons:['返回']});
        status=await inspect(config,context);applyStatus(config,status);
      }
      continue;
    }
    if(choice.response===2){
      const selected=await dialog.showOpenDialog({title:'选择 BetterNCM 实际数据目录（其中应有 plugins_dev 或 plugins）',defaultPath:config.profile||undefined,properties:['openDirectory']});
      if(!selected.canceled&&selected.filePaths[0]){config.profile=selected.filePaths[0];status=await inspect(config,context);applyStatus(config,status);}
      continue;
    }
    if(choice.response===4){
      try{
        if(!bridgeDeploymentAllowed(status))throw Error('尚未满足已记录的兼容条件：网易云 3.1.42.205594 x64、已知 BetterNCM 1.3.4 x64、InfLink 3.4.0 及其实际 profile。请先查看连接说明，不会强行修改。');
        const consent=await dialog.showMessageBox({type:'question',title:'配置内置 MineradioBridge',message:'将内置桥接配置到所选 profile？',detail:'目标：'+(status.bridgeDirectory||path.join(config.profile,'plugins_dev/MineradioBridge'))+'\n仅更新本项目五个源文件，匹配文件不重复复制。旧文件备份到：'+path.join(config.userDirectory,'bridge-backups')+'\n保留 connection.json、账号及其他插件。不会退出网易云；如有更新，请之后自行从其托盘正常退出并重新打开。',buttons:['配置 Bridge','取消'],defaultId:1,cancelId:1,noLink:true});
        if(consent.response!==0)continue;
        const deployed=deployBridge(config,status,context);
        record({type:'bridge-deployed',...deployed});
        status=await inspect(config,context);applyStatus(config,status);
        await dialog.showMessageBox({type:'info',title:'Bridge 配置结果',message:deployed.changed?'Bridge 已配置，请正常重启网易云使其加载。':'Bridge 文件已经匹配，无需重复复制。',detail:deployed.target+(deployed.backup?'\n备份：'+deployed.backup:''),buttons:['返回']});
      }catch(error){record({type:'bridge-deployment-error',error:error.message});await dialog.showMessageBox({type:'error',title:'Bridge 未能配置',message:'未能完成内置桥接配置。',detail:error.message,buttons:['返回']});}
      continue;
    }
    if(choice.response===5){
      const selected=await dialog.showMessageBox({type:'info',title:'第三方依赖',message:'打开已记录版本的官方发布页',detail:'BetterNCM 1.3.4 x64 与 InfLink-rs 3.4.0 不随本程序分发。请按连接说明配置；不要覆盖来源未知的 DLL，不要降级或重装网易云。',buttons:['BetterNCM 1.3.4','InfLink-rs 3.4.0','返回'],cancelId:2,noLink:true});
      if(selected.response<2)try{await shell.openExternal(selected.response===0?'https://github.com/std-microblock/chromatic/releases/tag/1.3.4':'https://github.com/apoint123/inflink-rs/releases/tag/v3.4.0');}catch(error){record({type:'dependency-page-error',error:error.message});}
      continue;
    }
    if(choice.response===3){
      const file=exists(path.join(path.dirname(process.execPath),'连接说明.txt'))?path.join(path.dirname(process.execPath),'连接说明.txt'):path.join(app.getAppPath(),'docs/INSTALL_1.0_RC.md');
      const error=await shell.openPath(file);if(error)await dialog.showMessageBox({type:'warning',title:'无法打开',message:'未能打开随包说明或桥接目录。',detail:error,buttons:['返回']});
      continue;
    }
    try{
      safeSave(config.userConfigFile,{version:1,clientExecutable:config.clientExecutable||'',profile:config.profile||'',autoStartClient:config.autoStartClientPreference,acknowledgedFingerprint:status.fingerprint});
      config.acknowledgedFingerprint=status.fingerprint;
      record({type:'connection-setup-saved',configFile:config.userConfigFile,status});
      return config;
    }catch(error){record({type:'connection-config-save-error',error:error.message});await dialog.showMessageBox({type:'error',title:'连接设置保存失败',message:'无法保存连接路径，原配置保留。',detail:error.message,buttons:['返回']});}
  }
}
module.exports={prepare};
