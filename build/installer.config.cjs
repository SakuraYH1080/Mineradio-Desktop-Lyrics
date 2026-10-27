// NSIS consumes the already-built, allowlisted directory. No source-tree glob.
const path = require('node:path');
const identity = require('./windows-app.json');
module.exports = {
  appId: identity.appId,
  productName: identity.productName,
  executableName: identity.win.executableName,
  copyright: 'GPL-3.0-only; upstream Mineradio authors and contributors',
  electronVersion: '42.4.1',
  asar: false,
  npmRebuild: false,
  buildDependenciesFromSource: false,
  compression: 'normal',
  forceCodeSigning: false,
  publish: null,
  directories: {buildResources:'build', output:'artifacts/1.0.0'},
  artifactName: 'Mineradio-Desktop-Lyrics-${version}-${arch}-Setup.${ext}',
  win: {
    ...identity.win,
    icon: path.resolve(__dirname, '..', identity.win.icon),
    target: [{target:'nsis', arch:['x64']}],
    // The controlled build wrapper edits the copied EXE's metadata and icon.
    // No certificate is configured for this candidate.
    signAndEditExecutable: false,
    signExecutable: false,
    requestedExecutionLevel: 'asInvoker',
  },
  nsis: {
    ...Object.fromEntries(Object.entries(identity.nsis).map(([key,value])=>[key,path.resolve(__dirname,'..',value)])),
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    runAfterFinish: false,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: identity.productName,
    installerLanguages: ['zh_CN','en_US'],
    displayLanguageSelector: false,
    license: path.resolve(__dirname,'..','LICENSE'),
    deleteAppDataOnUninstall: false,
    differentialPackage: false,
    include: path.join(__dirname,'installer.nsh'),
  },
};
