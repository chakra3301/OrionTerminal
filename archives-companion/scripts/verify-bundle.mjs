import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.resolve(process.argv[2] ?? '');
if (!bundle.endsWith('.app')) throw new Error('Pass the signed iOS .app path.');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const file of ['EditorWeb/editor.html', 'PrivacyInfo.xcprivacy']) {
  const source = path.join(root, 'ArchivesiOS', file);
  const embedded = path.join(bundle, path.basename(file));
  if (hash(source) !== hash(embedded)) throw new Error('Missing/stale bundle resource: ' + file);
}
for (const name of fs.readdirSync(path.join(root, 'ArchivesiOS/Legal'))) {
  if (hash(path.join(root, 'ArchivesiOS/Legal', name)) !== hash(path.join(bundle, 'Legal', name))) throw new Error('Missing/stale license material: ' + name);
}
for (const font of ['SpaceGrotesk.ttf', 'JetBrainsMono.ttf']) {
  if (!fs.existsSync(path.join(bundle, font))) throw new Error('Missing font: ' + font);
}
const version = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(bundle, 'Info.plist')], { encoding: 'utf8' }).trim();
if (version !== '0.2') throw new Error('Unexpected release version: ' + version);
execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
console.log('Signed bundle, editor, fonts, privacy manifest and legal/source bytes verified.');
