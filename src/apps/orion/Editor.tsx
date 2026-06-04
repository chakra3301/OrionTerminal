import Monaco, { type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc";
import { useTabsStore } from "@/store/tabsStore";
import { useFocusStore } from "@/store/focusStore";
import { useInlineEditStore } from "@/store/inlineEditStore";
import { useAssetsStore } from "@/store/assetsStore";
import { languageForPath } from "@/apps/orion/lang";
import { ASSET_DRAG_MIME } from "@/lib/dragMimes";
import "@/apps/orion/monacoTheme";
import { log } from "@/lib/log";

type MonacoEditor = Parameters<OnMount>[0];

export function OrionEditor({ path }: { path: string }) {
  const buffer = useTabsStore((s) => s.fileBuffers[path]);
  const markLoaded = useTabsStore((s) => s.markLoaded);
  const updateBuffer = useTabsStore((s) => s.updateBuffer);
  const setEditorFocus = useFocusStore((s) => s.setEditorFocus);
  const setHasSelection = useFocusStore((s) => s.setHasSelection);
  const setSelectionContextProvider = useFocusStore(
    (s) => s.setSelectionContextProvider,
  );

  const editorRef = useRef<MonacoEditor | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (buffer?.loaded) return;
    setError(null);
    ipc
      .readFile(path)
      .then((c) => {
        if (cancelled) return;
        markLoaded(path, c);
      })
      .catch((e) => {
        if (cancelled) return;
        log.error("readFile failed", e);
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path, buffer?.loaded, markLoaded]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monaco.editor.setTheme("orion-neon");

    editor.onDidFocusEditorWidget(() => {
      setEditorFocus(true);
      setSelectionContextProvider(() => {
        const ed = editorRef.current;
        if (!ed) return null;
        const model = ed.getModel();
        const sel = ed.getSelection();
        if (!model || !sel || sel.isEmpty()) return null;
        const fullContent = model.getValue();
        const selectionText = model.getValueInRange(sel);
        const selStart = model.getOffsetAt({
          lineNumber: sel.startLineNumber,
          column: sel.startColumn,
        });
        const selEnd = model.getOffsetAt({
          lineNumber: sel.endLineNumber,
          column: sel.endColumn,
        });
        const totalLines = model.getLineCount();
        const beforeStart = Math.max(1, sel.startLineNumber - 80);
        const afterEnd = Math.min(totalLines, sel.endLineNumber + 80);
        const contextBefore = model.getValueInRange({
          startLineNumber: beforeStart,
          startColumn: 1,
          endLineNumber: sel.startLineNumber,
          endColumn: sel.startColumn,
        });
        const contextAfter = model.getValueInRange({
          startLineNumber: sel.endLineNumber,
          startColumn: sel.endColumn,
          endLineNumber: afterEnd,
          endColumn: model.getLineMaxColumn(afterEnd),
        });
        return {
          path,
          language: languageForPath(path),
          selectionText,
          selStart,
          selEnd,
          fullContent,
          contextBefore,
          contextAfter,
        };
      });
    });
    editor.onDidBlurEditorWidget(() => setEditorFocus(false));
    editor.onDidChangeCursorSelection((e) => {
      setHasSelection(!e.selection.isEmpty());
    });
  };

  useEffect(() => {
    return () => {
      setEditorFocus(false);
      setHasSelection(false);
      setSelectionContextProvider(null);
    };
  }, [setEditorFocus, setHasSelection, setSelectionContextProvider]);

  const inlineEditVisible = useInlineEditStore((s) => s.visible);

  if (!buffer?.loaded && !error) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--t-tertiary)",
          fontSize: 12,
        }}
      >
        Loading…
      </div>
    );
  }

  if (error) {
    const isBinary = /valid UTF-8|stream did not contain/i.test(error);
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: isBinary ? "var(--t-secondary)" : "var(--neon-magenta)",
          fontSize: 13,
          textAlign: "center",
          padding: 24,
        }}
      >
        {isBinary ? (
          <>
            <div style={{ color: "var(--t-primary)", fontSize: 14 }}>
              Can't show this as text
            </div>
            <div style={{ color: "var(--t-tertiary)", fontSize: 12 }}>
              {path.split(/[\\/]/).pop()} looks like a binary file.
            </div>
          </>
        ) : (
          error
        )}
      </div>
    );
  }

  // Asset drop: drag an Archives image/asset onto the editor body → insert
  // a markdown reference (`![](path)` for images, `[name](path)` otherwise)
  // at the cursor. The literal filesystem path stays in source so it
  // survives copy/paste across files; the markdown preview tab renders it
  // via the asset:// protocol naturally.
  const onAssetDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    e.preventDefault();
    const filePath = e.dataTransfer.getData(ASSET_DRAG_MIME);
    if (!filePath) return;
    const asset = Array.from(useAssetsStore.getState().assets.values()).find(
      (a) => a.filePath === filePath,
    );
    const name = asset?.title || filePath.split(/[\\/]/).pop() || "asset";
    const snippet =
      asset?.kind === "image"
        ? `![${name}](${filePath})`
        : `[${name}](${filePath})`;
    const ed = editorRef.current;
    if (!ed) return;
    const sel = ed.getSelection();
    if (!sel) return;
    ed.executeEdits("orion-asset-drop", [
      { range: sel, text: snippet, forceMoveMarkers: true },
    ]);
    ed.focus();
  };

  const onAssetDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  return (
    <div
      style={{ flex: 1, minHeight: 0, position: "relative", width: "100%" }}
      onDragOver={onAssetDragOver}
      onDrop={onAssetDrop}
    >
      <Monaco
        height="100%"
        language={languageForPath(path)}
        value={buffer?.contents ?? ""}
        path={path}
        theme="orion-neon"
        onMount={onMount}
        onChange={(v) => {
          if (typeof v === "string") updateBuffer(path, v);
        }}
        options={{
          readOnly: inlineEditVisible,
          minimap: { enabled: false },
          fontSize: 12.5,
          fontFamily: "JetBrains Mono, SF Mono, ui-monospace, Menlo, monospace",
          lineHeight: 1.65 * 12.5,
          smoothScrolling: true,
          scrollBeyondLastLine: false,
          renderWhitespace: "selection",
          renderLineHighlight: "line",
          wordWrap: "off",
          automaticLayout: true,
          tabSize: 2,
          padding: { top: 14, bottom: 14 },
        }}
      />
    </div>
  );
}
