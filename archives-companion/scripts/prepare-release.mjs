import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.resolve(root, '..');
const editor = path.join(root, 'editor-web');
const legal = path.join(root, 'ArchivesiOS/Legal');
fs.mkdirSync(legal, { recursive: true });
// Keep mobile callout serialization exactly aligned with the desktop implementation.
fs.copyFileSync(path.join(desktop, 'src/features/notes/noteSchema.tsx'), path.join(editor, 'src/noteSchema.tsx'));
execFileSync('npm', ['run', 'build'], { cwd: editor, stdio: 'inherit' });
execFileSync('npm', ['audit', '--omit=dev', '--audit-level=high'], { cwd: editor, stdio: 'inherit' });
fs.copyFileSync(path.join(editor, 'dist/index.html'), path.join(root, 'ArchivesiOS/EditorWeb/editor.html'));
const lock = JSON.parse(fs.readFileSync(path.join(editor, 'package-lock.json')));
const supplement = {
  '@mantine/core': 'mantine-core-7.17.8-LICENSE',
  '@mantine/hooks': 'mantine-hooks-7.17.8-LICENSE',
  '@mantine/utils': 'mantine-core-7.17.8-LICENSE',
  'react-remove-scroll-bar': 'react-remove-scroll-bar-2.3.8-MIT.txt',
};
const text = ['Archives Companion 0.2\nOriginal code: Apache-2.0\n\n' + fs.readFileSync(path.join(desktop, 'LICENSE'), 'utf8')];
const inventory = [];
for (const [relative, metadata] of Object.entries(lock.packages).sort()) {
  if (!relative || metadata.dev) continue;
  const directory = path.join(editor, relative);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  if (manifest.version !== metadata.version) throw new Error('Installed package differs from lock: ' + relative);
  let files = fs.readdirSync(directory).filter(name => /^(license|licence|copying|notice)([._-]|$)/i.test(name) && fs.statSync(path.join(directory, name)).isFile());
  let license = files.map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n\n');
  if (!license && supplement[manifest.name]) license = fs.readFileSync(path.join(desktop, 'THIRD_PARTY_LICENSES', supplement[manifest.name]), 'utf8');
  if (!license && manifest.name === 'use-composed-ref' && manifest.license === 'MIT') {
    license = 'Upstream package.json declares MIT; the package and repository do not include a separate copyright notice. Repository: https://github.com/Andarist/use-composed-ref (1.4.0, ea2c9d969f2f90a349f4c99338b806423824cea2). Standard MIT terms follow; no copyright attribution is invented.\n\n' + fs.readFileSync(path.join(desktop, 'THIRD_PARTY_LICENSES/MIT-template.txt'), 'utf8').replace('Copyright (c) <year> <copyright holders>', 'Copyright notice not supplied by upstream.');
  }
  if (!license) throw new Error('Missing license for ' + manifest.name);
  text.push(`\n\n=== ${manifest.name} ${manifest.version} (${manifest.license}) ===\n${license}`);
  inventory.push({ name: manifest.name, version: manifest.version, license: manifest.license, integrity: metadata.integrity });
  if (manifest.license === 'MPL-2.0') {
    const filename = manifest.name.replace(/^@/, '').replace('/', '-') + '-' + manifest.version + '.tgz';
    const source = path.join(desktop, 'THIRD_PARTY_SOURCES', filename);
    const bytes = fs.readFileSync(source);
    const integrity = 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');
    if (integrity !== metadata.integrity) throw new Error('MPL source integrity mismatch: ' + filename);
    fs.copyFileSync(source, path.join(legal, filename));
  }
}
for (const font of ['space-grotesk', 'jetbrains-mono']) {
  text.push(`\n\n=== Font: ${font} ===\n` + fs.readFileSync(path.join(desktop, 'node_modules/@fontsource', font, 'LICENSE'), 'utf8'));
}
const grdb = path.join(root, 'ArchivesCore/.build/checkouts/GRDB.swift/LICENSE');
text.push('\n\n=== GRDB.swift ===\n' + fs.readFileSync(grdb, 'utf8'));
fs.writeFileSync(path.join(legal, 'Acknowledgements.txt'), text.join('\n'));
fs.writeFileSync(path.join(legal, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'ArchivesSyncHelper/Acknowledgements.txt'), 'Archives Sync Helper — Apache-2.0\n\n' + fs.readFileSync(path.join(desktop, 'LICENSE'), 'utf8') + '\n\nGRDB.swift\n' + fs.readFileSync(grdb, 'utf8'));
console.log(`Prepared editor, ${inventory.length} dependency notices, fonts and matching MPL sources.`);
