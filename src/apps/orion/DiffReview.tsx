import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X, FilePlus, ChevronUp, ChevronDown } from "lucide-react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { usePendingEdits } from "@/store/pendingEditsStore";
import { languageForPath } from "@/apps/orion/lang";
import {
  acceptEdit,
  rejectEdit,
  acceptHunk,
  rejectHunk,
} from "@/features/aiEdits/pendingEditsActions";
import { computeHunks, hunkStats } from "@/features/aiEdits/lineDiff";
import { useWorkspace } from "@/components/workspace/workspaceStore";

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export function OrionDiffReview({ path }: { path: string }) {
  const edit = usePendingEdits((s) => s.edits[path]);
  const diffRef = useRef<Parameters<DiffOnMount>[0] | null>(null);
  const [hunkIdx, setHunkIdx] = useState(0);

  // Hunks always equal the remaining UNDECIDED diff — accept folds into
  // original, reject folds out of updated, so this memo shrinks as the
  // user works through the review.
  const hunks = useMemo(
    () => (edit && !edit.isNew ? computeHunks(edit.original, edit.updated) : []),
    [edit],
  );
  const idx = Math.min(hunkIdx, Math.max(0, hunks.length - 1));
  const stats = useMemo(() => hunkStats(hunks), [hunks]);

  // Keep the diff view centered on the active hunk.
  useEffect(() => {
    const h = hunks[idx];
    if (!h || !diffRef.current) return;
    const line = h.newLines.length > 0 ? h.newStart + 1 : Math.max(1, h.newStart);
    diffRef.current.getModifiedEditor().revealLineInCenter(line);
  }, [idx, hunks]);

  if (!edit) {
    return (
      <div className="or-diff-review or-diff-review--done">
        <Check size={18} color="var(--neon-green)" />
        <span>Reviewed — no pending change for this file.</span>
      </div>
    );
  }

  const onAccept = () => {
    acceptEdit(path);
    useWorkspace.getState().openTab({ kind: "file", path });
  };

  const multiHunk = hunks.length > 1;

  return (
    <div className="or-diff-review">
      <div className="or-diff-bar">
        <div className="or-diff-file">
          {edit.isNew && <FilePlus size={12} color="var(--neon-green)" />}
          <span>{basename(path)}</span>
          {edit.isNew && <span className="or-diff-badge">new file</span>}
          {!edit.isNew && (
            <span className="or-diff-stats">
              <em className="add">+{stats.added}</em>
              <em className="del">−{stats.removed}</em>
            </span>
          )}
        </div>
        {multiHunk && (
          <div className="or-diff-hunknav">
            <button
              type="button"
              className="or-diff-iconbtn"
              title="Previous change"
              onClick={() => setHunkIdx((i) => (i - 1 + hunks.length) % hunks.length)}
            >
              <ChevronUp size={13} />
            </button>
            <span className="or-diff-hunkcount">
              {idx + 1}/{hunks.length}
            </span>
            <button
              type="button"
              className="or-diff-iconbtn"
              title="Next change"
              onClick={() => setHunkIdx((i) => (i + 1) % hunks.length)}
            >
              <ChevronDown size={13} />
            </button>
            <button
              type="button"
              className="or-diff-btn reject sm"
              title="Revert just this change"
              onClick={() => void rejectHunk(path, idx)}
            >
              <X size={12} /> Hunk
            </button>
            <button
              type="button"
              className="or-diff-btn accept sm"
              title="Keep just this change"
              onClick={() => acceptHunk(path, idx)}
            >
              <Check size={12} /> Hunk
            </button>
          </div>
        )}
        <div className="or-diff-actions">
          <button
            type="button"
            className="or-diff-btn reject"
            onClick={() => void rejectEdit(path)}
            title={multiHunk ? "Discard all remaining changes" : "Discard this change"}
          >
            <X size={13} /> {multiHunk ? "Reject all" : "Reject"}
          </button>
          <button
            type="button"
            className="or-diff-btn accept"
            onClick={onAccept}
            title={multiHunk ? "Keep all remaining changes" : "Keep this change"}
          >
            <Check size={13} /> {multiHunk ? "Accept all" : "Accept"}
          </button>
        </div>
      </div>
      <div className="or-diff-body">
        <DiffEditor
          height="100%"
          language={languageForPath(path)}
          original={edit.original}
          modified={edit.updated}
          theme="orion-neon"
          onMount={(editor) => {
            diffRef.current = editor;
          }}
          options={{
            renderSideBySide: false,
            readOnly: true,
            originalEditable: false,
            minimap: { enabled: false },
            fontSize: 12.5,
            fontFamily:
              "JetBrains Mono, SF Mono, ui-monospace, Menlo, monospace",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            renderOverviewRuler: false,
            renderLineHighlight: "none",
          }}
        />
      </div>
    </div>
  );
}
