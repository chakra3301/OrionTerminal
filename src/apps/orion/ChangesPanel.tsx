import { Check, X, FilePlus, FileDiff, CheckCheck } from "lucide-react";
import { usePendingEdits } from "@/store/pendingEditsStore";
import {
  acceptEdit,
  rejectEdit,
  acceptAllEdits,
  rejectAllEdits,
} from "@/features/aiEdits/pendingEditsActions";
import { useWorkspace } from "@/components/workspace/workspaceStore";

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** Rough +/- line counts for a quick at-a-glance magnitude. */
function lineDelta(original: string, updated: string): { add: number; del: number } {
  const o = original ? original.split("\n").length : 0;
  const u = updated ? updated.split("\n").length : 0;
  const diff = u - o;
  return { add: Math.max(0, diff), del: Math.max(0, -diff) };
}

export function OrionChangesPanel() {
  const edits = usePendingEdits((s) => s.edits);
  const order = usePendingEdits((s) => s.order);

  const open = (path: string) =>
    useWorkspace.getState().openTab({ kind: "diff-review", path });

  if (order.length === 0) {
    return (
      <div className="or-changes or-changes--empty">
        <CheckCheck size={18} color="var(--neon-green)" />
        <span>No pending changes</span>
      </div>
    );
  }

  return (
    <div className="or-changes">
      <div className="or-changes-head">
        <span className="or-changes-count">
          {order.length} {order.length === 1 ? "file" : "files"} changed
        </span>
        <div className="or-changes-bulk">
          <button
            type="button"
            className="or-diff-btn reject"
            onClick={() => void rejectAllEdits()}
          >
            <X size={12} /> Reject all
          </button>
          <button
            type="button"
            className="or-diff-btn accept"
            onClick={() => acceptAllEdits()}
          >
            <Check size={12} /> Accept all
          </button>
        </div>
      </div>
      <div className="or-changes-list">
        {order.map((path) => {
          const e = edits[path];
          if (!e) return null;
          const { add, del } = lineDelta(e.original, e.updated);
          return (
            <div key={path} className="or-changes-row" onClick={() => open(path)}>
              {e.isNew ? (
                <FilePlus size={12} color="var(--neon-green)" />
              ) : (
                <FileDiff size={12} color="var(--neon-cyan)" />
              )}
              <span className="or-changes-name">{basename(path)}</span>
              {(add > 0 || del > 0) && (
                <span className="or-changes-delta">
                  {add > 0 && <span className="add">+{add}</span>}
                  {del > 0 && <span className="del">-{del}</span>}
                </span>
              )}
              <span className="or-changes-rowact">
                <button
                  type="button"
                  title="Reject"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void rejectEdit(path);
                  }}
                >
                  <X size={12} />
                </button>
                <button
                  type="button"
                  title="Accept"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    acceptEdit(path);
                  }}
                >
                  <Check size={12} />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
