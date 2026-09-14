import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const sha256 = data => createHash('sha256').update(data).digest('hex');

export function checkDistributionLicenses(root) {
  root = fs.realpathSync(root);
  const read = relative => {
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.realpathSync(file).startsWith(root + path.sep) || fs.lstatSync(file).isSymbolicLink()) throw new Error('License material path leaves the repository');
    return fs.readFileSync(file);
  };
  const manifest = JSON.parse(read('resources/distribution-license-manifest.json'));
  if (manifest.target !== 'aarch64-apple-darwin') throw new Error('Unreviewed license target');
  for (const [file, key] of [['package-lock.json', 'npmLockSha256'], ['src-tauri/Cargo.lock', 'cargoLockSha256'], ['src-tauri/Cargo.toml', 'cargoManifestSha256']]) {
    if (sha256(read(file)) !== manifest[key]) throw new Error(`License inventory is stale: ${file}. Review and prepare matching materials.`);
  }
  if (!manifest.native?.length || !manifest.sources?.length) throw new Error('Empty license/source inventory');
  for (const pkg of manifest.native) {
    if (!pkg.license || sha256(read(pkg.notice)) !== pkg.noticeSha256) throw new Error(`Missing or changed native notice: ${pkg.name}`);
    if (pkg.license === 'MPL-2.0' && !manifest.sources.some(source => source.name === pkg.name && source.version === pkg.version)) throw new Error(`Missing MPL source: ${pkg.name}`);
  }
  for (const entry of manifest.adapted ?? []) {
    if (sha256(read(entry.notice)) !== entry.noticeSha256) throw new Error(`Changed adapted-source notice: ${entry.name}`);
  }
  for (const source of manifest.sources) {
    if (sha256(read(source.file)) !== source.sha256) throw new Error(`Missing or changed source archive: ${source.name}`);
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = checkDistributionLicenses(process.cwd());
  console.log(`Verified license materials: ${manifest.native.length} native notices; ${manifest.sources.length} source archives (${manifest.target}). Not blanket rights clearance.`);
}
