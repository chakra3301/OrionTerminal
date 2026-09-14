#!/usr/bin/env python3
"""Explicit license/source preparation for the locked Apple Silicon distribution.

Reads Cargo's selected normal/build graph; downloads only locked npm source
archives and reviewed, commit-pinned missing upstream notices. Never runs them.
"""
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import urllib.request

if sys.version_info < (3, 11):
    raise SystemExit('License preparation requires Python 3.11+ (standard-library TOML reader)')
import tomllib

ROOT = Path(__file__).resolve().parents[1]
TARGET = 'aarch64-apple-darwin'
TEXT = re.compile(r'(?i)^(licen[sc]e|copying|notice|copyright|unlicense|third[-_]?party.*(?:notice|licen))')

def digest(data): return hashlib.sha256(data).hexdigest()
def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode())
def fetch(url):
    if not url.startswith(('https://registry.npmjs.org/', 'https://raw.githubusercontent.com/')):
        raise ValueError('Unreviewed license/source host')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Orion-license-materials'}), timeout=30) as response:
        if not response.url.startswith(('https://registry.npmjs.org/', 'https://raw.githubusercontent.com/')):
            raise ValueError('Unreviewed redirect')
        data = response.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024: raise ValueError('Source download exceeds 32MiB')
    return data

def verify_source(data, root, prefix, required_src=False):
    count = 0
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive.getmembers():
            if member.isdir(): continue
            if not member.isfile() or not member.name.startswith(prefix + '/'):
                raise ValueError('Unsupported source archive entry')
            relative = Path(member.name[len(prefix) + 1:])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Unsafe source archive path')
            total += member.size
            if total > 100 * 1024 * 1024 or member.size > 16 * 1024 * 1024:
                raise ValueError('Source archive exceeds bounds')
            original = archive.extractfile(member).read()
            installed = root / relative
            if not installed.is_file() or installed.is_symlink() or installed.read_bytes() != original:
                raise ValueError(f'Installed package differs from published source: {root.name}/{relative}')
            if relative.parts[0] == 'src' or relative.suffix == '.rs': count += 1
    if required_src and not count: raise ValueError('Archive has no preferred-form source directory')
    return count

def prepare():
    cargo = lambda args: subprocess.check_output(['cargo', *args], cwd=ROOT/'src-tauri', timeout=90).decode()
    metadata = json.loads(cargo(['metadata', '--locked', '--offline', '--filter-platform', TARGET, '--format-version', '1']))
    tree = cargo(['tree', '--locked', '--offline', '--color', 'never', '--target', TARGET, '--features', 'tauri/custom-protocol', '--edges', 'normal,build', '--prefix', 'none', '--format', '{p}'])
    selected = {tuple(m.groups()) for line in tree.splitlines() if (m := re.match(r'([^ ]+) v([^ ]+)', line))}
    packages = sorted((p for p in metadata['packages'] if (p['name'], p['version']) in selected and p['name'] != 'orion-terminal'), key=lambda p: (p['name'], p['version']))
    if len({(p['name'], p['version']) for p in packages}) != len(packages):
        raise ValueError('Ambiguous same-version native package sources require review')
    checksums = {(p['name'], p['version'], p.get('source')): p.get('checksum') for p in tomllib.loads((ROOT/'src-tauri/Cargo.lock').read_text())['package']}
    overrides = json.loads((ROOT/'resources/native-license-upstreams.json').read_text())
    output = ROOT/'THIRD_PARTY_LICENSES/native'
    sources = ROOT/'THIRD_PARTY_SOURCES'
    manifest = {'target': TARGET, 'scope': 'Selected native normal/build graph; build-only crates conservatively included', 'cargoLockSha256': digest((ROOT/'src-tauri/Cargo.lock').read_bytes()), 'cargoManifestSha256': digest((ROOT/'src-tauri/Cargo.toml').read_bytes()), 'npmLockSha256': digest((ROOT/'package-lock.json').read_bytes()), 'native': [], 'sources': []}
    for package in packages:
        name, version = package['name'], package['version']
        root = Path(package['manifest_path']).parent
        key = f'{name}@{version}'
        texts = []
        for file in sorted(root.rglob('*')):
            if file.is_file() and not file.is_symlink() and (TEXT.match(file.name) or 'licenses' in [p.lower() for p in file.relative_to(root).parts[:-1]]):
                if file.stat().st_size > 2 * 1024 * 1024: raise ValueError('Unexpected license text size')
                texts.append((str(file.relative_to(root)), file.read_text(), 'published crate'))
        for extra in overrides.get(key, []):
            if 'file' in extra:
                file = (ROOT/extra['file']).resolve()
                if not file.is_relative_to(ROOT/'THIRD_PARTY_LICENSES'): raise ValueError('Invalid local license path')
                data = file.read_bytes()
            else:
                data = fetch(extra['url'])
            if digest(data) != extra['sha256']: raise ValueError('Pinned upstream notice changed')
            texts.append((extra['name'], data.decode(), extra.get('url', extra.get('origin'))))
        if not texts or not package['license']: raise ValueError(f'Missing native notice: {key}')
        notice = f"# {key}\n\nDeclared license: {package['license']}\n\nRepository: {package.get('repository')}\n\n"
        notice += '\n'.join(f'## {name}\n\nSource: {origin}\n\n{text}\n' for name, text, origin in texts)
        relative = f'THIRD_PARTY_LICENSES/native/{name}-{version}.md'
        write(ROOT/relative, notice)
        checksum = checksums[(name, version, package['source'])]
        if not checksum: raise ValueError(f'No locked registry checksum: {key}')
        manifest['native'].append({'name': name, 'version': version, 'license': package['license'], 'crateSha256': checksum, 'notice': relative, 'noticeSha256': digest(notice.encode())})
        if package['license'] == 'MPL-2.0':
            archive = root.parent.parent.parent/'cache'/root.parent.name/f'{root.name}.crate'
            data = archive.read_bytes()
            if digest(data) != checksum: raise ValueError('Crate source checksum mismatch')
            count = verify_source(data, root, root.name)
            path = f'THIRD_PARTY_SOURCES/{root.name}.crate'; write(ROOT/path, data)
            manifest['sources'].append({'name': name, 'version': version, 'license': 'MPL-2.0', 'file': path, 'sha256': digest(data), 'preferredSourceFiles': count, 'origin': f'https://crates.io/crates/{name}/{version}'})
    lock = json.loads((ROOT/'package-lock.json').read_text())['packages']
    for name in ['@blocknote/core', '@blocknote/react', '@blocknote/mantine']:
        key = f'node_modules/{name}'; pkg = lock[key]; root = ROOT/key
        if pkg.get('license') != 'MPL-2.0': raise ValueError('BlockNote licensing changed; review source policy')
        path = f"THIRD_PARTY_SOURCES/{name.replace('@', '').replace('/', '-')}-{pkg['version']}.tgz"
        data = (ROOT/path).read_bytes() if (ROOT/path).exists() else fetch(pkg['resolved'])
        algorithm, expected = pkg['integrity'].split('-', 1)
        if algorithm != 'sha512' or base64.b64encode(hashlib.sha512(data).digest()).decode() != expected:
            raise ValueError('npm source integrity mismatch')
        count = verify_source(data, root, 'package', required_src=True)
        write(ROOT/path, data)
        manifest['sources'].append({'name': name, 'version': pkg['version'], 'license': 'MPL-2.0', 'file': path, 'sha256': digest(data), 'integrity': pkg['integrity'], 'preferredSourceFiles': count, 'origin': pkg['resolved']})
    manifest['adapted'] = json.loads((ROOT/'resources/adapted-license-upstreams.json').read_text())
    for entry in manifest['adapted']:
        if digest((ROOT/entry['notice']).read_bytes()) != entry['noticeSha256']:
            raise ValueError(f"Changed adapted-source notice: {entry['name']}")
    write(ROOT/'resources/distribution-license-manifest.json', json.dumps(manifest, indent=2)+'\n')
    print(f"Prepared {len(packages)} native package notices and {len(manifest['sources'])} matching MPL source archives")

if __name__ == '__main__': prepare()
