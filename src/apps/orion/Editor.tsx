import Monaco, { type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc";
import { useTabsStore } from "@/store/tabsStore";
import { useFocusStore } from "@/store/focusStore";
import { useInlineEditStore } from "@/store/inlineEditStore";
import { useAssetsStore } from "@/store/assetsStore";
import { useEditorStatusStore } from "@/store/editorStatusStore";
import { useEditorNavStore } from "@/store/editorNavStore";
import { usePendingEdits } from "@/store/pendingEditsStore";
import { computeHunks } from "@/features/aiEdits/lineDiff";
import { InlineEditSession } from "@/features/inlineEdit/InlineEditSession";
import { recordEdit } from "@/features/autocomplete/recentEdits";
import { languageForPath } from "@/apps/orion/lang";
import { ASSET_DRAG_MIME } from "@/lib/dragMimes";
import "@/apps/orion/monacoTheme";
import { log } from "@/lib/log";

type MonacoEditor = Parameters<OnMount>[0];
type MonacoNs = Parameters<OnMount>[1];
type DecorationsCollection = ReturnType<MonacoEditor["createDecorationsCollection"]>;

export function OrionEditor({ path }: { path: string }) {
  const buffer = useTabsStore((s) => s.fileBuffers[path]);
  const markLoaded = useTabsStore((s) => s.markLoaded);
  const updateBuffer = useTabsStore((s) => s.updateBuffer);
  const setEditorFocus = useFocusStore((s) => s.setEditorFocus);
  const setHasSelection = useFocusStore((s) => s.setHasSelection);
  const setSelectionContextProvider = useFocusStore(
    (s) => s.setSelectionContextProvider,
  );
  const setEditorActionRunner = useFocusStore((s) => s.setEditorActionRunner);

  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<MonacoNs | null>(null);
  const pendingDecosRef = useRef<DecorationsCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mountTick, setMountTick] = useState(0);

  // Inline trust markers: while this file has an unreviewed agent edit,
  // tint the changed lines green (gutter bar + soft background; magenta
  // bar where lines were deleted). Cleared the moment the review resolves.
  const applyPendingDecorations = () => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const e = usePendingEdits.getState().edits[path];
    const hunks = e && !e.isNew ? computeHunks(e.original, e.updated) : [];
    const decos = hunks.map((h) =>
      h.newLines.length > 0
        ? {
            range: new monaco.Range(
              h.newStart + 1,
              1,
              h.newStart + h.newLines.length,
              1,
            ),
            options: {
              isWholeLine: true,
              className: "or-pending-line",
              linesDecorationsClassName: "or-pending-gutter",
              overviewRuler: {
                color: "rgba(57, 255, 136, 0.55)",
                position: monaco.editor.OverviewRulerLane.Full,
              },
            },
          }
        : {
            range: new monaco.Range(
              Math.max(1, h.newStart),
              1,
              Math.max(1, h.newStart),
              1,
            ),
            options: {
              isWholeLine: true,
              linesDecorationsClassName: "or-pending-gutter-del",
            },
          },
    );
    pendingDecosRef.current?.clear();
    pendingDecosRef.current = ed.createDecorationsCollection(decos);
  };

  useEffect(() => {
    applyPendingDecorations();
    const unsub = usePendingEdits.subscribe(applyPendingDecorations);
    return () => {
      unsub();
      pendingDecosRef.current?.clear();
      pendingDecosRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

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

  const reportStatus = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const model = ed.getModel();
    const pos = ed.getPosition();
    const sel = ed.getSelection();
    if (!model || !pos) return;
    const hasSel = !!sel && !sel.isEmpty();
    const opts = model.getOptions();
    useEditorStatusStore.getState().set({
      line: pos.lineNumber,
      column: pos.column,
      selectionChars: hasSel ? model.getValueInRange(sel).length : 0,
      selectionLines: hasSel ? sel.endLineNumber - sel.startLineNumber + 1 : 0,
      language: model.getLanguageId(),
      indentKind: opts.insertSpaces ? "spaces" : "tabs",
      indentSize: opts.tabSize,
    });
  };

  // Scroll to + focus a position when something (Problems panel, search,
  // go-to-def) requests a reveal for this file.
  const tryReveal = () => {
    const target = useEditorNavStore.getState().pending;
    if (!target || target.path !== path) return;
    const ed = editorRef.current;
    if (!ed) return;
    useEditorNavStore.getState().consume(path);
    ed.revealLineInCenter(target.line);
    ed.setPosition({ lineNumber: target.line, column: target.column });
    ed.focus();
  };

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.setTheme("orion-neon");

    editor.onDidChangeCursorPosition(reportStatus);
    reportStatus();
    tryReveal();
    applyPendingDecorations();
    setMountTick((t) => t + 1);

    // ⌘→ takes the next WORD of a visible ghost suggestion (Cursor parity);
    // the precondition keeps plain ⌘→ = end-of-line when no ghost is shown.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow,
      () => editor.trigger("kb", "editor.action.inlineSuggest.acceptNextWord", null),
      "inlineSuggestionVisible",
    );

    // Feed the recent-edit ring (autocomplete's ripple-edit context).
    editor.onDidChangeModelContent((e) => {
      const first = e.changes[0];
      if (first) recordEdit(path, first.range.startLineNumber);
    });

    editor.onDidFocusEditorWidget(() => {
      reportStatus();
      setEditorActionRunner((actionId) => {
        editorRef.current?.getAction(actionId)?.run();
      });
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
      reportStatus();
    });
  };

  useEffect(() => {
    // Late reveal requests (set after mount) land here.
    const unsub = useEditorNavStore.subscribe(tryReveal);
    return () => {
      unsub();
      setEditorFocus(false);
      setHasSelection(false);
      setSelectionContextProvider(null);
      setEditorActionRunner(null);
      useEditorStatusStore.getState().clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, setEditorFocus, setHasSelection, setSelectionContextProvider]);

  // Read-only only for the file the ⌘K session targets — streamed region
  // edits go through model.pushEditOperations, which bypasses readOnly, so
  // the lock exclusively blocks user keystrokes from racing the stream.
  const inlineEditVisible = useInlineEditStore(
    (s) => s.visible && s.ctx?.path === path,
  );

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
          fontLigatures: true,
          lineHeight: 1.65 * 12.5,
          smoothScrolling: true,
          cursorSmoothCaretAnimation: "on",
          cursorBlinking: "smooth",
          scrollBeyondLastLine: false,
          renderWhitespace: "selection",
          renderLineHighlight: "all",
          wordWrap: "off",
          automaticLayout: true,
          tabSize: 2,
          detectIndentation: true,
          padding: { top: 14, bottom: 14 },
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: "active", indentation: true },
          stickyScroll: { enabled: true },
          folding: true,
          matchBrackets: "always",
          linkedEditing: true,
          occurrencesHighlight: "singleFile",
          suggestSelection: "first",
          parameterHints: { enabled: true },
          inlineSuggest: { enabled: true },
          mouseWheelZoom: true,
          scrollbar: { useShadows: false },
        }}
      />
      <InlineEditSession
        editorRef={editorRef}
        monacoRef={monacoRef}
        path={path}
        mountTick={mountTick}
      />
    </div>
  );
}
