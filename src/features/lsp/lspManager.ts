import type { OnMount } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { log } from "@/lib/log";
import { LspClient } from "./lspClient";
import {
  pathToUri,
  lspLanguageId,
  diagnosticToMarker,
  type LspDiagnostic,
} from "./lspProtocol";

type MonacoNs = Parameters<OnMount>[1];
type TextModel = editor.ITextModel;

/** A language server we know how to launch. `langs` are the LSP languageIds
 * it handles; `cmd` is probed on PATH before we try to start it. */
type ServerConfig = {
  key: string;
  cmd: string;
  args: string[];
  langs: string[];
};

const CONFIGS: ServerConfig[] = [
  {
    key: "typescript",
    cmd: "typescript-language-server",
    args: ["--stdio"],
    langs: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
  },
  { key: "pyright", cmd: "pyright-langserver", args: ["--stdio"], langs: ["python"] },
  { key: "rust", cmd: "rust-analyzer", args: [], langs: ["rust"] },
];

function configForLang(lang: string): ServerConfig | null {
  return CONFIGS.find((c) => c.langs.includes(lang)) ?? null;
}

type ServerState = {
  config: ServerConfig;
  client: LspClient;
  root: string;
  initialized: boolean;
  /** Queue of work waiting on the initialize handshake. */
  ready: Promise<void>;
  openDocs: Map<string, number>; // uri -> version
};

// key+root -> server (so switching projects spins up fresh servers).
const servers = new Map<string, ServerState>();
const starting = new Map<string, Promise<ServerState | null>>();
const probeCache = new Map<string, boolean>();

let monacoRef: MonacoNs | null = null;

/** Status surface for the UI (which servers are live). */
export type LspStatus = { key: string; lang: string; running: boolean };
export const useLspStatus = create<{ servers: string[] }>(() => ({ servers: [] }));
function publishStatus() {
  useLspStatus.setState({ servers: [...servers.keys()].map((k) => k.split("@@")[0]!) });
}

function serverKey(config: ServerConfig, root: string): string {
  return `${config.key}@@${root}`;
}

async function probe(cmd: string): Promise<boolean> {
  if (probeCache.has(cmd)) return probeCache.get(cmd)!;
  const ok = await ipc.lspProbe(cmd).catch(() => false);
  probeCache.set(cmd, ok);
  if (!ok) log.info(`[lsp] ${cmd} not on PATH — skipping`);
  return ok;
}

async function ensureServer(lang: string, root: string): Promise<ServerState | null> {
  const config = configForLang(lang);
  if (!config) return null;
  const key = serverKey(config, root);
  const existing = servers.get(key);
  if (existing) return existing;
  const inFlight = starting.get(key);
  if (inFlight) return inFlight;

  const p = (async (): Promise<ServerState | null> => {
    if (!(await probe(config.cmd))) return null;
    const serverId = key;
    try {
      await ipc.lspStart(serverId, config.cmd, config.args, root);
    } catch (e) {
      log.warn(`[lsp] failed to start ${config.cmd}`, e);
      return null;
    }

    let resolveReady: () => void;
    const ready = new Promise<void>((r) => (resolveReady = r));
    const client = new LspClient(
      serverId,
      (method, params) => onNotification(key, method, params),
      (method, params) => onServerRequest(method, params),
      () => {
        servers.delete(key);
        if (config.key === "typescript") setBrowserTsMuted(false);
        publishStatus();
      },
    );
    await client.attach();

    const state: ServerState = {
      config,
      client,
      root,
      initialized: false,
      ready,
      openDocs: new Map(),
    };
    servers.set(key, state);
    publishStatus();

    try {
      await client.request("initialize", initializeParams(root));
      client.notify("initialized", {});
      state.initialized = true;
      resolveReady!();
      // A real TS/JS server owns ALL markers now — silence the browser
      // worker's syntactic squiggles so they don't double up.
      if (config.key === "typescript") setBrowserTsMuted(true);
      // Open any already-loaded models this server should own.
      syncExistingModels();
    } catch (e) {
      log.warn(`[lsp] initialize failed for ${config.cmd}`, e);
      resolveReady!();
    }
    return state;
  })();

  starting.set(key, p);
  const result = await p;
  starting.delete(key);
  return result;
}

function setBrowserTsMuted(muted: boolean): void {
  const monaco = monacoRef;
  if (!monaco) return;
  const ts = monaco.languages.typescript;
  const opts = {
    // Semantic was already off (no node_modules types in the worker); when
    // a real server is up we additionally drop syntactic so LSP owns all.
    noSemanticValidation: true,
    noSyntaxValidation: muted,
    noSuggestionDiagnostics: muted,
  };
  ts.typescriptDefaults.setDiagnosticsOptions(opts);
  ts.javascriptDefaults.setDiagnosticsOptions(opts);
}

function initializeParams(root: string) {
  return {
    processId: null,
    rootUri: pathToUri(root),
    workspaceFolders: [{ uri: pathToUri(root), name: "workspace" }],
    capabilities: {
      textDocument: {
        synchronization: { dynamicRegistration: false, didSave: true },
        publishDiagnostics: { relatedInformation: true },
        hover: { contentFormat: ["markdown", "plaintext"] },
        definition: { dynamicRegistration: false },
        completion: { completionItem: { snippetSupport: false } },
      },
      workspace: { workspaceFolders: true },
    },
  };
}

async function onServerRequest(method: string, params: unknown): Promise<unknown> {
  if (method === "workspace/configuration") return [null];
  // Servers push edits this way after executeCommand (organize imports,
  // command-style quick fixes) and sometimes for rename.
  if (method === "workspace/applyEdit") {
    const monaco = monacoRef;
    const p = params as { edit?: import("./lspWorkspaceEdit").LspWorkspaceEdit };
    if (!monaco || !p.edit) return { applied: false };
    const { applyWorkspaceEdit } = await import("./lspWorkspaceEdit");
    const n = await applyWorkspaceEdit(monaco, p.edit);
    return { applied: n > 0 };
  }
  return null;
}

function onNotification(key: string, method: string, params: unknown): void {
  if (method === "textDocument/publishDiagnostics") {
    const p = params as { uri: string; diagnostics: LspDiagnostic[] };
    applyDiagnostics(p.uri, p.diagnostics ?? []);
  }
  // window/logMessage, window/showMessage, $/progress: ignored on purpose.
  void key;
}

function applyDiagnostics(uri: string, diagnostics: LspDiagnostic[]): void {
  const monaco = monacoRef;
  if (!monaco) return;
  const model = (monaco.editor.getModels() as TextModel[]).find(
    (m) => m.uri.toString() === monaco.Uri.parse(uri).toString(),
  );
  if (!model) return;
  monaco.editor.setModelMarkers(
    model,
    "lsp",
    diagnostics.map(diagnosticToMarker),
  );
}

// ── Document sync ──────────────────────────────────────────────────────────

function modelPath(model: NonNullable<TextModel>): string {
  return model.uri.path;
}

function serverForModel(model: NonNullable<TextModel>): ServerState | null {
  const lang = lspLanguageId(modelPath(model));
  const root = useProjectStore.getState().active?.root_path;
  if (!lang || !root) return null;
  if (!modelPath(model).startsWith(root)) return null;
  const config = configForLang(lang);
  if (!config) return null;
  return servers.get(serverKey(config, root)) ?? null;
}

async function openModel(model: NonNullable<TextModel>): Promise<void> {
  const lang = lspLanguageId(modelPath(model));
  const root = useProjectStore.getState().active?.root_path;
  if (!lang || !root || !modelPath(model).startsWith(root)) return;
  const server = await ensureServer(lang, root);
  if (!server) return;
  await server.ready;
  const uri = pathToUri(modelPath(model));
  if (server.openDocs.has(uri)) return;
  server.openDocs.set(uri, 1);
  server.client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: lang, version: 1, text: model.getValue() },
  });
}

function changeModel(model: NonNullable<TextModel>): void {
  const server = serverForModel(model);
  if (!server) return;
  const uri = pathToUri(modelPath(model));
  const version = (server.openDocs.get(uri) ?? 1) + 1;
  server.openDocs.set(uri, version);
  // Full-document sync — simplest correct option; our files are small.
  server.client.notify("textDocument/didChange", {
    textDocument: { uri, version },
    contentChanges: [{ text: model.getValue() }],
  });
}

function closeModel(model: NonNullable<TextModel>): void {
  const server = serverForModel(model);
  if (!server) return;
  const uri = pathToUri(modelPath(model));
  if (!server.openDocs.delete(uri)) return;
  server.client.notify("textDocument/didClose", { textDocument: { uri } });
}

function syncExistingModels(): void {
  const monaco = monacoRef;
  if (!monaco) return;
  for (const model of monaco.editor.getModels()) void openModel(model);
}

/** Open the right server for `path` and ensure its model is synced — called
 * when a file tab activates so diagnostics appear without an edit first. */
export function lspNoteActiveFile(path: string): void {
  const monaco = monacoRef;
  if (!monaco) return;
  const model = (monaco.editor.getModels() as TextModel[]).find(
    (m) => m.uri.path === path,
  );
  if (model) void openModel(model);
}

const changeDebounce = new Map<string, ReturnType<typeof setTimeout>>();

/** Mount-once wiring (called from the Monaco loader-init hook). */
export function registerLsp(monaco: MonacoNs): void {
  monacoRef = monaco;

  const wire = (model: NonNullable<TextModel>) => {
    void openModel(model);
    model.onDidChangeContent(() => {
      const key = model.uri.toString();
      const prev = changeDebounce.get(key);
      if (prev) clearTimeout(prev);
      changeDebounce.set(
        key,
        setTimeout(() => {
          changeDebounce.delete(key);
          changeModel(model);
        }, 300),
      );
    });
  };

  monaco.editor.onDidCreateModel((m: TextModel) => wire(m));
  monaco.editor.onWillDisposeModel((m: TextModel) => closeModel(m));
  for (const m of monaco.editor.getModels() as TextModel[]) wire(m);

  registerProviders(monaco);
  void import("./lspFeatures").then((m) => m.registerLspFeatures(monaco));

  // Switching projects: tear down servers rooted in the old project.
  useProjectStore.subscribe((s, prev) => {
    if (s.active?.id === prev.active?.id) return;
    const keepRoot = s.active?.root_path;
    for (const [key, server] of servers) {
      if (server.root !== keepRoot) {
        server.client.dispose();
        void ipc.lspStop(key).catch(() => {});
        servers.delete(key);
      }
    }
    publishStatus();
    syncExistingModels();
  });
}

// ── Hover + definition providers ────────────────────────────────────────────

function registerProviders(monaco: MonacoNs): void {
  const langs = ["typescript", "javascript", "python", "rust"];
  for (const lang of langs) {
    monaco.languages.registerHoverProvider(lang, {
      provideHover: async (model: TextModel, position: Position) => {
        const server = serverForModel(model);
        if (!server) return null;
        try {
          const res = (await server.client.request("textDocument/hover", {
            textDocument: { uri: pathToUri(model.uri.path) },
            position: { line: position.lineNumber - 1, character: position.column - 1 },
          })) as { contents?: unknown } | null;
          const value = hoverToMarkdown(res?.contents);
          if (!value) return null;
          return { contents: [{ value }] };
        } catch {
          return null;
        }
      },
    });
  }
}

function hoverToMarkdown(contents: unknown): string | null {
  if (!contents) return null;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents.map((c) => hoverToMarkdown(c)).filter(Boolean).join("\n\n") || null;
  }
  const obj = contents as { value?: string; language?: string };
  if (typeof obj.value === "string") {
    return obj.language ? `\`\`\`${obj.language}\n${obj.value}\n\`\`\`` : obj.value;
  }
  return null;
}

/** LSP textDocument/definition for the cursor — used as strategy 0 by the
 * project go-to-def command. Returns {path,line,column} or null. */
export async function lspDefinition(
  path: string,
  lineNumber: number,
  column: number,
): Promise<{ path: string; line: number; column: number } | null> {
  const monaco = monacoRef;
  if (!monaco) return null;
  const model = (monaco.editor.getModels() as TextModel[]).find(
    (m) => m.uri.path === path,
  );
  if (!model) return null;
  const server = serverForModel(model);
  if (!server) return null;
  try {
    const res = await server.client.request("textDocument/definition", {
      textDocument: { uri: pathToUri(path) },
      position: { line: lineNumber - 1, character: column - 1 },
    });
    const loc = Array.isArray(res) ? res[0] : res;
    if (!loc) return null;
    const l = loc as { uri?: string; targetUri?: string; range?: { start: { line: number; character: number } }; targetSelectionRange?: { start: { line: number; character: number } } };
    const uri = l.uri ?? l.targetUri;
    const range = l.range ?? l.targetSelectionRange;
    if (!uri || !range) return null;
    const { uriToPath } = await import("./lspProtocol");
    return {
      path: uriToPath(uri),
      line: range.start.line + 1,
      column: range.start.character + 1,
    };
  } catch {
    return null;
  }
}

/** Send an arbitrary LSP request for the server that owns `path`. Returns
 * null when no server is live (callers degrade gracefully). Used by the
 * 1.6b feature providers (completion, rename, code actions, …). */
export async function lspRequest<T = unknown>(
  path: string,
  method: string,
  params: Record<string, unknown>,
): Promise<T | null> {
  const monaco = monacoRef;
  if (!monaco) return null;
  const model = (monaco.editor.getModels() as TextModel[]).find(
    (m) => m.uri.path === path,
  );
  const server = model ? serverForModel(model) : null;
  if (!server) return null;
  try {
    await server.ready;
    return (await server.client.request(method, {
      textDocument: { uri: pathToUri(path) },
      ...params,
    })) as T;
  } catch {
    return null;
  }
}

export { pathToUri };

export function getMonaco(): MonacoNs | null {
  return monacoRef;
}

/** True once a server owning this language is initialized — lets the browser
 * TS service back off its (duplicate) syntactic markers. */
export function hasLiveServerForPath(path: string): boolean {
  const lang = lspLanguageId(path);
  const root = useProjectStore.getState().active?.root_path;
  if (!lang || !root) return false;
  const config = configForLang(lang);
  if (!config) return false;
  return servers.get(serverKey(config, root))?.initialized ?? false;
}
