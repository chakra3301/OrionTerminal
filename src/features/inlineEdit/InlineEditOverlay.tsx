import { DiffEditor } from "@monaco-editor/react";
import { useEffect, useMemo, useRef } from "react";
import { useInlineEditStore } from "@/store/inlineEditStore";
import { useTabsStore } from "@/store/tabsStore";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { ulid } from "ulid";
import { Loader2 } from "lucide-react";

export function InlineEditOverlay() {
  const visible = useInlineEditStore((s) => s.visible);
  const prompt = useInlineEditStore((s) => s.prompt);
  const setPrompt = useInlineEditStore((s) => s.setPrompt);
  const streaming = useInlineEditStore((s) => s.streaming);
  const error = useInlineEditStore((s) => s.error);
  const ctx = useInlineEditStore((s) => s.ctx);
  const streamId = useInlineEditStore((s) => s.streamId);
  const replacement = useInlineEditStore((s) => s.streamedReplacement);
  const startStream = useInlineEditStore((s) => s.startStream);
  const reset = useInlineEditStore((s) => s.reset);
  const setError = useInlineEditStore((s) => s.setError);
  const updateBuffer = useTabsStore((s) => s.updateBuffer);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  const original = ctx?.fullContent ?? "";
  const modified = useMemo(() => {
    if (!ctx) return "";
    const before = original.slice(0, ctx.selStart);
    const after = original.slice(ctx.selEnd);
    return before + replacement + after;
  }, [original, ctx, replacement]);

  const submit = async () => {
    if (!ctx || !prompt.trim() || streaming) return;
    const id = ulid();
    startStream(id);
    try {
      await ipc.inlineEditRun(id, prompt.trim(), {
        path: ctx.path,
        language: ctx.language,
        selectionText: ctx.selectionText,
        contextBefore: ctx.contextBefore,
        contextAfter: ctx.contextAfter,
      });
    } catch (e) {
      log.error("inline edit failed", e);
      setError(String(e));
    }
  };

  const accept = () => {
    if (!ctx || streaming) return;
    updateBuffer(ctx.path, modified);
    reset();
  };

  const cancel = () => {
    if (streamId) void ipc.inlineEditCancel(streamId);
    reset();
  };

  if (!visible) return null;

  const showDiff = streaming || replacement.length > 0;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center pt-12 bg-black/50 backdrop-blur-sm">
      <div className="w-[min(900px,92vw)] max-h-[80vh] flex flex-col rounded-xl border border-border bg-bg-elevated shadow-2xl overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <span className="text-xs font-mono uppercase tracking-wider text-fg-subtle">
            Inline edit
          </span>
          <span className="text-xs text-fg-subtle truncate">{ctx?.path}</span>
          <div className="ml-auto text-[11px] text-fg-subtle font-mono">
            ↵ stream · ⌘↵ accept · Esc cancel
          </div>
        </header>

        <div className="px-4 py-3 border-b border-border">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What change should I make to the selection?"
            rows={2}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent resize-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                accept();
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="flex items-center gap-2 mt-2">
            {streaming ? (
              <>
                <Loader2 size={12} className="animate-spin text-fg-subtle" />
                <span className="text-xs text-fg-subtle">streaming…</span>
              </>
            ) : showDiff ? (
              <span className="text-xs text-fg-subtle">
                ⌘↵ to accept, Esc to discard
              </span>
            ) : (
              <span className="text-xs text-fg-subtle">↵ to send</span>
            )}
            {error && (
              <span className="text-xs text-red-400 truncate">{error}</span>
            )}
          </div>
        </div>

        {showDiff && (
          <div className="flex-1 min-h-[300px] bg-bg">
            <DiffEditor
              height="100%"
              language={ctx?.language ?? "plaintext"}
              original={original}
              modified={modified}
              theme="orion-neon"
              options={{
                renderSideBySide: false,
                readOnly: true,
                originalEditable: false,
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: "JetBrains Mono, SF Mono, ui-monospace, Menlo, monospace",
                automaticLayout: true,
                scrollBeyondLastLine: false,
                renderOverviewRuler: false,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
