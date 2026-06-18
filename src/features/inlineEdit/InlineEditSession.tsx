import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";
import type { OnMount } from "@monaco-editor/react";
import { Check, Loader2, Sparkles, StopCircle, X } from "lucide-react";
import { useInlineEditStore } from "@/store/inlineEditStore";
import { useProjectStore } from "@/store/projectStore";
import { autoCodebaseContext } from "@/features/context/contextProviders";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { ulid } from "ulid";

type MonacoEditor = Parameters<OnMount>[0];
type MonacoNs = Parameters<OnMount>[1];

const ZONE_MAX_LINES = 10;
const ANSWER_CAP_FOR_DOIT = 2000;

type Props = {
  editorRef: RefObject<MonacoEditor | null>;
  monacoRef: RefObject<MonacoNs | null>;
  path: string;
  /** Bumped by Editor's onMount so activation re-runs once Monaco exists. */
  mountTick: number;
};

/**
 * Cursor-style ⌘K, in the editor instead of a modal: a floating prompt
 * widget anchored at the selection; the rewrite streams INTO the buffer
 * region live (cyan tint) while the original lines sit in a magenta view
 * zone above; accept keeps, reject restores, typing again refines the
 * current result, ⌥↵ asks a question without editing.
 */
export function InlineEditSession({ editorRef, monacoRef, path, mountTick }: Props) {
  const visible = useInlineEditStore((s) => s.visible);
  const ctx = useInlineEditStore((s) => s.ctx);
  const prompt = useInlineEditStore((s) => s.prompt);
  const setPrompt = useInlineEditStore((s) => s.setPrompt);
  const streaming = useInlineEditStore((s) => s.streaming);
  const done = useInlineEditStore((s) => s.done);
  const mode = useInlineEditStore((s) => s.mode);
  const error = useInlineEditStore((s) => s.error);
  const streamedReplacement = useInlineEditStore((s) => s.streamedReplacement);

  const active = visible && ctx?.path === path;

  const nodeRef = useRef<HTMLDivElement | null>(null);
  if (!nodeRef.current && typeof document !== "undefined") {
    nodeRef.current = document.createElement("div");
    nodeRef.current.className = "or-ke-host";
  }
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const widgetRef = useRef<{ getId(): string; getDomNode(): HTMLElement; getPosition(): unknown } | null>(null);
  const regionDecoRef = useRef<string[]>([]);
  const zoneIdRef = useRef<string | null>(null);
  const baselineRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const lastQuestionRef = useRef("");
  const rafRef = useRef<number | null>(null);

  const phase: "input" | "streaming" | "review" | "answer" = streaming
    ? "streaming"
    : done && mode === "ask"
      ? "answer"
      : done || startedRef.current
        ? "review"
        : "input";

  const model = () => editorRef.current?.getModel() ?? null;

  const regionRange = () => {
    const m = model();
    const id = regionDecoRef.current[0];
    if (!m || !id) return null;
    return m.getDecorationRange(id);
  };

  const regionText = () => {
    const m = model();
    const r = regionRange();
    return m && r ? m.getValueInRange(r) : null;
  };

  const setRegionDecoration = (range: NonNullable<ReturnType<typeof regionRange>>) => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    regionDecoRef.current = ed.deltaDecorations(regionDecoRef.current, [
      {
        range,
        options: {
          className: "or-ke-region",
          isWholeLine: false,
          stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
        },
      },
    ]);
  };

  const clearSurgery = () => {
    const ed = editorRef.current;
    if (ed) {
      regionDecoRef.current = ed.deltaDecorations(regionDecoRef.current, []);
      if (zoneIdRef.current) {
        ed.changeViewZones((acc) => {
          if (zoneIdRef.current) acc.removeZone(zoneIdRef.current);
        });
      }
    }
    regionDecoRef.current = [];
    zoneIdRef.current = null;
    baselineRef.current = null;
    startedRef.current = false;
  };

  const restoreBaseline = () => {
    const m = model();
    const r = regionRange();
    if (m && r && baselineRef.current !== null) {
      m.pushEditOperations([], [{ range: r, text: baselineRef.current }], () => null);
    }
  };

  const beginSurgery = () => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    const m = model();
    if (!ed || !monaco || !m || !ctx) return false;
    const start = m.getPositionAt(ctx.selStart);
    const end = m.getPositionAt(ctx.selEnd);
    baselineRef.current = ctx.selectionText;
    startedRef.current = true;
    setRegionDecoration(new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column));

    // Original lines live in a magenta zone above while the rewrite streams.
    const lines = ctx.selectionText.split("\n");
    const shown = lines.slice(0, ZONE_MAX_LINES);
    const more = lines.length - shown.length;
    const dom = document.createElement("div");
    dom.className = "or-ke-zone";
    const pre = document.createElement("pre");
    pre.textContent = shown.join("\n");
    dom.appendChild(pre);
    if (more > 0) {
      const tail = document.createElement("div");
      tail.className = "or-ke-zone-more";
      tail.textContent = `… ${more} more line${more === 1 ? "" : "s"}`;
      dom.appendChild(tail);
    }
    ed.changeViewZones((acc) => {
      zoneIdRef.current = acc.addZone({
        afterLineNumber: Math.max(0, start.lineNumber - 1),
        heightInLines: shown.length + (more > 0 ? 1 : 0),
        domNode: dom,
      });
    });
    ed.revealLineInCenterIfOutsideViewport(start.lineNumber);
    return true;
  };

  /** Up to 2 cross-file snippets from the semantic index — the current
   * file is excluded (its context already surrounds the selection). */
  const gatherRelatedCode = async (instruction: string, selText: string) => {
    try {
      const project = useProjectStore.getState().active;
      if (!project || !ctx?.path.startsWith(project.root_path)) return undefined;
      const hits = await autoCodebaseContext(
        `${instruction}\n${selText.slice(0, 400)}`,
        project.id,
        project.root_path,
        3,
      );
      const crossFile = hits.filter((h) => h.detail !== ctx.path).slice(0, 2);
      if (crossFile.length === 0) return undefined;
      return crossFile.map((r) => `// ${r.label}\n${r.content}`).join("\n\n");
    } catch {
      return undefined; // index not ready — edit proceeds without
    }
  };

  const submit = (ask: boolean) => {
    const p = prompt.trim();
    if (!ctx || streaming || !p) return;
    if (!ask && !startedRef.current && !beginSurgery()) return;
    if (ask) lastQuestionRef.current = p;
    const id = ulid();
    const selText = (startedRef.current ? regionText() : null) ?? ctx.selectionText;
    useInlineEditStore.getState().startStream(id, ask ? "ask" : "edit");
    setPrompt("");
    void (async () => {
      const extraContext = ask ? undefined : await gatherRelatedCode(p, selText);
      // Stale-guard: the user may have cancelled while we searched.
      if (useInlineEditStore.getState().streamId !== id) return;
      await ipc.inlineEditRun(
        id,
        p,
        {
          path: ctx.path,
          language: ctx.language,
          selectionText: selText,
          contextBefore: ctx.contextBefore,
          contextAfter: ctx.contextAfter,
          extraContext,
        },
        ask ? "ask" : "edit",
      );
    })().catch((e) => {
      log.error("inline edit failed", e);
      useInlineEditStore.getState().setError(String(e));
    });
  };

  const accept = () => {
    if (streaming || !startedRef.current) return;
    clearSurgery();
    useInlineEditStore.getState().reset();
    editorRef.current?.focus();
  };

  const rejectOrClose = () => {
    const st = useInlineEditStore.getState();
    if (st.streamId) void ipc.inlineEditCancel(st.streamId);
    if (startedRef.current) restoreBaseline();
    clearSurgery();
    st.reset();
    editorRef.current?.focus();
  };

  const doIt = () => {
    if (streaming) return;
    const answer = streamedReplacement.slice(0, ANSWER_CAP_FOR_DOIT);
    const instruction = `${lastQuestionRef.current}\n\nYou previously answered:\n${answer}\n\nNow apply exactly that as a code change to the selection.`;
    if (!startedRef.current && !beginSurgery()) return;
    const id = ulid();
    const selText = regionText() ?? ctx?.selectionText ?? "";
    useInlineEditStore.getState().startStream(id, "edit");
    void ipc
      .inlineEditRun(
        id,
        instruction,
        {
          path: ctx!.path,
          language: ctx!.language,
          selectionText: selText,
          contextBefore: ctx!.contextBefore,
          contextAfter: ctx!.contextAfter,
        },
        "edit",
      )
      .catch((e) => {
        log.error("inline edit failed", e);
        useInlineEditStore.getState().setError(String(e));
      });
  };

  // ── Content widget lifecycle ───────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    const m = model();
    if (!ed || !monaco || !m || !ctx || !nodeRef.current) return;

    const widget = {
      getId: () => "orion.inline-edit",
      getDomNode: () => nodeRef.current!,
      allowEditorOverflow: true,
      getPosition: () => {
        const r = regionRange();
        const liveCtx = useInlineEditStore.getState().ctx;
        const anchor = liveCtx ? liveCtx.selStart : ctx.selStart;
        const line = r ? r.startLineNumber : m.getPositionAt(anchor).lineNumber;
        return {
          position: { lineNumber: line, column: 1 },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW,
          ],
        };
      },
    };
    widgetRef.current = widget;
    ed.addContentWidget(widget);
    const t = setTimeout(() => inputRef.current?.focus(), 0);

    return () => {
      clearTimeout(t);
      ed.removeContentWidget(widget);
      widgetRef.current = null;
      // Tab closed / editor unmounted mid-session: treat as reject so the
      // buffer never strands in a half-streamed state.
      const st = useInlineEditStore.getState();
      if (st.visible && st.ctx?.path === path) {
        if (st.streamId) void ipc.inlineEditCancel(st.streamId);
        if (startedRef.current) restoreBaseline();
        st.reset();
      }
      clearSurgery();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mountTick]);

  // ── Stream → buffer (rAF-coalesced) ────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    const unsub = useInlineEditStore.subscribe((s, prev) => {
      if (s.streamedReplacement === prev.streamedReplacement) return;
      if (s.mode !== "edit" || !startedRef.current) return;
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const m = model();
        const monaco = monacoRef.current;
        const r = regionRange();
        if (!m || !monaco || !r) return;
        const text = useInlineEditStore.getState().streamedReplacement;
        m.pushEditOperations([], [{ range: r, text }], () => null);
        const startOffset = m.getOffsetAt({ lineNumber: r.startLineNumber, column: r.startColumn });
        const endPos = m.getPositionAt(startOffset + text.length);
        setRegionDecoration(
          new monaco.Range(r.startLineNumber, r.startColumn, endPos.lineNumber, endPos.column),
        );
      });
    });
    return () => {
      unsub();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Refocus the input when a phase needs typing again.
  useEffect(() => {
    if (active && (phase === "review" || phase === "answer" || phase === "input")) {
      inputRef.current?.focus();
    }
  }, [active, phase]);

  const placeholder = useMemo(() => {
    if (phase === "review") return "Refine further… (⌘↵ accept · esc reject)";
    if (phase === "answer") return "Ask again… (⌥↵)";
    return "Edit selection… (↵ edit · ⌥↵ ask)";
  }, [phase]);

  if (!active || !nodeRef.current) return null;

  return createPortal(
    <div className="or-ke-card" onMouseDown={(e) => e.stopPropagation()}>
      <div className="or-ke-toprow">
        <Sparkles size={12} className="or-ke-spark" />
        <textarea
          ref={inputRef}
          className="or-ke-input"
          value={prompt}
          rows={Math.min(3, prompt.split("\n").length)}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              rejectOrClose();
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (phase === "review") accept();
            } else if (e.key === "Enter" && e.altKey) {
              e.preventDefault();
              submit(true);
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(false);
            }
          }}
        />
      </div>

      {phase === "streaming" && (
        <div className="or-ke-status">
          <Loader2 size={11} className="or-ke-spin" />
          <span>{mode === "ask" ? "thinking…" : "rewriting…"}</span>
          <button type="button" className="or-ke-mini" onClick={rejectOrClose} title="Stop and restore">
            <StopCircle size={11} /> stop
          </button>
        </div>
      )}

      {phase === "answer" && streamedReplacement && (
        <div className="or-ke-answer">{streamedReplacement}</div>
      )}
      {phase === "streaming" && mode === "ask" && streamedReplacement && (
        <div className="or-ke-answer">{streamedReplacement}</div>
      )}

      {error && <div className="or-ke-error">{error}</div>}

      {phase === "review" && (
        <div className="or-ke-actions">
          <button type="button" className="or-ke-btn accept" onClick={accept}>
            <Check size={12} /> Accept <kbd>⌘↵</kbd>
          </button>
          <button type="button" className="or-ke-btn reject" onClick={rejectOrClose}>
            <X size={12} /> Reject <kbd>esc</kbd>
          </button>
          <span className="or-ke-hint">or type to refine</span>
        </div>
      )}

      {phase === "answer" && (
        <div className="or-ke-actions">
          <button type="button" className="or-ke-btn accept" onClick={doIt}>
            <Check size={12} /> Do it
          </button>
          <button type="button" className="or-ke-btn" onClick={rejectOrClose}>
            Close <kbd>esc</kbd>
          </button>
        </div>
      )}
    </div>,
    nodeRef.current,
  );
}
