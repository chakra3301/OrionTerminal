import { buildOpenPencilClipboardHTML } from '@open-pencil/core/clipboard';
import { decodeBase64, encodeBase64 } from '@open-pencil/core/bytes';
import { SceneGraph } from '@open-pencil/scene-graph';
import type { Editor } from '@open-pencil/core/editor';
import { deflateSync, inflateSync } from 'fflate';
import { videoResourceHashes } from './videoPaints';
import { normalizeClipboardPrototypes } from './prototypeEditing';

export function withClipboardVideoResources(source: SceneGraph, payload: Awaited<ReturnType<Editor['prepareCopy']>>) {
  const snapshot = payload.snapshot; if (!snapshot) return;
  type Tree = typeof snapshot.nodes[number];
  const nodes: Tree[] = [], pending = [...snapshot.nodes, ...snapshot.componentDependencies];
  while (pending.length) { const node = pending.pop()!; nodes.push(node); if (nodes.length > 20_000) throw new Error('Copy video selections with at most 20,000 dependent layers.'); pending.push(...(node.children ?? [])); }
  const hasPrototype = normalizeClipboardPrototypes(source, snapshot);
  const hashes = videoResourceHashes(nodes); if (!hashes.size && !hasPrototype) return;
  for (const hash of hashes) { const bytes = source.images.get(hash); if (!bytes) throw new Error('A video resource is missing. Reimport it before copying.'); snapshot.images.set(hash, bytes); }
  if ([...snapshot.images.values()].reduce((total, bytes) => total + bytes.byteLength, 0) > 24 * 1024 * 1024) throw new Error('Copy video selections with at most 24 MB of embedded media.');
  const graph = new SceneGraph(); graph.nodes = new Map(nodes.map(node => [node.id, node])); graph.images = snapshot.images; graph.variables = new Map(snapshot.variableDependencies.variables.map(variable => [variable.id, variable])); graph.variableCollections = new Map(snapshot.variableDependencies.collections.map(collection => [collection.id, collection])); graph.activeMode = new Map(snapshot.variableDependencies.activeModes);
  // The published format preserves editable nodes but discovers only fill
  // imageHash resources. Enrich our freshly generated payload with movie bytes.
  const own = buildOpenPencilClipboardHTML(snapshot.nodes, graph);
  const encoded = own.match(/<!--\(openpencil\)(.*?)\(\/openpencil\)-->/s)![1]!;
  const data = JSON.parse(new TextDecoder().decode(inflateSync(decodeBase64(encoded))));
  for (const hash of hashes) data.images[hash] = encodeBase64(snapshot.images.get(hash)!);
  const raw = new TextEncoder().encode(JSON.stringify(data));
  if (raw.byteLength > 36 * 1024 * 1024) throw new Error('This video selection exceeds the clipboard limit.');
  const variableBytes = new TextEncoder().encode(JSON.stringify(snapshot.variableDependencies));
  if (variableBytes.byteLength > 1024 * 1024) throw new Error('This selection exceeds the 1 MB clipboard variable limit.');
  payload.html += `<!--(xdesign-variables)${encodeBase64(deflateSync(variableBytes))}(/xdesign-variables)-->`;
  payload.html += `<!--(openpencil)${encodeBase64(deflateSync(raw))}(/openpencil)-->`;
}
