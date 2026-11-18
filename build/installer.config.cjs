// NSIS consumes the already-built, allowlisted directory. No source-tree glob.
const path = require('node:path');
const identity = require('./windows-app.json');
module.exports = {
  appId: identity.appId,
  productName: identity.productName,
  executableName: identity.win.executableName,
  copyright: 'GPL-3.0-only; upstream Mineradio authors and contributors',
  // The NSIS target consumes the native prepackaged folder. This value
  // satisfies electron-builder's framework metadata lookup at build time.
  electronVersion: require('../package.json').devDependencies.electron,
  asar: false,
  npmRebuild: false,
  buildDependenciesFromSource: false,
  compression: 'maximum',
  forceCodeSigning: false,
  publish: null,
  directories: {buildResources:'build'},
  artifactName: 'Mineradio-Desktop-Lyrics-${version}-${arch}-Setup.${ext}',
  win: {
    ...identity.win,
    icon: path.resolve(__dirname, '..', identity.win.icon),
    target: [{target:'nsis', arch:['x64']}],
    // The native linker has already embedded the launcher's metadata and icon.
    // Local builds use this config. The signed build supplies the NSIS signing hook.
    signAndEditExecutable: false,
    signExecutable: false,
    requestedExecutionLevel: 'asInvoker',
  },
  nsis: {
    ...Object.fromEntries(Object.entries(identity.nsis).map(([key,value])=>[key,path.resolve(__dirname,'..',value)])),
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    packElevateHelper: false,
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
