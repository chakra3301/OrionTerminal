import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDistributionLicenses, sha256 } from './check-distribution-licenses.mjs';
import { packageForModule, frontendLicenses, excludeFinderMetadata } from './frontend-licenses.mjs';

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-license-test-'));
  const put = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file; };
  try {
    put('package-lock.json', '{}'); put('src-tauri/Cargo.lock', 'lock'); put('src-tauri/Cargo.toml', 'manifest');
    put('notice.txt', 'license'); put('source.tgz', 'source');
    put('resources/frontend-license-overrides.json', '{}');
    const manifest = { target: 'aarch64-apple-darwin', npmLockSha256: sha256('{}'), cargoLockSha256: sha256('lock'), cargoManifestSha256: sha256('manifest'), native: [{ name: 'fixture-native', version: '1', license: 'MIT', notice: 'notice.txt', noticeSha256: sha256('license') }], sources: [{ name: 'fixture-mpl', version: '1', file: 'source.tgz', sha256: sha256('source') }] };
    put('resources/distribution-license-manifest.json', JSON.stringify(manifest));
    run({ root, put, manifest });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function render(root, ids, graph = 'worker') {
  const plugin = frontendLicenses(graph, root); const assets = [];
  plugin.buildStart();
  plugin.generateBundle.call({ emitFile: file => assets.push(file) }, {}, { chunk: { type: 'chunk', moduleIds: ids } });
  return assets;
}

test('collects independent worker notices and supplementary copyright files', () => fixture(({ root, put }) => {
  put('node_modules/fixture/package.json', JSON.stringify({ name: 'fixture', version: '1', license: 'MIT' }));
  put('node_modules/fixture/LICENSE', 'MIT fixture'); put('node_modules/fixture/ThirdPartyNotices.txt', 'additional copyright');
  put('node_modules/fixture/esm/package.json', '{"type":"module"}');
  const id = put('node_modules/fixture/esm/index.js', 'export {}');
  assert.equal(packageForModule(id).name, 'fixture'); assert.equal(packageForModule('\0virtual'), null);
  const assets = render(root, [id]); const record = JSON.parse(assets.find(a => a.fileName.endsWith('.json')).source)[0];
  assert.equal(record.files.length, 2); assert.match(assets[0].fileName, /^licenses\/worker-[a-f0-9]+\.json$/);
  assert.notEqual(render(root, [id], 'main')[0].fileName, assets[0].fileName);
}));

test('reports all missing notices in a graph and refuses unreviewed license declarations', () => fixture(({ root, put }) => {
  const ids = ['one', 'two'].map(name => { put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1', license: 'MIT' })); return put(`node_modules/${name}/index.js`, ''); });
  assert.throws(() => render(root, ids), /one@1, two@1/);
  put('node_modules/one/LICENSE', 'terms'); put('node_modules/one/package.json', '{"name":"one","version":"1","license":"GPL-3.0-only"}');
  assert.throws(() => render(root, [ids[0]]), /Unreviewed frontend license/);
}));

test('refuses MPL packages without matching distributed source', () => fixture(({ root, put }) => {
  put('node_modules/library/package.json', '{"name":"library","version":"1","license":"MPL-2.0"}'); put('node_modules/library/LICENSE', 'MPL');
  const id = put('node_modules/library/index.js', '');
  assert.throws(() => render(root, [id]), /Matching MPL source is missing/);
}));

test('checks exact-version notice overrides and refuses changed text', () => fixture(({ root, put }) => {
  put('node_modules/library/package.json', '{"name":"library","version":"1","license":"MIT"}'); const id = put('node_modules/library/index.js', '');
  put('THIRD_PARTY_LICENSES/extra.txt', 'upstream');
  put('resources/frontend-license-overrides.json', JSON.stringify({ 'library@1': { license: 'MIT', reason: 'pinned evidence', files: [{ file: 'THIRD_PARTY_LICENSES/extra.txt', sha256: sha256('upstream') }] } }));
  assert.equal(JSON.parse(render(root, [id])[0].source)[0].files[0].text, 'upstream');
  put('THIRD_PARTY_LICENSES/extra.txt', 'changed'); assert.throws(() => render(root, [id]), /Pinned license text changed/);
}));

test('rejects stale locks, altered archives, and escaping material paths', () => fixture(({ root, put, manifest }) => {
  checkDistributionLicenses(root);
  put('package-lock.json', 'changed'); assert.throws(() => checkDistributionLicenses(root), /inventory is stale/); put('package-lock.json', '{}');
  put('source.tgz', 'changed'); assert.throws(() => checkDistributionLicenses(root), /changed source archive/); put('source.tgz', 'source');
  manifest.sources[0].file = '../outside'; put('resources/distribution-license-manifest.json', JSON.stringify(manifest));
  assert.throws(() => checkDistributionLicenses(root), /leaves the repository/);
}));

test('excludes only generated Finder metadata without deleting original inputs', () => fixture(({ root, put }) => {
  const original = put('public/.DS_Store', 'private metadata'); put('dist/nested/.DS_Store', 'copy'); const keep = put('dist/nested/keep.txt', 'keep');
  const plugin = excludeFinderMetadata(); plugin.configResolved({ root, build: { outDir: 'dist' } }); plugin.closeBundle();
  assert.ok(fs.existsSync(original)); assert.ok(fs.existsSync(keep)); assert.ok(!fs.existsSync(path.join(root, 'dist/nested/.DS_Store')));
}));

test('checked-in distribution material is complete and configured for app bundling', () => {
  const manifest = checkDistributionLicenses(process.cwd());
  assert.ok(manifest.native.length > 300); assert.equal(manifest.sources.length, 8);
  const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json'));
  for (const item of ['../THIRD_PARTY_LICENSES', '../THIRD_PARTY_SOURCES', '../resources/distribution-license-manifest.json', '../dist/licenses']) assert.ok(config.bundle.resources.includes(item));
  assert.ok(fs.readFileSync('src/apps/xdesign/fx/fxModel.ts', 'utf8').includes('${noiseLicense}'));
});
