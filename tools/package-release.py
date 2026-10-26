"""Build a clean offline Windows x64 ZIP, without executing Electron or tests."""
import argparse, hashlib, json, pathlib, struct, subprocess, zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--electron-dist', help='Optional existing pinned Electron dist directory')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
output = (root / args.output).resolve()
if output.exists():
    raise SystemExit('Preserve existing artifact; choose a new output filename')
output.parent.mkdir(parents=True, exist_ok=True)
runtime = pathlib.Path(args.electron_dist).resolve() if args.electron_dist else root / 'node_modules/electron/dist'
package = json.loads((root / 'package.json').read_text(encoding='utf8'))
version = package['version']
if (runtime / 'version').read_text().strip().lstrip('v') != package['devDependencies']['electron']:
    raise SystemExit('Electron version mismatch')
binary = (runtime / 'electron.exe').read_bytes()
pe = struct.unpack_from('<I', binary, 0x3c)[0]
if binary[pe:pe+4] != b'PE\0\0' or struct.unpack_from('<H', binary, pe+4)[0] != 0x8664:
    raise SystemExit('Requires Windows x64 Electron')
for name in ('LICENSE', 'LICENSES.chromium.html'):
    if not (runtime / name).is_file():
        raise SystemExit('Missing runtime license: ' + name)
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode('utf8').split('\0')
folders = ('src/', 'public/', 'vendor/', 'plugins/', 'fixtures/', 'tests/', 'docs/', 'tools/')
top = {'.gitignore', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'NOTICE.md',
       'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'lyrics-bindings.example.json',
       '启动桌面歌词.cmd', '退出桌面歌词.cmd'}
files = [n for n in tracked if n and (n in top or n.startswith(folders))]
for name in files:
    if pathlib.PurePosixPath(name).name in ('connection.json', 'launch.json', 'host.json', 'lyrics-settings.json'):
        raise SystemExit('Runtime configuration in tracked source')
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip()
manifest = {'version': version, 'commit': commit, 'electron': package['devDependencies']['electron'],
            'platform': 'win32-x64', 'testsRunForRelease': False,
            'scope': 'Official client and native plugins not bundled; no user configuration',
            'sourceHashes': {n: sha(root/n) for n in files},
            'runtimeHashes': {p.relative_to(runtime).as_posix(): sha(p) for p in runtime.rglob('*') if p.is_file()}}
prefix = 'Mineradio-Desktop-Lyrics-' + version + '/'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
    for name in files:
        archive.write(root/name, prefix+name)
    for file in runtime.rglob('*'):
        if file.is_file():
            archive.write(file, prefix+'node_modules/electron/dist/'+file.relative_to(runtime).as_posix())
    archive.writestr(prefix+'build-provenance.json', json.dumps(manifest, ensure_ascii=False, indent=2))
with zipfile.ZipFile(output) as archive:
    names = archive.namelist()
    if len(names) != len(set(names)) or archive.testzip() is not None:
        raise SystemExit('ZIP integrity failure')
digest = sha(output)
output.with_name('SHA256SUMS.txt').write_text(digest+'  '+output.name+'\n', encoding='utf8')
print(json.dumps({'file': output.name, 'bytes': output.stat().st_size, 'sha256': digest, 'commit': commit}))
