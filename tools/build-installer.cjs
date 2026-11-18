/* Build-only wrapper: no app execution, install/uninstall or NetEase control. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {build,Platform,Arch} = require('electron-builder');
const root = path.resolve(__dirname,'..');
const identity = require('../build/windows-app.json');
const config = require('../build/installer.config.cjs');
const packageInfo = require('../package.json');
const {createWindowsSigner,verifySignature} = require('./windows-signing.cjs');
const runtime = require('../build/runtime.json');
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
async function main(){
  const prepackaged=arg('--prepackaged');
  const outputArg=arg('--output');
  if(!prepackaged)throw Error('Usage: node tools/build-installer.cjs [--signed] --prepackaged <clean GUI directory> [--output <new directory>]');
  const signer = process.argv.includes('--signed') ? createWindowsSigner() : null;
  const input = fs.realpathSync(path.resolve(root,prepackaged));
  let liveDirectory=false;
  const hostDescriptor=path.join(path.dirname(input),'host.json');
  if(fs.existsSync(hostDescriptor)){
    const host=JSON.parse(fs.readFileSync(hostDescriptor,'utf8').replace(/^\uFEFF/,''));
    liveDirectory=[host.app,host.desktopExecutable&&path.dirname(host.desktopExecutable)].filter(Boolean).some(value=>path.resolve(value).toLowerCase()===input.toLowerCase());
  }
  const launch=JSON.parse(fs.readFileSync(path.join(input,'desktop-launch.json'),'utf8').replace(/^\uFEFF/,''));
  if(launch.clientExecutable || launch.profile&&path.isAbsolute(launch.profile))throw Error('Candidate payload must not contain personal launch paths.');
  if(liveDirectory || input===root || input.split(path.sep).some(part=>part.toLowerCase()==='node_modules'))
    throw Error('Pass a disposable clean build directory, not a live installation/source/runtime.');
  const output=path.resolve(root,outputArg || `artifacts/${packageInfo.version}${signer ? '-signed' : ''}`);
  if(fs.existsSync(output))throw Error('Preserve existing artifacts; choose a new output directory.');
  const outputRelative = path.relative(input, output);
  if (!path.isAbsolute(outputRelative) && !outputRelative.startsWith('..' + path.sep))
    throw Error('The installer output must be outside the packaged GUI directory.');
  const provenance=JSON.parse(fs.readFileSync(path.join(input,'build-provenance.json'),'utf8'));
  if(provenance.version!==packageInfo.version || provenance.format!=='windows-webview2-evergreen' ||
    provenance.appId!==identity.appId)throw Error('Prepackaged app metadata differs from candidate source.');
  const program=identity.win.executableName+'.exe';
  const metadata={file:program,sha256:hash(path.join(input,program)),
    productVersion:provenance.version,fileVersion:provenance.fileVersion};
  if(metadata.sha256!==provenance.executableSha256)throw Error('Launcher does not match its build record.');
  const files=walk(input);
  for(const file of files){
    const name=path.relative(input,file).replace(/\\/g,'/');
    if(/(^|\/)(?:logs|backups|\.runtime|node_modules|tests|fixtures|Cache|Cookies)(?:\/|$)/i.test(name) || /(?:connection\.json|host\.json|lyrics-settings\.json|\.previous|\.tmp|\.ndjson|\.log)$/i.test(name))
      throw Error('Private/test/runtime content must not enter candidate payload: '+name);
  }
  fs.mkdirSync(output,{recursive:true});
  const work=path.join(output,'.build');fs.mkdirSync(work);
  const directory = signer ? path.join(work, 'payload') : input;
  const compilerOutput = signer ? path.join(work, 'installer') : output;
  const signatures = new Map();
  let nodeSignature;
  if (signer) {
    const node = path.join(input, 'resources/node.exe');
    if (hash(node) !== runtime.node.sha256) throw Error('The bundled Node executable does not match the pinned upstream build.');
    nodeSignature = verifySignature(node);
    fs.cpSync(input, directory, { recursive: true });
    const launcher = path.join(directory, program);
    metadata.signature = signer.sign(launcher);
    metadata.sha256 = hash(launcher);
    provenance.executableSha256 = metadata.sha256;
    provenance.executableSignature = metadata.signature;
    fs.writeFileSync(path.join(directory, 'build-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  }
  const relative=files.map(file=>path.relative(input,file).replace(/\//g,'\\')).sort();
  const owned=[...relative,'mineradio-installation.txt','uninstallerIcon.ico'];
  const dirs=new Set();for(const name of relative){let parent=path.win32.dirname(name);while(parent!=='.'){dirs.add(parent);parent=path.win32.dirname(parent);}}
  const list=owned.map(name=>`Delete "$INSTDIR\\${nsisString(name)}"`);
  list.push('Delete "$INSTDIR\\${UNINSTALL_FILENAME}"');
  for(const dir of [...dirs].sort((a,b)=>b.split('\\').length-a.split('\\').length || b.localeCompare(a)))list.push(`RMDir "$INSTDIR\\${nsisString(dir)}"`);
  list.push('RMDir "$INSTDIR"');
  const removeList=path.join(work,'owned-files.nsh');fs.writeFileSync(removeList,list.join('\r\n')+'\r\n');
  const include=path.join(work,'installer-generated.nsh');
  fs.writeFileSync(include,`!define MINERADIO_REMOVE_LIST "${nsisString(removeList)}"\r\n!include "${nsisString(path.join(root,'build/installer.nsh'))}"\r\n`);
  const buildConfig={...config,directories:{...config.directories,output:compilerOutput},nsis:{...config.nsis,include}};
  if (signer) {
    buildConfig.forceCodeSigning = true;
    buildConfig.win = {
      ...config.win,
      signExecutable: true,
      signtoolOptions: {
        signingHashAlgorithms: ['sha256'],
        sign({path: file}) {
          const signature = signer.sign(file);
          if (signature.publisher !== metadata.signature.publisher) {
            throw Error('Installer binaries must use the same publisher as the launcher.');
          }
          signatures.set(path.basename(file), { file: path.basename(file), signature });
        },
      },
    };
  }
  let artifacts=await build({targets:Platform.WINDOWS.createTarget(['nsis'],Arch.x64),prepackaged:directory,config:buildConfig,publish:'never'});
  let signing = { status: 'unsigned' };
  if (signer) {
    const setup = artifacts.find(file => file.endsWith('-Setup.exe'));
    const installer = setup && signatures.get(path.basename(setup));
    const uninstaller = [...signatures.values()].find(file => file.file.endsWith('.__uninstaller.exe'));
    if (!installer || !uninstaller) throw Error('NSIS did not produce verified signatures for both installer and uninstaller.');
    signing = {
      status: 'verified',
      provider: signer.provider,
      publisher: metadata.signature.publisher,
      payloadDirectory: path.relative(output, directory).replace(/\\/g, '/'),
      installer, uninstaller, node: nodeSignature,
    };
    artifacts = artifacts.map(file => {
      const final = path.join(output, path.basename(file));
      fs.renameSync(file, final);
      return final;
    });
  }
  // Keep compiler diagnostics (which may contain developer paths) out of the
  // public attachment list. Preserve them privately rather than deleting them.
  const debug=path.join(compilerOutput,'builder-debug.yml');
  if(fs.existsSync(debug))fs.renameSync(debug,path.join(work,'builder-debug.yml'));
  const receipt={version:packageInfo.version,architecture:'x64',node:provenance.nodeVersion,webview2Sdk:provenance.webview2SdkVersion,electronBuilder:require('electron-builder/package.json').version,
    sourceCommit:provenance.sourceCommit,signing,metadata,files:walk(directory).map(file=>({path:path.relative(directory,file).replace(/\\/g,'/'),sha256:hash(file)})),
    artifacts:artifacts.map(file=>({file:path.basename(file),sha256:hash(file),bytes:fs.statSync(file).size})),
    validation:'Build and static payload checks only; installer/app not run as an acceptance test.'};
  fs.writeFileSync(path.join(output,'build-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),receipt.artifacts.map(item=>`${item.sha256}  ${item.file}`).join('\n')+'\n');
  console.log(JSON.stringify({version:packageInfo.version,output,signing,artifacts:receipt.artifacts},null,2));
}
main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
  // Preserve the failure status through electron-builder's exit handlers.
  process.once('exit', () => { process.exitCode = 1; });
});
