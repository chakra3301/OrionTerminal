import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { SceneGraph } from '@open-pencil/scene-graph';
import { exportFigFile } from '@open-pencil/core/io';
import { parseFigBuffer, writeFigArchive } from '@open-pencil/fig';
import { ByteBuffer, compileSchema, decodeBinarySchema } from '@open-pencil/kiwi/schema-runtime';
import { inflateSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.XDESIGN_WORKER_OUTPUT ?? '/tmp/xdesign-prototype-worker';
await mkdir(output, { recursive: true });
const assets = path.join(root, 'dist/assets');
const name = (await readdir(assets)).find(name => /^figImport\.worker-.*\.js$/.test(name));
assert.ok(name, 'Build the production frontend before checking its importer worker.');
const bundle = path.join(assets, name), bundleBytes = await readFile(bundle);
const graph = new SceneGraph(), page = graph.addPage('Worker proof');
const first = graph.createNode('FRAME', page.id, { name: 'Home' }), second = graph.createNode('FRAME', page.id, { name: 'Details' });
first.source.id = '85:10'; second.source.id = '85:11';
const next = graph.createNode('RECTANGLE', first.id, { name: 'Next' }), legacy = graph.createNode('RECTANGLE', second.id, { name: 'Legacy Back' });
next.source.id = '85:12'; legacy.source.id = '85:13';
next.source.fig.rawNodeFields = { prototypeInteractions: [{ id: { sessionID: 85, localID: 20 }, event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'INTERNAL_NODE', transitionNodeID: { sessionID: 85, localID: 11 }, transitionType: 'DISSOLVE', transitionDuration: 0.25 }] }] };
for (const [index, event] of [
  { interactionType: 'AFTER_TIMEOUT', transitionTimeout: 1.25 },
  { interactionType: 'MOUSE_ENTER', interactionDuration: 0.125 },
  { interactionType: 'MOUSE_LEAVE', interactionDuration: 0 },
  { interactionType: 'ON_KEY_DOWN', keyTrigger: { triggerDevice: 'KEYBOARD', keyCodes: [16, 17, 65] } },
].entries()) next.source.fig.rawNodeFields.prototypeInteractions.push({ id: { sessionID: 85, localID: 21 + index }, event, actions: [{ connectionType: 'INTERNAL_NODE', transitionNodeID: { sessionID: 85, localID: 11 }, transitionType: 'SLIDE_FROM_TOP', transitionDuration: 0.375, easingType: 'CUSTOM_CUBIC', easingFunction: [0.25, 0, 0.75, 1] }] });
legacy.source.fig.rawNodeFields = { connectionType: 'BACK', interactionType: 'ON_CLICK', transitionInfo: { type: 'INSTANT_TRANSITION', duration: 0 } };
const modal = graph.createNode('FRAME', page.id, { name: 'Worker Modal', width: 160, height: 120 }); modal.source.id = '85:14';
modal.source.fig.rawNodeFields = { overlayPositionType: 'MANUAL', overlayBackgroundInteraction: 'CLOSE_ON_CLICK_OUTSIDE', overlayBackgroundAppearance: { backgroundType: 'SOLID_COLOR', backgroundColor: { r: 0.25, g: 0.5, b: 0.75, a: 0.5 } } };
for (const [index, [name, parent, action]] of [
  ['Open Overlay', first.id, { connectionType: 'INTERNAL_NODE', navigationType: 'OVERLAY', transitionNodeID: { sessionID: 85, localID: 14 }, overlayRelativePosition: { x: -12, y: 24 } }],
  ['Swap Overlay', modal.id, { connectionType: 'INTERNAL_NODE', navigationType: 'SWAP', transitionNodeID: { sessionID: 85, localID: 11 } }],
  ['Close Overlay', modal.id, { connectionType: 'CLOSE' }],
].entries()) {
  const node = graph.createNode('RECTANGLE', parent, { name }); node.source.id = `85:${15 + index}`;
  node.source.fig.rawNodeFields = { prototypeInteractions: [{ id: { sessionID: 85, localID: 26 + index }, event: { interactionType: 'ON_CLICK' }, actions: [action] }] };
}
first.source.fig.rawNodeFields = { scrollDirection: 'BOTH', scrollOffset: { x: -12, y: 30 } };
const scrollTarget = graph.createNode('RECTANGLE', first.id, { name: 'Worker Scroll Target', y: 900 }); scrollTarget.source.id = '85:30';
const fixed = graph.createNode('RECTANGLE', first.id, { name: 'Worker Fixed' }); fixed.source.id = '85:31'; fixed.source.fig.rawNodeFields = { scrollBehavior: 'FIXED_WHEN_CHILD_OF_SCROLLING_FRAME' };
const sticky = graph.createNode('RECTANGLE', first.id, { name: 'Worker Sticky' }); sticky.source.id = '85:32'; sticky.source.fig.rawNodeFields = { scrollBehavior: 'STICKY_SCROLLS' };
const scrolling = graph.createNode('RECTANGLE', first.id, { name: 'Worker Scroll Link' }); scrolling.source.id = '85:33'; scrolling.source.fig.rawNodeFields = { prototypeInteractions: [{ id: { sessionID: 85, localID: 40 }, event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'INTERNAL_NODE', navigationType: 'SCROLL_TO', transitionNodeID: { sessionID: 85, localID: 30 }, transitionType: 'SCROLL_ANIMATE', transitionDuration: 0.3, extraScrollOffset: { x: 4, y: -8 } }] }, { id: { sessionID: 85, localID: 41 }, event: { interactionType: 'ON_KEY_DOWN', keyTrigger: { triggerDevice: 'KEYBOARD', keyCodes: [65] } }, actions: [{ connectionType: 'INTERNAL_NODE', navigationType: 'NAVIGATE', transitionNodeID: { sessionID: 85, localID: 11 }, transitionResetScrollPosition: true }] }, { id: { sessionID: 85, localID: 42 }, event: { interactionType: 'ON_KEY_DOWN', keyTrigger: { triggerDevice: 'KEYBOARD', keyCodes: [66] } }, actions: [{ connectionType: 'INTERNAL_NODE', navigationType: 'OVERLAY', transitionNodeID: { sessionID: 85, localID: 14 }, transitionPreserveScroll: true }] }] };
const sequence = graph.createNode('RECTANGLE', first.id, { name: 'Worker Sequence' }); sequence.source.id = '85:34';
sequence.source.fig.rawNodeFields = { prototypeInteractions: [{ id: { sessionID: 85, localID: 43 }, event: { interactionType: 'ON_CLICK' }, actions: [
  { connectionType: 'INTERNAL_NODE', navigationType: 'SCROLL_TO', transitionNodeID: { sessionID: 85, localID: 30 }, transitionType: 'SCROLL_ANIMATE', transitionDuration: 0.25, extraScrollOffset: { x: 4, y: -8 } },
  { connectionType: 'INTERNAL_NODE', navigationType: 'NAVIGATE', transitionNodeID: { sessionID: 85, localID: 11 }, transitionType: 'SLIDE_FROM_TOP', transitionDuration: 0.375, transitionResetScrollPosition: true },
  { connectionType: 'INTERNAL_NODE', navigationType: 'OVERLAY', transitionNodeID: { sessionID: 85, localID: 14 }, overlayRelativePosition: { x: -12, y: 24 } },
  { connectionType: 'CLOSE' }, { connectionType: 'BACK' },
] }] };
graph.addCollection({ id: '85:50', name: 'Worker Variables', defaultModeId: '85:51', modes: [{ modeId: '85:51', name: 'Light' }, { modeId: '85:53', name: 'Dark' }], variableIds: ['85:52', '85:54'] });
graph.addVariable({ id: '85:52', name: 'Worker Count', type: 'FLOAT', collectionId: '85:50', valuesByMode: { '85:51': 0, '85:53': 10 }, description: '', hiddenFromPublishing: false });
graph.addVariable({ id: '85:54', name: 'Worker Shown', type: 'BOOLEAN', collectionId: '85:50', valuesByMode: { '85:51': false, '85:53': true }, description: '', hiddenFromPublishing: false });
const variables = graph.createNode('RECTANGLE', first.id, { name: 'Worker Variable Actions' }); variables.source.id = '85:55';
const countGuid = { sessionID: 85, localID: 52 }, aliasOperand = { dataType: 'ALIAS', resolvedDataType: 'FLOAT', value: { alias: { guid: countGuid } } }, numberOperand = value => ({ dataType: 'FLOAT', resolvedDataType: 'FLOAT', value: { floatValue: value } });
variables.source.fig.rawNodeFields = { prototypeInteractions: [{ id: { sessionID: 85, localID: 56 }, event: { interactionType: 'ON_CLICK' }, actions: [
  { connectionType: 'SET_VARIABLE', targetVariable: { id: { guid: countGuid } }, targetVariableData: { dataType: 'EXPRESSION', resolvedDataType: 'FLOAT', value: { expressionValue: { expressionFunction: 'ADDITION', expressionArguments: [aliasOperand, numberOperand(1)] } } } },
  { connectionType: 'SET_VARIABLE_MODE', targetVariableSetID: { guid: { sessionID: 85, localID: 50 } }, targetVariableModeID: { sessionID: 85, localID: 53 } },
  { connectionType: 'CONDITIONAL', conditionalActions: [{ condition: { dataType: 'EXPRESSION', resolvedDataType: 'BOOLEAN', value: { expressionValue: { expressionFunction: 'GREATER_THAN', expressionArguments: [aliasOperand, numberOperand(0)] } } }, actions: [{ connectionType: 'SET_VARIABLE', targetVariable: { id: { guid: { sessionID: 85, localID: 54 } } }, targetVariableData: { dataType: 'BOOLEAN', resolvedDataType: 'BOOLEAN', value: { boolValue: true } } }, { connectionType: 'INTERNAL_NODE', transitionNodeID: { sessionID: 85, localID: 11 } }] }, { actions: [{ connectionType: 'BACK' }] }] },
] }] };
const triggerEvents = [
  ['Worker Hover', { interactionType: 'ON_HOVER', interactionDuration: 0.125, interactionMaintained: true }],
  ['Worker Press', { interactionType: 'ON_PRESS', interactionDuration: 0, interactionMaintained: true }],
  ['Worker Down', { interactionType: 'MOUSE_DOWN', interactionDuration: 0.25 }],
  ['Worker Up', { interactionType: 'MOUSE_UP', interactionDuration: 0 }],
  ['Worker Media Hit Protocol', { interactionType: 'ON_MEDIA_HIT', mediaHitTime: 1.25 }],
  ['Worker Media End Protocol', { interactionType: 'ON_MEDIA_END' }],
  ['Worker Drag Protocol', { interactionType: 'DRAG' }],
];
for (const [index, [name, event]] of triggerEvents.entries()) {
  const node = graph.createNode('RECTANGLE', first.id, { name }); node.source.id = `85:${60 + index}`;
  node.source.fig.rawNodeFields = { prototypeInteractions: [{ id: { sessionID: 85, localID: 100 + index }, event, actions: [{ connectionType: 'INTERNAL_NODE', transitionNodeID: { sessionID: 85, localID: 11 } }] }] };
}
const motionNames = [];
for (const prefix of ['SLIDE_FROM', 'SLIDE_OUT_TO', 'MOVE_FROM', 'MOVE_OUT_TO', 'PUSH_FROM']) for (const direction of ['LEFT', 'RIGHT', 'TOP', 'BOTTOM']) {
  const name = `Worker ${prefix}_${direction}`, node = graph.createNode('RECTANGLE', first.id, { name }), index = motionNames.length; motionNames.push(name); node.source.id = `85:${200 + index}`;
  node.source.fig.rawNodeFields = { prototypeInteractions: [{ id: { sessionID: 85, localID: 400 + index }, event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'INTERNAL_NODE', transitionNodeID: { sessionID: 85, localID: 11 }, transitionType: `${prefix}_${direction}`, transitionShouldSmartAnimate: true, transitionDuration: direction === 'BOTTOM' ? 10 : 4, easingType: 'CUSTOM_CUBIC', easingFunction: [0.25, -1, 0.75, 2] }] }] };
}
const smartNames = [];
for (const navigationType of ['NAVIGATE', 'SWAP']) {
  const name = `Worker Smart ${navigationType}`, node = graph.createNode('RECTANGLE', first.id, { name }); smartNames.push(name); node.source.id = `85:${280 + smartNames.length}`;
  node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'INTERNAL_NODE', navigationType, transitionNodeID: { sessionID: 85, localID: navigationType === 'SWAP' ? 14 : 11 }, transitionType: 'SMART_ANIMATE', transitionDuration: 0.375, easingType: 'OUT_CUBIC' }] }] };
}
// These sentinel arrays test opaque schema transport only, not spring parameter meaning.
const springNames = [];
for (const easingType of ['SPRING', 'GENTLE_SPRING', 'CUSTOM_SPRING', 'SPRING_PRESET_ONE', 'SPRING_PRESET_TWO', 'SPRING_PRESET_THREE']) {
  const name = `Worker opaque ${easingType}`, node = graph.createNode('RECTANGLE', first.id, { name }), index = springNames.length; springNames.push(name); node.source.id = `85:${250 + index}`;
  node.source.fig.rawNodeFields = { prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ connectionType: 'BACK', transitionType: 'MOVE_FROM_RIGHT', transitionDuration: 2, easingType, easingFunction: [1, 100, 10, -1] }] }] };
}
const exported = await exportFigFile(graph), parsed = parseFigBuffer(new Uint8Array(exported).buffer);
const canvas = parsed.nodeChanges.find(node => node.type === 'CANVAS' && node.name === page.name), destination = parsed.nodeChanges.find(node => node.name === 'Details');
canvas.prototypeStartNodeID = destination.guid;
const homeRecord = parsed.nodeChanges.find(node => node.name === 'Home'), fixedRecord = parsed.nodeChanges.find(node => node.name === 'Worker Fixed'); homeRecord.fixedChildrenDivider = fixedRecord.parentIndex.position;
canvas.pluginData = [{ pluginID: 'other', key: 'keep', value: 'worker-page-metadata' }];
const schema = compileSchema(decodeBinarySchema(new ByteBuffer(inflateSync(parsed.figSchemaDeflated))));
const fixture = writeFigArchive({ schemaDeflated: parsed.figSchemaDeflated, kiwiData: schema.encodeMessage({ type: 'NODE_CHANGES', nodeChanges: parsed.nodeChanges, blobs: parsed.blobs.map(bytes => ({ bytes })) }), thumbnailPNG: new Uint8Array(), metaJSON: '{}', images: [], figKiwiVersion: parsed.figKiwiVersion });
await writeFile(path.join(output, 'prototype-worker.fig'), fixture);
const workerSource = `const { parentPort } = require('node:worker_threads'); globalThis.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) }; const loaded = import(${JSON.stringify(pathToFileURL(bundle).href)}); parentPort.on('message', async data => { await loaded; self.onmessage({ data }); });`;
async function decode(bytes) {
  const worker = new Worker(workerSource, { eval: true });
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bundled importer exceeded 30 seconds.')), 30_000);
      worker.once('error', error => { clearTimeout(timeout); reject(error); });
      worker.once('message', result => { clearTimeout(timeout); resolve(result); });
      const input = bytes.slice().buffer; worker.postMessage(input, [input]);
    });
  } finally { await worker.terminate(); }
}
const decoded = await decode(fixture);
assert.equal(decoded.error, undefined); assert.ok(decoded.graph.nodes instanceof Map); assert.ok(decoded.graph.figSchemaDeflated instanceof Uint8Array);
const nodes = [...decoded.graph.nodes.values()], named = name => nodes.find(node => node.name === name);
assert.equal(named('Next').source.fig.rawNodeFields.prototypeInteractions[0].actions[0].transitionNodeID.localID, 11);
assert.deepEqual(named('Next').source.fig.rawNodeFields.prototypeInteractions, next.source.fig.rawNodeFields.prototypeInteractions);
assert.equal(named('Legacy Back').source.fig.rawNodeFields.connectionType, 'BACK');
assert.deepEqual(named('Worker proof').source.fig.rawNodeFields.prototypeStartNodeID, destination.guid);
assert.deepEqual(named('Worker proof').pluginData, [{ pluginId: 'other', key: 'keep', value: 'worker-page-metadata' }]);
for (const name of ['Open Overlay', 'Swap Overlay', 'Close Overlay']) assert.deepEqual(named(name).source.fig.rawNodeFields.prototypeInteractions, [...graph.nodes.values()].find(node => node.name === name).source.fig.rawNodeFields.prototypeInteractions);
for (const [key, value] of Object.entries(modal.source.fig.rawNodeFields)) assert.deepEqual(named('Worker Modal').source.fig.rawNodeFields[key], value);
for (const [key, value] of Object.entries(first.source.fig.rawNodeFields)) assert.deepEqual(named('Home').source.fig.rawNodeFields[key], value);
assert.equal(named('Home').source.fig.rawNodeFields.fixedChildrenDivider, fixedRecord.parentIndex.position);
assert.equal(named('Worker Fixed').source.fig.rawNodeFields.scrollBehavior, 'FIXED_WHEN_CHILD_OF_SCROLLING_FRAME'); assert.equal(named('Worker Sticky').source.fig.rawNodeFields.scrollBehavior, 'STICKY_SCROLLS');
const expectedScroll = parsed.nodeChanges.find(node => node.name === 'Worker Scroll Link').prototypeInteractions;
assert.ok(Math.abs(expectedScroll[0].actions[0].transitionDuration - 0.3) < 0.0000001);
assert.deepEqual(named('Worker Scroll Link').source.fig.rawNodeFields.prototypeInteractions, expectedScroll); assert.equal(typeof named('Worker Fixed').source.orderKey, 'string');
assert.deepEqual(named('Worker Sequence').source.fig.rawNodeFields.prototypeInteractions, sequence.source.fig.rawNodeFields.prototypeInteractions);
assert.equal(named('Worker Sequence').source.fig.rawNodeFields.prototypeInteractions[0].actions.length, 5);
assert.deepEqual(named('Worker Variable Actions').source.fig.rawNodeFields.prototypeInteractions, variables.source.fig.rawNodeFields.prototypeInteractions);
assert.equal(decoded.graph.variables.get('85:52').valuesByMode['85:53'], 10);
assert.equal(decoded.graph.variables.get('85:54').valuesByMode['85:51'], false);
assert.deepEqual(decoded.graph.variableCollections.get('85:50').modes.map(mode => mode.modeId), ['85:51', '85:53']);
for (const [name] of triggerEvents) assert.deepEqual(named(name).source.fig.rawNodeFields.prototypeInteractions, [...graph.nodes.values()].find(node => node.name === name).source.fig.rawNodeFields.prototypeInteractions);
for (const name of [...motionNames, ...smartNames, ...springNames]) assert.deepEqual(named(name).source.fig.rawNodeFields.prototypeInteractions, parsed.nodeChanges.find(node => node.name === name).prototypeInteractions);
const malformed = await decode(new Uint8Array([1, 2, 3])); assert.equal(typeof malformed.error, 'string'); assert.equal(malformed.graph, undefined);
const report = { createdAt: new Date().toISOString(), status: 'passed', environment: 'Production browser worker bundle executed in Node worker_threads with a postMessage adapter; not WebView/device acceptance', bundle: name, bundleSha256: createHash('sha256').update(bundleBytes).digest('hex'), fixtureSha256: createHash('sha256').update(fixture).digest('hex'), nodes: nodes.length, checks: ['modern click connection', 'native multi-interaction timing, pointer and key fields', 'direction and custom easing fields', 'legacy Back connection', 'page start GUID', 'page plugin preservation', 'native overlay, Swap and Close action transport', 'manual overlay position, dimming color and outside-click settings', 'native scroll direction and starting offsets', 'native fixed/sticky behavior and legacy fixed section/order keys', 'Scroll To, scroll animation and extra offsets', 'reset/preserve arrival flag transport', 'ordered five-step action sequence and every target/motion field', 'native variable assignment and expression/alias transport', 'native variable mode action transport', 'native conditional branch tree and destination transport', 'variable definitions and mode GUID transport', 'Map/typed-array transport', 'malformed archive error', 'worker termination', ...triggerEvents.map(([name]) => name + ' schema field transport'), ...motionNames.map(name => name + ' directional/long-duration/custom-cubic/matching-flag transport'), ...smartNames.map(name => name + ' native Smart Animate transport'), ...springNames.map(name => name + ' opaque schema preservation, parameter meaning unverified')] };
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
