"""Build the x64 Win32 launcher and stage its runtime files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.request import Request, urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.runtime/build-deps'
RUNTIME = json.loads((ROOT / 'build/runtime.json').read_text(encoding='utf-8'))
PACKAGE = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
IDENTITY = json.loads((ROOT / 'build/windows-app.json').read_text(encoding='utf-8'))

APP_FILES = (
    'build/windows-app.json',
    'vendor/desktop-lyrics.html',
    'vendor/lyrics-fetch-parse.js',
    'public/desktop-typography.js',
    'public/lyric-typography.js',
    'public/webview-bridge.js',
    'public/settings.html',
    'public/settings.css',
    'public/settings.js',
    'public/settings-glass.js',
    'public/fonts/InstrumentSans-Regular.woff2',
    'public/fonts/InstrumentSans-Medium.woff2',
    'public/fonts/InstrumentSans-SemiBold.woff2',
    'public/fonts/OFL.txt',
    'public/assets/settings/hero-duo.webp',
    'public/assets/settings/chibi.webp',
    'public/assets/settings/SOURCES.md',
    'public/icons/tray.ico',
    'src/bridge-server.cjs',
    'src/desktop-main.cjs',
    'src/desktop-setup.cjs',
    'src/desktop-startup.cjs',
    'src/drag.cjs',
    'src/inflink-adapter.cjs',
    'src/lyrics.cjs',
    'src/main.cjs',
    'src/palette.cjs',
    'src/preferences.cjs',
    'src/rhythm.cjs',
    'src/system-fonts.cjs',
    'src/timeline.cjs',
    'src/visibility.cjs',
    'src/webview-host.cjs',
    'src/window-state.cjs',
    'tools/probe.ps1',
    'plugins/MineradioBridge/manifest.json',
    'plugins/MineradioBridge/index.js',
    'plugins/MineradioBridge/header-compat.js',
    'plugins/MineradioBridge/pcm-freshness.js',
    'plugins/MineradioBridge/pcm-analyzer.js',
)

def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        while data := stream.read(1024 * 1024):
            result.update(data)
    return result.hexdigest()


def download(url, file, expected_hash, size=None):
    if file.is_file() and digest(file) == expected_hash:
        return
    file.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=file.parent) as temporary:
        partial = Path(temporary) / file.name
        with partial.open('wb') as target:
            if size is None:
                with urlopen(url, timeout=60) as response:
                    shutil.copyfileobj(response, target)
            else:
                chunk = 8_000_000
                for start in range(0, size, chunk):
                    end = min(start + chunk, size) - 1
                    request = Request(url, headers={'Range': f'bytes={start}-{end}'})
                    with urlopen(request, timeout=60) as response:
                        shutil.copyfileobj(response, target)
                        if response.status == 200:
                            break
        if digest(partial) != expected_hash:
            raise ValueError(f'SHA-256 mismatch for {file.name}')
        partial.replace(file)


def dependencies():
    node = RUNTIME['node']
    version = node['version']
    node_folder = CACHE / f'node-{version}'
    download(f'https://nodejs.org/dist/v{version}/win-x64/node.exe', node_folder / 'node.exe',
             node['sha256'], node['bytes'])
    download(f'https://raw.githubusercontent.com/nodejs/node/v{version}/LICENSE', node_folder / 'LICENSE',
             node['licenseSha256'])

    sdk = RUNTIME['webview2Sdk']
    version = sdk['version']
    archive = CACHE / f'webview2.{version}.zip'
    download(f'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/{version}/microsoft.web.webview2.{version}.nupkg',
             archive, sdk['sha256'])
    return node_folder, archive


def compiler_environment():
    vswhere = Path(os.environ['ProgramFiles(x86)']) / 'Microsoft Visual Studio/Installer/vswhere.exe'
    location = subprocess.check_output([
        str(vswhere), '-latest', '-products', '*', '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath', '-utf8',
    ], encoding='utf-8').strip()
    vcvars = Path(location) / 'VC/Auxiliary/Build/vcvars64.bat'
    env_output = subprocess.check_output(
        f'"{os.environ["ComSpec"]}" /d /u /s /c ""{vcvars}" >nul && set"', encoding='utf-16-le')
    entries = (line.split('=', 1) for line in env_output.splitlines() if '=' in line and not line.startswith('='))
    return {key.upper(): value for key, value in entries}


def compile_launcher(work, archive):
    with ZipFile(archive) as sdk:
        sdk.extractall(work, (
            'build/native/include/WebView2.h',
            'build/native/x64/WebView2LoaderStatic.lib',
            'LICENSE.txt',
        ))
    inc = work / 'identity.h'
    inc.write_text(f'#pragma once\n#define MINERADIO_APP_ID L"{IDENTITY["appId"]}"\n', encoding='utf-8')
    version = PACKAGE['version']
    file_version = version.split('-')[0] + '.0'
    binary_version = file_version.replace('.', ',')
    name = IDENTITY['win']['executableName']
    product = IDENTITY['productName']
    resource = work / 'app.rc'
    resource.write_text(f'''#pragma code_page(65001)
1 ICON "{(ROOT / IDENTITY['win']['icon']).as_posix()}"
1 24 "{(ROOT / 'build/desktop.manifest').as_posix()}"
1 VERSIONINFO
FILEVERSION {binary_version}
PRODUCTVERSION {binary_version}
FILEOS 0x40004
FILETYPE 1
BEGIN
    BLOCK "StringFileInfo"
    BEGIN
        BLOCK "080404B0"
        BEGIN
            VALUE "CompanyName", "Mineradio contributors"
            VALUE "FileDescription", "{product}"
            VALUE "FileVersion", "{file_version}"
            VALUE "InternalName", "{name}"
            VALUE "OriginalFilename", "{name}.exe"
            VALUE "ProductName", "{product}"
            VALUE "ProductVersion", "{version}"
        END
    END
    BLOCK "VarFileInfo"
    BEGIN
        VALUE "Translation", 0x0804, 1200
    END
END
''', encoding='utf-8')

    env = compiler_environment()
    sdk_winrt = Path(env['WINDOWSSDKDIR']) / 'Include' / env['WINDOWSSDKVERSION'].strip('\\/') / 'cppwinrt'
    rc = shutil.which('rc.exe', path=env['PATH'])
    cl = shutil.which('cl.exe', path=env['PATH'])
    subprocess.run([rc, '/nologo', '/fo', 'app.res', 'app.rc'], cwd=work, env=env, check=True)
    executable = work / f'{name}.exe'
    subprocess.run([
        cl, '/nologo', '/std:c++20', '/utf-8', '/EHsc', '/MT', '/O1', '/GL', '/Gy', '/Gw',
        '/DUNICODE', '/D_UNICODE', '/DNOMINMAX', '/D_WIN32_WINNT=0x0A00',
        f'/I{work}', f'/I{sdk_winrt}', f'/I{work / "build/native/include"}',
        str(ROOT / 'native/desktop.cpp'), 'app.res', f'/Fe{executable}', '/link',
        '/SUBSYSTEM:WINDOWS', '/MANIFEST:NO', '/LTCG', '/OPT:REF', '/OPT:ICF',
        str(work / 'build/native/x64/WebView2LoaderStatic.lib'),
        'advapi32.lib', 'comctl32.lib', 'crypt32.lib', 'dcomp.lib', 'dwrite.lib', 'ole32.lib', 'oleaut32.lib', 'runtimeobject.lib',
        'shell32.lib', 'shcore.lib', 'shlwapi.lib', 'user32.lib', 'version.lib', 'windowscodecs.lib',
    ], cwd=work, env=env, check=True)
    return executable, file_version


def build(output):
    output = output.resolve()
    if output.exists():
        raise SystemExit('Choose a new output directory to keep the previous build.')
    if (ROOT / '.git').exists():
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        changed = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT))
    else:
        commit = (ROOT / 'SOURCE_COMMIT.txt').read_text(encoding='utf-8').strip()
        changed = False

    node, sdk = dependencies()
    with tempfile.TemporaryDirectory(dir=CACHE) as temp:
        work = Path(temp)
        executable, file_version = compile_launcher(work, sdk)
        (output / 'licenses').mkdir(parents=True)
        (output / 'resources').mkdir()
        shutil.copy2(executable, output / executable.name)
        shutil.copy2(work / 'LICENSE.txt', output / 'licenses/WebView2Loader.txt')
        shutil.copy2(node / 'node.exe', output / 'resources/node.exe')
        shutil.copy2(node / 'LICENSE', output / 'licenses/Node.js.txt')

    app = output / 'resources/app'
    for name in APP_FILES:
        destination = app / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, destination)
    for source, destination in {
        'LICENSE': 'LICENSE',
        'NOTICE.md': 'NOTICE.md',
        'build/licenses/NSIS-COPYING.txt': 'licenses/NSIS-COPYING.txt',
        'docs/INSTALL_1.0_RC.md': '连接说明.txt',
        'docs/THIRD_PARTY_RC.md': '第三方许可说明.txt',
    }.items():
        shutil.copy2(ROOT / source, output / destination)

    (output / 'desktop-launch.json').write_text(
        '{"profile":"../betterncm","autoStartClient":true}\n', encoding='utf-8')
    (output / '使用说明.txt').write_text(
        '双击 MineradioLyrics.exe 启动。界面使用系统的 Microsoft Edge WebView2 Evergreen Runtime。\n'
        '如缺少该运行时，请从程序提示的微软页面安装，然后重新启动。\n'
        '网易云与 BetterNCM / InfLink 的连接方法见连接说明.txt。\n'
        'Ctrl+Alt+H 显隐，Ctrl+Alt+L 锁定或解锁，Ctrl+Alt+S 打开设置。\n',
        encoding='utf-8')

    provenance = {
        'format': 'windows-webview2-evergreen',
        'version': PACKAGE['version'],
        'fileVersion': file_version,
        'sourceCommit': commit,
        'sourceHadChanges': changed,
        'appId': IDENTITY['appId'],
        'nodeVersion': RUNTIME['node']['version'],
        'nodeSha256': digest(output / 'resources/node.exe'),
        'webview2SdkVersion': RUNTIME['webview2Sdk']['version'],
        'executableSha256': digest(output / executable.name),
        'applicationHashes': {name: digest(app / name) for name in APP_FILES},
    }
    (output / 'build-provenance.json').write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'output': str(output), 'windowsExecutable': executable.name,
        'version': PACKAGE['version'], 'node': provenance['nodeVersion'],
        'payloadBytes': sum(file.stat().st_size for file in output.rglob('*') if file.is_file()),
    }, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    build(parser.parse_args().output)
