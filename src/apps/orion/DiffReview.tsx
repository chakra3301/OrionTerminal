import { Check, X, FilePlus } from "lucide-react";
import { DiffEditor } from "@monaco-editor/react";
import { usePendingEdits } from "@/store/pendingEditsStore";
import { languageForPath } from "@/apps/orion/lang";
import { acceptEdit, rejectEdit } from "@/features/aiEdits/pendingEditsActions";
import { useWorkspace } from "@/components/workspace/workspaceStore";

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export function OrionDiffReview({ path }: { path: string }) {
  const edit = usePendingEdits((s) => s.edits[path]);

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

  return (
    <div className="or-diff-review">
      <div className="or-diff-bar">
        <div className="or-diff-file">
          {edit.isNew && <FilePlus size={12} color="var(--neon-green)" />}
          <span>{basename(path)}</span>
          {edit.isNew && <span className="or-diff-badge">new file</span>}
        </div>
        <div className="or-diff-actions">
          <button
            type="button"
            className="or-diff-btn reject"
            onClick={() => void rejectEdit(path)}
            title="Discard this change"
          >
            <X size={13} /> Reject
          </button>
          <button
            type="button"
            className="or-diff-btn accept"
            onClick={onAccept}
            title="Keep this change"
          >
            <Check size={13} /> Accept
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
