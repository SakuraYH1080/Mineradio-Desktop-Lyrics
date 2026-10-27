"""Create a directory-style Windows GUI build from the pinned local Electron.

No installer, account/profile data, system font files or external build tools are
used. The destination must be new: this script never clears an existing build.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone
from windows_icon import embed_icon


def digest(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def git(root, *args):
    # A corresponding-source ZIP deliberately has no private Git history.
    if not (root / '.git').exists():
        if args and args[0] == 'ls-files':
            return '\0'.join(file.relative_to(root).as_posix() for directory in ['public','vendor']
                             for file in (root/directory).rglob('*') if file.is_file())
        if args and args[0] == 'rev-parse':
            marker=root/'SOURCE_COMMIT.txt'
            return marker.read_text(encoding='utf-8').strip() if marker.is_file() else 'source-snapshot'
        return 'source-snapshot-without-git-index' if args and args[0]=='status' else ''
    return subprocess.check_output(['git', '-C', str(root), *args]).decode('utf-8')


def build(output):
    root = Path(__file__).resolve().parent.parent
    package = json.loads((root / 'package.json').read_text(encoding='utf-8-sig'))
    identity = json.loads((root / 'build/windows-app.json').read_text(encoding='utf-8'))
    executable_name = identity['win']['executableName'] + '.exe'
    icon_file = root / identity['win']['icon']
    electron = root / 'node_modules/electron'
    runtime = electron / 'dist'
    version = json.loads((electron / 'package.json').read_text(encoding='utf-8-sig'))['version']
    if version != '42.4.1' or (runtime / 'version').read_text(encoding='utf-8').strip() != version:
        raise SystemExit('Expected the already installed Electron 42.4.1 runtime.')
    if not (runtime / 'electron.exe').is_file():
        raise SystemExit('Windows Electron runtime is not present locally.')
    output = output.resolve()
    if output.exists():
        raise SystemExit('Preserve the existing destination; choose a new output directory.')
    if output == root or root.is_relative_to(output):
        raise SystemExit('The build directory must not be an ancestor of the source tree.')

    # Include tracked and current untracked application assets, never a broad
    # source-tree copy that could pull private profiles, logs or runtime tokens.
    asset_names = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'public', 'vendor').split('\0')
    suffixes = {'.html', '.css', '.js', '.svg', '.png', '.ico', '.jpg', '.jpeg', '.webp', '.woff2', '.md', '.txt'}
    assets = []
    for name in sorted(set(asset_names)):
        if not name:
            continue
        file = root / name
        if not file.is_file() or file.suffix.lower() not in suffixes:
            continue
        if any(part.startswith('.') or part.lower() in {'cache', 'logs', 'backups', 'profile'} for part in Path(name).parts):
            continue
        if file.suffix.lower() == '.woff2' and not (name.startswith('public/fonts/InstrumentSans-') and (root / 'public/fonts/OFL.txt').is_file()):
            raise SystemExit('An unrecognized font file requires an explicit license review before bundling.')
        assets.append(name)
    sources = sorted(file.relative_to(root).as_posix() for file in (root / 'src').glob('*.cjs')
                     if file.is_file() and not file.stem.endswith('-qa') and file.name != 'replay.cjs')
    # Preview sheets / size-by-size artwork belong in source, not the installed app.
    assets = [name for name in assets if name != 'public/icons/icon-preview.png'
              and not (name.startswith(('public/icons/app-', 'public/icons/tray-')) and name.endswith('.png'))]
    required = [
        'src/desktop-main.cjs', 'src/desktop-startup.cjs', 'src/main.cjs',
        'public/settings.html', 'public/settings.js', 'public/settings.css',
        'public/lyric-typography.js', 'public/desktop-typography.js',
        'public/settings-glass.js', 'public/assets/settings/hero-duo.png', 'public/assets/settings/chibi.png',
        'vendor/desktop-lyrics.html', 'vendor/overlay-preload.js', 'vendor/lyrics-fetch-parse.js',
        'public/fonts/OFL.txt',
        'public/icons/app.svg', 'public/icons/app.png', 'public/icons/app.ico',
        'public/icons/tray.svg', 'public/icons/tray.png', 'public/icons/tray.ico',
        'build/windows-app.json',
    ]
    helpers = ['tools/mouse-poll.ps1', 'tools/probe.ps1']
    bridge = ['plugins/MineradioBridge/'+name for name in ['manifest.json','index.js','header-compat.js','pcm-freshness.js','pcm-analyzer.js']]
    documentation = ['docs/INSTALL_1.0_RC.md','docs/THIRD_PARTY_RC.md']
    names = sorted(set(sources + assets + helpers + bridge + documentation + ['LICENSE', 'NOTICE.md', 'build/windows-app.json', 'build/licenses/NSIS-COPYING.txt']))
    for name in required + names:
        if name not in names or not (root / name).is_file():
            raise SystemExit('Missing required runtime resource: ' + name)

    output.mkdir(parents=True)
    for item in sorted(runtime.iterdir()):
        if item.name == 'resources':
            # The default Electron launcher must not win over resources/app.
            shutil.copytree(item, output / item.name,
                            ignore=lambda _directory, entries: [name for name in entries if name == 'default_app.asar'])
        elif item.name == 'electron.exe':
            shutil.copy2(item, output / executable_name)
        elif item.name == 'LICENSE':
            shutil.copy2(item, output / 'LICENSE.electron.txt')
        elif item.is_dir():
            shutil.copytree(item, output / item.name)
        else:
            shutil.copy2(item, output / item.name)
    application = output / 'resources/app'
    icon_resources = embed_icon(output / executable_name, icon_file)
    application.mkdir(parents=True)
    hashes = {}
    for name in names:
        destination = application / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, destination)
        hashes[name] = digest(destination)
    application_package = {
        'name': 'mineradio-desktop-lyrics', 'productName': identity['productName'],
        'version': package['version'], 'private': True, 'license': 'GPL-3.0-only',
        'main': 'src/desktop-main.cjs',
    }
    package_file = application / 'package.json'
    package_file.write_text(json.dumps(application_package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    hashes['package.json'] = digest(package_file)
    for name in ['LICENSE', 'NOTICE.md']:
        shutil.copy2(root / name, output / name)
    (output / 'licenses').mkdir(exist_ok=True)
    shutil.copy2(root / 'build/licenses/NSIS-COPYING.txt', output / 'licenses/NSIS-COPYING.txt')
    shutil.copy2(root / 'docs/INSTALL_1.0_RC.md', output / '连接说明.txt')
    shutil.copy2(root / 'docs/THIRD_PARTY_RC.md', output / '第三方许可说明.txt')
    # This default is relative to the GUI executable, not the shell's cwd. A
    # deployment may supply its actual official-client location in this sidecar.
    (output / 'desktop-launch.json').write_text(json.dumps({
        'profile': '../betterncm', 'autoStartClient': True,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / '使用说明.txt').write_text(
        '双击 MineradioLyrics.exe 启动桌面歌词，无需 Node、npm 或命令行。\n'
        '首次显示真实的网易云路径与插件文件状态；安装歌词程序不代表插件已连接。\n'
        '本包不含网易云客户端、BetterNCM／InfLink二进制；Bridge已内置，首次连接向导可部署到已有profile。\n'
        '按连接说明.txt配置已有原版客户端；仅经确认部署自有Bridge，不替换DLL或复制第二套网易云。\n'
        '个人连接配置与歌词设置保存在独立用户目录；程序旁的desktop-launch.json仅为可选相对路径默认值。\n'
        '设置与日志保存在 %APPDATA%\\MineradioExternalLyrics。\n'
        'Ctrl+Alt+H 显隐，Ctrl+Alt+L 锁定／解锁；从歌词托盘退出不会退出网易云。\n', encoding='utf-8')
    provenance = {
        'format': 'windows-directory-gui', 'version': package['version'],
        'builtAt': datetime.now(timezone.utc).isoformat(),
        'sourceCommit': git(root, 'rev-parse', 'HEAD').strip(),
        'sourceHadChanges': bool(git(root, 'status', '--porcelain', '--', 'src', 'public', 'vendor', 'build', 'tools/build-desktop.py', 'tools/windows_icon.py', 'tools/generate-icons.py').strip()),
        'electronVersion': version,
        'electronSha256': digest(runtime / 'electron.exe'),
        'executableSha256': digest(output / executable_name),
        'appId': identity['appId'],
        'iconSha256': digest(icon_file),
        'iconResources': icon_resources,
        'applicationHashes': hashes,
        'scope': 'Production runtime and read-only Bridge source only; no client binaries, plugin profile, account, system fonts, fixtures, QA harness or session authentication.',
    }
    (output / 'build-provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'executable': str(output / executable_name),
                      'version': package['version'], 'electronVersion': version,
                      'applicationFiles': len(hashes)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New directory; existing paths are never cleared.')
    build(parser.parse_args().output)
