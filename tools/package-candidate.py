"""Export clean candidate attachments; this never installs or starts the app."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def export(gui, output):
    root=Path(__file__).resolve().parent.parent
    gui=gui.resolve();output=output.resolve()
    package=json.loads((root/'package.json').read_text(encoding='utf-8'))
    version=package['version']
    try:
        commit=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD']).decode().strip()
    except (OSError,subprocess.CalledProcessError):
        commit=(root/'SOURCE_COMMIT.txt').read_text(encoding='utf-8').strip()
    provenance=json.loads((gui/'build-provenance.json').read_text(encoding='utf-8-sig'))
    if provenance['version']!=version or provenance['sourceCommit']!=commit:
        raise SystemExit('Candidate version/commit differs from the supplied GUI build.')
    installer_names=[f'Mineradio-Desktop-Lyrics-{version}-x64-{kind}.exe' for kind in ('Setup','WebSetup')]
    installer_build=json.loads((output/'build-receipt.json').read_text(encoding='utf-8'))
    build_artifacts={item['file']:item for item in installer_build['artifacts']}
    for name in installer_names:
        installer=output/name
        record=build_artifacts.get(name)
        if not record or not installer.is_file() or installer.stat().st_size!=record['bytes'] or sha(installer.read_bytes())!=record['sha256']:
            raise SystemExit(name+' differs from the installer build record.')
    signing=installer_build.get('signing', {'status':'unsigned'})
    if signing['status']=='verified' and gui!=(output/signing['payloadDirectory']).resolve():
        raise SystemExit('Export signed attachments from the installer build record payloadDirectory.')
    archive_names=[f'Mineradio-Desktop-Lyrics-{version}-x64-Portable.zip',
                   f'Mineradio-Desktop-Lyrics-{version}-Source.zip','MineradioBridge-0.4.3.zip']
    if any((output/name).exists() for name in archive_names):
        raise SystemExit('Keep existing candidate attachments; use a fresh release directory.')
    def zip_files(target, files, prefix='', overrides=None):
        overrides=overrides or {}
        with zipfile.ZipFile(target,'x',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
            for name,file in sorted(files.items()):
                archive.writestr(prefix+name,overrides[name] if name in overrides else file.read_bytes())
            for name,data in overrides.items():
                if name not in files:archive.writestr(prefix+name,data)
        with zipfile.ZipFile(target) as archive:
            if archive.testzip() is not None:raise SystemExit('Archive CRC failed.')
            if len(archive.namelist())!=len(set(archive.namelist())):raise SystemExit('Duplicate archive entries.')
    runtime={file.relative_to(gui).as_posix():file for file in gui.rglob('*') if file.is_file()}
    if signing['status']=='verified':
        expected={item['path']:item['sha256'] for item in installer_build['files']}
        actual={name:sha(file.read_bytes()) for name,file in runtime.items()}
        if actual!=expected:
            raise SystemExit('The signed payload differs from the files used to build Setup.exe.')
    for name,file in runtime.items():
        if file.is_symlink() or any(part in {'.runtime','logs','backups','tests','fixtures','node_modules','Cache'} for part in Path(name).parts):
            raise SystemExit('Private or development payload rejected: '+name)
        if Path(name).name in {'connection.json','desktop-connection.json','lyrics-settings.json','window-state.json','host.json'}:
            raise SystemExit('Personal payload rejected: '+name)
    default=json.loads((gui/'desktop-launch.json').read_text(encoding='utf-8'))
    if default.get('clientExecutable') or Path(default.get('profile','')).is_absolute():
        raise SystemExit('Personal launch configuration rejected.')
    zip_files(output/archive_names[0],runtime,f'Mineradio-Desktop-Lyrics-{version}-x64/')

    # Complete corresponding source for the shipped application/build. Do not
    # export the original repository history, private reports or QA residue.
    names=set(provenance['applicationHashes'])-{'package.json'}
    names.update({'package.json','package-lock.json','README.md','LICENSE','NOTICE.md','THIRD_PARTY_NOTICES.md',
                  'build/desktop.manifest','build/runtime.json','build/licenses/NSIS-COPYING.txt',
                  'build/installer.config.cjs','build/installer.nsh','build/connection-wizard.cs','tools/build-desktop.py',
                  'tools/build-installer.cjs','tools/windows-signing.cjs','tools/generate-icons.py','tools/package-candidate.py',
                  'CHANGELOG.md','docs/INSTALL_1.0_RC.md','docs/THIRD_PARTY_RC.md','docs/UPSTREAM_NOTICE.md','docs/WINDOWS_SIGNING.md',
                  'native/desktop.cpp','native/platform.h','native/fonts.h','vendor/overlay-preload.js','src/settings-preload.cjs',
                  'src/replay.cjs','tools/mouse-poll.ps1','fixtures/demo.lrc','fixtures/demo.yrc'})
    for file in (root/'public/icons').glob('*'):
        if file.is_file() and file.suffix.lower() in {'.svg','.png','.ico','.md'}:names.add(file.relative_to(root).as_posix())
    source={name:root/name for name in names}
    for name,file in source.items():
        if not file.is_file():raise SystemExit('Missing corresponding source: '+name)
    source_package=dict(package)
    source_package['scripts']={key:value for key,value in package['scripts'].items() if key in {'start','start:inflink','start:bridge','build:setup','build:setup:signed'}}
    overrides={'package.json':(json.dumps(source_package,ensure_ascii=False,indent=2)+'\n').encode(),
               'SOURCE_COMMIT.txt':(commit+'\n').encode()}
    source_manifest={'version':version,'sourceCommit':commit,
        'scope':'Corresponding application and build source with the demo entry; private history, QA harnesses and logs excluded.',
        'snapshotChanges':['package.json npm scripts limited to included normal/build entry points; runtime code unchanged.'],
        'files':{name:sha(overrides[name] if name in overrides else file.read_bytes()) for name,file in sorted(source.items())}}
    overrides['SOURCE-SNAPSHOT.json']=(json.dumps(source_manifest,ensure_ascii=False,indent=2)+'\n').encode()
    zip_files(output/archive_names[1],source,f'Mineradio-Desktop-Lyrics-{version}-Source/',overrides)

    bridge={name:root/'plugins/MineradioBridge'/name for name in ['manifest.json','index.js','header-compat.js','pcm-freshness.js','pcm-analyzer.js']}
    bridge.update({'LICENSE':root/'LICENSE','NOTICE.md':root/'NOTICE.md'})
    zip_files(output/archive_names[2],bridge,'MineradioBridge/')
    shutil.copy2(root/'docs/INSTALL_1.0_RC.md',output/'安装与使用说明.md')
    shutil.copy2(root/'docs/THIRD_PARTY_RC.md',output/'第三方许可说明.md')
    shutil.copy2(root/'README.md',output/'README.md')
    receipt={'version':version,'sourceCommit':commit,'candidateOnly':'-' in version,
             'windowsSigning':signing,
             'installedOrExecutedForAcceptance':False,'sourceScope':source_manifest['scope'],
             'artifacts':{name:{'sha256':sha((output/name).read_bytes()),'bytes':(output/name).stat().st_size} for name in [*installer_names,*archive_names]}}
    (output/'candidate-delivery.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    public_names={*installer_names,*archive_names,'安装与使用说明.md','第三方许可说明.md','README.md','candidate-delivery.json','build-receipt.json'}
    public=[file for file in output.iterdir() if file.is_file() and file.name in public_names]
    (output/'SHA256SUMS.txt').write_text(''.join(sha(file.read_bytes())+'  '+file.name+'\n' for file in sorted(public)),encoding='utf-8')
    print(json.dumps(receipt,ensure_ascii=False,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--release',type=Path,required=True)
    args=parser.parse_args()
    export(args.directory,args.release)
