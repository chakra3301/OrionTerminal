import { loader } from "@monaco-editor/react";

loader.config({
  paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" },
});

let registerPromise: Promise<void> | null = null;

export function ensureOrionTheme(): Promise<void> {
  if (registerPromise) return registerPromise;
  registerPromise = loader.init().then((monaco) => {
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
      },
    });
  });
  return registerPromise;
}
