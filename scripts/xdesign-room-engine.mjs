import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { frontendLicenses } from './frontend-licenses.mjs';

export async function roomEngine({ includeClient = false } = {}) {
  const contents = 'export { SharedDesign } from "./src/apps/xdesign/pencil/sharedDesign.ts"; export { validateSharedDocumentId } from "./src/apps/xdesign/pencil/sharedCheckpoint.ts"; export * from "./src/apps/xdesign/pencil/sharedRoomProtocol.ts"; export * from "./src/apps/xdesign/pencil/roomPresenceProtocol.ts"; export * from "./src/apps/xdesign/pencil/roomCommentPolicy.ts"; export * from "./src/apps/xdesign/pencil/roomCommentProtocol.ts"; export * from "./src/apps/xdesign/pencil/roomCommentCommands.ts"; export * from "./src/apps/xdesign/pencil/roomCommentHistory.ts"; export {allComments} from "./src/apps/xdesign/pencil/comments.ts";' + (includeClient ? 'export { SharedRoomConnection, RoomRequestFailure } from "./src/apps/xdesign/pencil/sharedRoomConnection.ts";' : '');
  const entry = contents + 'export * from "./src/apps/xdesign/pencil/roomAuthorProtocol.ts"; export * from "./src/apps/xdesign/pencil/roomLibraryProtocol.ts"; export * from "./src/apps/xdesign/pencil/roomImageProtocol.ts"; export * from "./src/apps/xdesign/pencil/roomImageReferences.ts";' + 'export * from "./src/apps/xdesign/pencil/roomRawUpdate.ts"; export { encodeSharedValue } from "./src/apps/xdesign/pencil/sharedValue.ts";';
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd() }, banner: { js: 'import { createRequire as __orionRoomRequireFactory } from "node:module"; const require = __orionRoomRequireFactory(process.cwd() + "/package.json");' }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022', metafile: true, legalComments: 'inline', logLevel: 'silent' });
  const files = Object.keys(result.metafile.inputs).filter(name => !name.startsWith('<'));
  if (files.some(name => /src\/apps\/xdesign\/(store\.ts|pencil\/(runtime|sharedEditor|toolExecution)\.ts)/.test(name))) throw new Error('The room service must not import editor actions or app persistence.');
  const licenseAssets = [], licensePlugin = frontendLicenses('xdesign-room');
  licensePlugin.buildStart();
  licensePlugin.generateBundle.call({ emitFile: asset => licenseAssets.push(asset) }, {}, { engine: { type: 'chunk', moduleIds: files.map(name => resolve(name)) } });
  const notices = JSON.parse(licenseAssets.find(asset => asset.fileName.endsWith('.json')).source);
  const source = result.outputFiles[0].text + '\nexport const roomNotices = ' + JSON.stringify(notices) + ';\n';
  const hashes = Object.fromEntries(await Promise.all(files.map(async name => [name, createHash('sha256').update(await readFile(name)).digest('hex')])));
  const folder = await mkdtemp(join(tmpdir(), 'xdesign-room-engine-'));
  try {
    const path = join(folder, 'engine.mjs'); await writeFile(path, source);
    const api = await import(pathToFileURL(path).href);
    return { api, sourceSha256: createHash('sha256').update(source).digest('hex'), bytes: Buffer.byteLength(source), inputs: hashes, notices, licenseAssets, warnings: result.warnings.map(value => value.text) };
  } finally { await rm(folder, { recursive: true, force: true }); }
}
