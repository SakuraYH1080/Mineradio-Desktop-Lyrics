/* Build-only wrapper: no app execution, install/uninstall or NetEase control. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {build,Platform,Arch} = require('electron-builder');
const ResEdit = require('resedit');
const root = path.resolve(__dirname,'..');
const identity = require('../build/windows-app.json');
const config = require('../build/installer.config.cjs');
const packageInfo = require('../package.json');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const arg = name => {const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1];};
function walk(directory) {
  const files=[];
  for(const item of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,item.name);
    if(item.isSymbolicLink())throw Error('Do not package a reparse/link entry: '+file);
    if(item.isDirectory())files.push(...walk(file));else if(item.isFile())files.push(file);
  }
  return files;
}
function nsisString(value) {
  if(/[\r\n]/.test(value))throw Error('Newlines are not valid in package paths');
  return value.replace(/["$]/g,character=>character==='$'?'$$':'$\\"');
}
function patchMetadata(directory) {
  const file=path.join(directory,identity.win.executableName+'.exe');
  if(file.toLowerCase().split(path.sep).includes('node_modules'))throw Error('Never edit the pinned Electron input.');
  const pe=ResEdit.NtExecutable.from(fs.readFileSync(file),{ignoreCert:true});
  const resources=ResEdit.NtExecutableResource.from(pe);
  const versions=ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if(!versions.length)throw Error('Expected Electron PE VersionInfo');
  const [major,minor,patch]=packageInfo.version.split('.').map(part=>parseInt(part,10));
  for(const version of versions){
    const tables=version.getAllLanguagesForStringValues();
    for(const table of tables){
      version.setFileVersion(major,minor,patch,0,table.lang);
      version.setProductVersion(major,minor,patch,0,table.lang);
      version.setStringValues(table,{
        ProductName:identity.productName,FileDescription:identity.productName,
        InternalName:identity.win.executableName,OriginalFilename:identity.win.executableName+'.exe',
        FileVersion:`${major}.${minor}.${patch}.0`,ProductVersion:packageInfo.version,
        CompanyName:'Mineradio contributors',LegalCopyright:'GPL-3.0-only; upstream Mineradio authors and contributors',
      });
    }
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(pe);
  fs.writeFileSync(file,Buffer.from(pe.generate()));
  return {file:path.basename(file),sha256:hash(file),productVersion:packageInfo.version,fileVersion:`${major}.${minor}.${patch}.0`};
}
async function main(){
  const prepackaged=arg('--prepackaged');
  const outputArg=arg('--output');
  if(!prepackaged)throw Error('Usage: node tools/build-installer.cjs --prepackaged <clean GUI directory> [--output <new directory>]');
  const directory=fs.realpathSync(path.resolve(root,prepackaged));
  let liveDirectory=false;
  const hostDescriptor=path.join(path.dirname(directory),'host.json');
  if(fs.existsSync(hostDescriptor)){
    const host=JSON.parse(fs.readFileSync(hostDescriptor,'utf8').replace(/^\uFEFF/,''));
    liveDirectory=[host.app,host.desktopExecutable&&path.dirname(host.desktopExecutable)].filter(Boolean).some(value=>path.resolve(value).toLowerCase()===directory.toLowerCase());
  }
  const launch=JSON.parse(fs.readFileSync(path.join(directory,'desktop-launch.json'),'utf8').replace(/^\uFEFF/,''));
  if(launch.clientExecutable || launch.profile&&path.isAbsolute(launch.profile))throw Error('Candidate payload must not contain personal launch paths.');
  if(liveDirectory || directory===root || directory.split(path.sep).some(part=>part.toLowerCase()==='node_modules'))
    throw Error('Pass a disposable clean build directory, not a live installation/source/runtime.');
  const output=path.resolve(root,outputArg || `artifacts/${packageInfo.version}`);
  if(fs.existsSync(output))throw Error('Preserve existing artifacts; choose a new output directory.');
  const appPackage=JSON.parse(fs.readFileSync(path.join(directory,'resources/app/package.json'),'utf8'));
  if(appPackage.version!==packageInfo.version || appPackage.main!=='src/desktop-main.cjs')throw Error('Prepackaged app metadata differs from candidate source.');
  const files=walk(directory);
  for(const file of files){
    const name=path.relative(directory,file).replace(/\\/g,'/');
    if(/(^|\/)(?:logs|backups|\.runtime|node_modules|tests|fixtures|Cache|Cookies)(?:\/|$)/i.test(name) || /(?:connection\.json|host\.json|lyrics-settings\.json|\.previous|\.tmp|\.ndjson|\.log)$/i.test(name))
      throw Error('Private/test/runtime content must not enter candidate payload: '+name);
  }
  fs.mkdirSync(output,{recursive:true});
  const work=path.join(output,'.build');fs.mkdirSync(work);
  const metadata=patchMetadata(directory);
  const provenancePath=path.join(directory,'build-provenance.json');
  const provenance=JSON.parse(fs.readFileSync(provenancePath,'utf8'));
  provenance.executableSha256=metadata.sha256;provenance.windowsVersionInfo=metadata;
  fs.writeFileSync(provenancePath,JSON.stringify(provenance,null,2)+'\n');
  const relative=files.map(file=>path.relative(directory,file).replace(/\//g,'\\')).sort();
  const owned=[...relative,'mineradio-installation.txt','uninstallerIcon.ico'];
  const dirs=new Set();for(const name of relative){let parent=path.win32.dirname(name);while(parent!=='.'){dirs.add(parent);parent=path.win32.dirname(parent);}}
  const list=owned.map(name=>`Delete "$INSTDIR\\${nsisString(name)}"`);
  list.push('Delete "$INSTDIR\\${UNINSTALL_FILENAME}"');
  for(const dir of [...dirs].sort((a,b)=>b.split('\\').length-a.split('\\').length || b.localeCompare(a)))list.push(`RMDir "$INSTDIR\\${nsisString(dir)}"`);
  list.push('RMDir "$INSTDIR"');
  const removeList=path.join(work,'owned-files.nsh');fs.writeFileSync(removeList,list.join('\r\n')+'\r\n');
  const include=path.join(work,'installer-generated.nsh');
  fs.writeFileSync(include,`!define MINERADIO_REMOVE_LIST "${nsisString(removeList)}"\r\n!include "${nsisString(path.join(root,'build/installer.nsh'))}"\r\n`);
  const buildConfig={...config,directories:{...config.directories,output},nsis:{...config.nsis,include}};
  const artifacts=await build({targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),prepackaged:directory,config:buildConfig,publish:'never'});
  // Keep compiler diagnostics (which may contain developer paths) out of the
  // public attachment list. Preserve them privately rather than deleting them.
  const debug=path.join(output,'builder-debug.yml');
  if(fs.existsSync(debug))fs.renameSync(debug,path.join(work,'builder-debug.yml'));
  const receipt={version:packageInfo.version,architecture:'x64',electron:require('electron/package.json').version,electronBuilder:require('electron-builder/package.json').version,
    sourceCommit:provenance.sourceCommit,metadata,files:walk(directory).map(file=>({path:path.relative(directory,file).replace(/\\/g,'/'),sha256:hash(file)})),
    artifacts:artifacts.map(file=>({file:path.basename(file),sha256:hash(file),bytes:fs.statSync(file).size})),
    validation:'Build and static payload checks only; installer/app not run as an acceptance test.'};
  fs.writeFileSync(path.join(output,'build-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),receipt.artifacts.map(item=>`${item.sha256}  ${item.file}`).join('\n')+'\n');
  console.log(JSON.stringify({version:packageInfo.version,output,artifacts:receipt.artifacts},null,2));
}
main().catch(error=>{console.error(error.stack || error);process.exitCode=1;});
