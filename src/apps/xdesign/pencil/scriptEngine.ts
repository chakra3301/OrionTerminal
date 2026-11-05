import { FigmaAPI } from "@open-pencil/core/figma-api";
import { parse } from "acorn";
import { serializeGraph } from "./graphDocument";
import { assertScriptCode, decodeScriptGraph, MAX_SCRIPT_RESULT, scriptPageSelection, type ScriptInput, type ScriptOutput } from "./scriptContract";

export function wrapScript(code: string): string {
  const text = code.trim(); if (text.startsWith("return")) return text;
  try {
    const body = parse(text, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }).body;
    const last = body.at(-1);
    if (!last) return text;
    if (last.type === "ExpressionStatement") return `${text.slice(0,last.start)}return (${text.slice(last.start,last.end).replace(/;$/, "")})`;
  } catch {}
  return `return (async () => { ${text} })()`;
}
export async function executeScriptDraft(input: ScriptInput): Promise<ScriptOutput> {
  assertScriptCode(input.code);
  const graph = decodeScriptGraph(input.graph), selection = scriptPageSelection(graph, input.pageId, input.selection);
  const figma = new FigmaAPI(graph); figma.currentPage = figma.wrapNode(input.pageId); figma.currentPage.selection = selection.map(id => figma.wrapNode(id));
  const logs: string[] = [];
  const log = (...values: unknown[]) => {
    if (logs.length >= 100) return;
    const text = values.map(value => { try { return typeof value === "string" ? value : JSON.stringify(value); } catch { return "[Unserializable value]"; } }).join(" ");
    logs.push(text.slice(0,1024));
  };
  const console = Object.freeze({ log, info: log, warn: log, error: log, debug: log });
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (figma: FigmaAPI, console: unknown) => Promise<unknown>;
  let result = await new AsyncFunction("figma", "console", wrapScript(input.code))(figma, console);
  if (result && typeof result === "object") { const toJSON = Reflect.get(result, "toJSON"); if (typeof toJSON === "function") result = toJSON.call(result); }
  const encoded = JSON.stringify(result ?? {ok: true, message: "Code executed (no return value)"});
  if (typeof encoded !== "string" || encoded.length > MAX_SCRIPT_RESULT) throw new Error("Return a JSON result up to 64 KiB.");
  const pageId = figma.currentPage.id, selected = figma.currentPage.selection.map(node => node.id);
  scriptPageSelection(graph, pageId, selected);
  return { graph: serializeGraph(graph), pageId, selection: selected, result: encoded, logs };
}
