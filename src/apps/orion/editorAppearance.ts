import type * as Monaco from "monaco-editor";
import { isLightTheme, useThemeStore, type ThemeName } from "@/store/themeStore";

export function readLightPalette() {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    return /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  };
  return {
    background: color("--bg-2", "#fffaf0"), panel: color("--bg-1", "#f5f0e5"),
    foreground: color("--t-primary", "#302d27"), muted: color("--t-tertiary", "#736a59"),
    blue: color("--neon-cyan", "#365d73"), green: color("--neon-green", "#366044"),
    red: color("--neon-magenta", "#963b49"), violet: color("--neon-violet", "#705187"),
    amber: color("--neon-yellow", "#80601d"),
  };
}
export const editorThemeName = (theme: ThemeName) => isLightTheme(theme) ? "orion-light" : theme.startsWith("custom:") ? "orion-custom" : "orion-neon";
export const useEditorTheme = () => useThemeStore(s => editorThemeName(s.theme));

let runtime: typeof Monaco | null = null;
export function registerLightEditorTheme(monaco: typeof Monaco) {
  runtime = monaco;
  const p = readLightPalette();
  const hex = (value: string) => value.slice(1);
  const appearance: Monaco.editor.IStandaloneThemeData = {
    base: "vs", inherit: true,
    rules: [
      { token: "keyword", foreground: hex(p.violet) },
      { token: "string", foreground: hex(p.green) },
      { token: "number", foreground: hex(p.amber) },
      { token: "comment", foreground: hex(p.muted), fontStyle: "italic" },
      { token: "type", foreground: hex(p.blue) },
      { token: "tag", foreground: hex(p.violet) },
      { token: "attribute.name", foreground: hex(p.blue) },
      { token: "identifier", foreground: hex(p.foreground) },
    ],
    colors: {
      "editor.background": p.background, "editor.foreground": p.foreground,
      "editorLineNumber.foreground": p.muted, "editorLineNumber.activeForeground": p.blue,
      "editorCursor.foreground": p.blue, "editor.selectionBackground": p.blue + "30",
      "editor.inactiveSelectionBackground": p.blue + "18", "editor.lineHighlightBackground": p.blue + "08",
      "editorIndentGuide.background": p.foreground + "18", "editorWhitespace.foreground": p.foreground + "28",
      "editorGutter.background": p.background, "editorStickyScroll.background": p.panel,
      "editorWidget.background": p.panel, "editorWidget.border": p.foreground + "30",
      "editorSuggestWidget.background": p.panel, "editorSuggestWidget.foreground": p.foreground,
      "editorSuggestWidget.selectedBackground": p.blue + "22", "editorHoverWidget.background": p.panel,
      "scrollbarSlider.background": p.foreground + "25", "scrollbarSlider.hoverBackground": p.foreground + "40",
      "diffEditor.insertedLineBackground": p.green + "12", "diffEditor.insertedTextBackground": p.green + "25",
      "diffEditor.removedLineBackground": p.red + "12", "diffEditor.removedTextBackground": p.red + "25",
      "diffEditorGutter.insertedLineBackground": p.green + "22", "diffEditorGutter.removedLineBackground": p.red + "22",
      "diffEditor.diagonalFill": p.foreground + "12", "diffEditor.unchangedRegionBackground": p.panel,
      "diffEditor.unchangedRegionForeground": p.muted,
    },
  };
  monaco.editor.defineTheme("orion-light", appearance);
  monaco.editor.defineTheme("orion-custom", { ...appearance, base: "vs-dark" });
}

// Appearance updates must not recreate models, editors, terminals or sessions.
const unsubscribe = useThemeStore.subscribe((state, previous) => {
  if (!runtime || state.theme === previous.theme) return;
  registerLightEditorTheme(runtime);
  runtime.editor.setTheme(editorThemeName(state.theme));
});
import.meta.hot?.dispose(unsubscribe);
