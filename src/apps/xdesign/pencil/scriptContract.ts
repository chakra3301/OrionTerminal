import type { SceneGraph } from "@open-pencil/scene-graph";
import { deserializeGraph } from "./graphDocument";
import { MAX_GRAPH_BYTES } from "./graphPacking";

export const SCRIPT_CHANNEL = "orion:xdesign-script";
export const SCRIPT_VERSION = 1;
export const MAX_SCRIPT_BYTES = 64 * 1024;
export const MAX_SCRIPT_RESULT = 64 * 1024;
export const MAX_SCRIPT_NODES = 10_000;
export type ScriptInput = { code: string; graph: string; pageId: string; selection: string[] };
export type ScriptOutput = { graph: string; pageId: string; selection: string[]; result: string; logs: string[] };
export type ScriptSummary = { added: number; removed: number; changed: number; images: number; variables: number; collections: number; modes: number; libraries: number; documentChanged: boolean; pageChanged: boolean; selectionChanged: boolean };

export function assertScriptCode(code: unknown): asserts code is string {
  if (typeof code !== "string" || !code.trim() || new TextEncoder().encode(code).byteLength > MAX_SCRIPT_BYTES) throw new Error("Enter a JavaScript script up to 64 KiB.");
}
export function scriptPageSelection(graph: SceneGraph, pageId: string, selection: unknown): string[] {
  if (graph.getNode(pageId)?.type !== "CANVAS" || !Array.isArray(selection) || selection.length > MAX_SCRIPT_NODES || selection.some(id => typeof id !== "string") || new Set(selection).size !== selection.length) throw new Error("Invalid script page or selection.");
  for (const id of selection) {
    let node = graph.getNode(id); let depth = 0;
    if (!node || id === pageId) throw new Error("Select layers on the script’s current page.");
    while (node && node.parentId !== pageId && depth++ <= MAX_SCRIPT_NODES) node = node.parentId ? graph.getNode(node.parentId) : undefined;
    if (!node || node.parentId !== pageId) throw new Error("Select layers on the script’s current page.");
  }
  return selection;
}
export function decodeScriptGraph(value: unknown): SceneGraph {
  if (typeof value !== "string" || value.length > MAX_GRAPH_BYTES) throw new Error("The script graph exceeds the document size limit.");
  const graph = deserializeGraph(value);
  if (graph.nodes.size > MAX_SCRIPT_NODES) throw new Error("This script exceeds the 10,000-layer transaction limit.");
  const pending: unknown[] = [...graph.nodes.values(), ...graph.variables.values(), ...graph.variableCollections.values()];
  let fields = 0;
  while (pending.length) {
    const item = pending.pop(); if (!item || typeof item !== "object" || ArrayBuffer.isView(item)) continue;
    if (++fields > 1_000_000) throw new Error("The script graph contains too many metadata fields.");
    if (item instanceof Map) { for (const value of item.values()) pending.push(value); continue; }
    if (item instanceof Set) { for (const value of item) pending.push(value); continue; }
    for (const [key, value] of Object.entries(item)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsupported script object field.");
      pending.push(value);
    }
  }
  return graph;
}
export function decodeScriptOutput(value: unknown, before: SceneGraph): { output: ScriptOutput; graph: SceneGraph } {
  if (!value || typeof value !== "object") throw new Error("Invalid script response.");
  const output = value as ScriptOutput;
  if (typeof output.result !== "string" || output.result.length > MAX_SCRIPT_RESULT || !Array.isArray(output.logs) || output.logs.length > 100 || output.logs.some(line => typeof line !== "string" || line.length > 1024)) throw new Error("The script returned oversized output.");
  JSON.parse(output.result);
  const graph = decodeScriptGraph(output.graph);
  if (graph.rootId !== before.rootId || graph.figKiwiVersion !== before.figKiwiVersion || graph.figSchemaDeflated?.length !== before.figSchemaDeflated?.length || graph.figSchemaDeflated?.some((value, i) => value !== before.figSchemaDeflated?.[i])) throw new Error("Scripts must preserve the document root and imported format schema.");
  scriptPageSelection(graph, output.pageId, output.selection);
  return { output, graph };
}
export function scriptSummary(before: SceneGraph, after: SceneGraph, input: Pick<ScriptInput,"pageId"|"selection">, output: Pick<ScriptOutput,"pageId"|"selection">): ScriptSummary {
  const encoded = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Map ? {map: [...item]} : item instanceof Set ? {set: [...item]} : item);
  const equal = (a: unknown, b: unknown) => encoded(a) === encoded(b);
  let added = 0, removed = 0, changed = 0;
  for (const [id, node] of after.nodes) { const old = before.getNode(id); if (!old) added++; else if (!equal(old,node)) changed++; }
  for (const id of before.nodes.keys()) if (!after.nodes.has(id)) removed++;
  const changes = <T>(a: Map<string,T>, b: Map<string,T>, equal: (a:T,b:T)=>boolean) => [...new Set([...a.keys(),...b.keys()])].filter(key=>!a.has(key)||!b.has(key)||!equal(a.get(key)!,b.get(key)!)).length;
  return { added, removed, changed, images: changes(before.images,after.images,(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i])), variables: changes(before.variables,after.variables,equal), collections: changes(before.variableCollections,after.variableCollections,equal), modes: changes(before.activeMode,after.activeMode,equal), libraries: changes(before.enabledLibraries,after.enabledLibraries,equal), documentChanged: before.documentColorSpace !== after.documentColorSpace, pageChanged: input.pageId !== output.pageId, selectionChanged: JSON.stringify(input.selection) !== JSON.stringify(output.selection) };
}
