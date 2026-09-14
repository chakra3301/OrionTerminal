import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkDistributionLicenses } from './check-distribution-licenses.mjs';

export function packageForModule(id) {
  if (id.startsWith('\0') || !id.replaceAll('\\', '/').includes('/node_modules/')) return null;
  let dir = path.dirname(id.split('?')[0]);
  while (dir !== path.dirname(dir)) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.name && data.version) return { ...data, dir };
    }
    dir = path.dirname(dir);
  }
  throw new Error(`No package identity for bundled module: ${id}`);
}

export function licenseFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(licen[sc]e|copying|notice|copyright|unlicense|third[-_]?party.*(?:notice|licen))/i.test(entry.name))
    .map(entry => ({ name: entry.name, text: fs.readFileSync(path.join(dir, entry.name), 'utf8') }));
}

export function frontendLicenses(graph, root = process.cwd()) {
  let sourceManifest;
  return {
    name: `orion-license-inventory-${graph}`,
    apply: 'build',
    buildStart() { sourceManifest = checkDistributionLicenses(root); },
    generateBundle(_options, bundle) {
      const packages = new Map();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of chunk.moduleIds) {
          const pkg = packageForModule(id);
          if (pkg) packages.set(`${pkg.name}@${pkg.version}`, pkg);
        }
      }
      const overrides = JSON.parse(fs.readFileSync(path.join(root, 'resources/frontend-license-overrides.json'), 'utf8'));
      const records = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)).map(pkg => {
        const files = licenseFiles(pkg.dir);
        const override = overrides[`${pkg.name}@${pkg.version}`];
        if (override) {
          if (pkg.license !== override.license) throw new Error('License override does not match package declaration');
          for (const entry of override.files) {
            const file = path.resolve(root, entry.file);
            if (!file.startsWith(path.join(root, 'THIRD_PARTY_LICENSES') + path.sep)) throw new Error('Invalid license override path');
            const data = fs.readFileSync(file);
            if (createHash('sha256').update(data).digest('hex') !== entry.sha256) throw new Error('Pinned license text changed');
            files.push({ name: path.basename(file), text: data.toString('utf8'), origin: entry.origin ?? override.reason });
          }
        }
        return { name: pkg.name, version: pkg.version, license: pkg.license, files };
      });
      const supported = new Set(['MIT', 'MPL-2.0', 'MIT OR Apache-2.0', 'Apache-2.0 OR MIT', 'ISC', 'Apache-2.0', 'OFL-1.1', 'BSD-3-Clause', 'BSD-2-Clause', '(MIT OR GPL-3.0-or-later)', 'Unlicense', '0BSD']);
      for (const pkg of records) {
        if (pkg.license && !supported.has(pkg.license)) throw new Error(`Unreviewed frontend license: ${pkg.name} (${pkg.license})`);
        if (pkg.license === 'MPL-2.0' && !sourceManifest?.sources.some(source => source.name === pkg.name && source.version === pkg.version)) throw new Error(`Matching MPL source is missing: ${pkg.name}@${pkg.version}`);
      }
      const missing = records.filter(pkg => !pkg.license || !pkg.files.length);
      if (missing.length) throw new Error(`Missing license declaration/text: ${missing.map(pkg => `${pkg.name}@${pkg.version}`).join(', ')}`);
      // Workers are built independently; content-addressed names prevent their
      // notices from replacing one another or the main graph's inventory.
      const content = JSON.stringify(records, null, 2);
      const digest = createHash('sha256').update(content).digest('hex').slice(0, 16);
      const base = `licenses/${graph}-${digest}`;
      this.emitFile({ type: 'asset', fileName: `${base}.json`, source: content });
      this.emitFile({ type: 'asset', fileName: `${base}.md`, source: '# Frontend package notices\n\n' + records.map(pkg => `## ${pkg.name}@${pkg.version} (${pkg.license})\n\n` + pkg.files.map(file => `### ${file.name}\n\n${file.text}\n`).join('\n')).join('\n') });
    },
  };
}

export function excludeFinderMetadata() {
  let outDir;
  return {
    name: 'orion-exclude-finder-metadata',
    apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    closeBundle() {
      if (!outDir || !fs.existsSync(outDir)) return;
      const visit = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) visit(file);
          else if (entry.name === '.DS_Store') fs.unlinkSync(file);
        }
      };
      visit(outDir);
    },
  };
}
