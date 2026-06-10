import { loader } from "@monaco-editor/react";
import { useDiagnosticsStore } from "@/store/diagnosticsStore";

loader.config({
  paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" },
});

let registerPromise: Promise<void> | null = null;

export function ensureOrionTheme(): Promise<void> {
  if (registerPromise) return registerPromise;
  registerPromise = loader.init().then((monaco) => {
    configureTypescript(monaco);
    trackMarkers(monaco);
    monaco.editor.defineTheme("orion-neon", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "ff7eb6" },
        { token: "keyword.flow", foreground: "ff7eb6" },
        { token: "keyword.json", foreground: "ff7eb6" },
        { token: "string", foreground: "e6ff3a" },
        { token: "string.invalid", foreground: "ff8a8a" },
        { token: "number", foreground: "ff3ea5" },
        { token: "comment", foreground: "5a706a", fontStyle: "italic" },
        { token: "type", foreground: "b14cff" },
        { token: "type.identifier", foreground: "b14cff" },
        { token: "tag", foreground: "b14cff" },
        { token: "tag.id", foreground: "b14cff" },
        { token: "attribute.name", foreground: "39ff88" },
        { token: "delimiter", foreground: "9ab0a8" },
        { token: "identifier", foreground: "f8e88c" },
        { token: "function", foreground: "00e0ff" },
        { token: "variable", foreground: "f8e88c" },
        { token: "variable.predefined", foreground: "00e0ff" },
      ],
      colors: {
        "editor.background": "#03060a",
        "editor.foreground": "#e6f4ec",
        "editorLineNumber.foreground": "#324036",
        "editorLineNumber.activeForeground": "#00e0ff",
        "editorCursor.foreground": "#00e0ff",
        "editor.selectionBackground": "#00e0ff33",
        "editor.lineHighlightBackground": "#00e0ff0a",
        "editorIndentGuide.background": "#10171d",
        "editorWhitespace.foreground": "#10171d",
        "scrollbarSlider.background": "#ffffff14",
        "scrollbarSlider.hoverBackground": "#ffffff29",
        "scrollbarSlider.activeBackground": "#ffffff3d",
        // Diff review — brand green/magenta instead of Monaco's muddy
        // defaults (hex literals: Monaco can't read CSS vars).
        "diffEditor.insertedLineBackground": "#39ff8812",
        "diffEditor.insertedTextBackground": "#39ff8824",
        "diffEditor.removedLineBackground": "#ff3ea510",
        "diffEditor.removedTextBackground": "#ff3ea522",
        "diffEditorGutter.insertedLineBackground": "#39ff881c",
        "diffEditorGutter.removedLineBackground": "#ff3ea51a",
        "diffEditor.diagonalFill": "#ffffff08",
        "diffEditor.unchangedRegionBackground": "#0a1015",
        "diffEditor.unchangedRegionForeground": "#9ab0a8",
        "editorStickyScroll.background": "#060a0f",
      },
    });
  });
  return registerPromise;
}

type Monaco = Awaited<ReturnType<typeof loader.init>>;

/**
 * Turn on Monaco's in-browser TypeScript/JavaScript service: completions,
 * hover, signature help, go-to-definition (across open models), and document
 * formatting. Semantic validation stays OFF — the worker has no access to
 * node_modules type info, so it would wrongly flag every import. Syntax errors
 * (which are always correct) stay on. Accurate semantic diagnostics arrive
 * later via the real `typescript-language-server` (Phase 4 LSP).
 */
function configureTypescript(monaco: Monaco) {
  const ts = monaco.languages.typescript;
  const compilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    isolatedModules: true,
    skipLibCheck: true,
  };
  const diagnostics = {
    noSemanticValidation: true,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  };
  ts.typescriptDefaults.setCompilerOptions(compilerOptions);
  ts.javascriptDefaults.setCompilerOptions(compilerOptions);
  ts.typescriptDefaults.setDiagnosticsOptions(diagnostics);
  ts.javascriptDefaults.setDiagnosticsOptions(diagnostics);
  ts.typescriptDefaults.setEagerModelSync(true);
  ts.javascriptDefaults.setEagerModelSync(true);
}

type RawMarker = {
  resource: { path: string };
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  source?: string;
  code?: string | { value: string };
};

/** Mirror Monaco's marker set into the diagnostics store (status bar + Problems). */
function trackMarkers(monaco: Monaco) {
  const sync = () => {
    const markers = monaco.editor.getModelMarkers({}) as RawMarker[];
    useDiagnosticsStore.getState().setMarkers(
      markers.map((m) => ({
        path: m.resource.path,
        severity: m.severity,
        message: m.message,
        startLineNumber: m.startLineNumber,
        startColumn: m.startColumn,
        source: m.source,
        code: typeof m.code === "string" ? m.code : m.code?.value,
      })),
    );
  };
  monaco.editor.onDidChangeMarkers(sync);
  sync();
}
