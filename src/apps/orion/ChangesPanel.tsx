import { useState } from "react";
import {
  Check,
  X,
  FilePlus,
  FileDiff,
  CheckCheck,
  Plus,
  Minus,
  Undo2,
  Wand2,
  GitCommitHorizontal,
  ArrowUp,
  Loader2,
} from "lucide-react";
import { usePendingEdits } from "@/store/pendingEditsStore";
import {
  acceptEdit,
  rejectEdit,
  acceptAllEdits,
  rejectAllEdits,
} from "@/features/aiEdits/pendingEditsActions";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import { useGit, type GitFileState } from "@/store/gitStore";
import { useProjectStore } from "@/store/projectStore";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import { confirmAction } from "@/components/ConfirmModal";
import { log } from "@/lib/log";

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

function statusLetter(f: GitFileState): string {
  const w = f.worktree.trim();
  const i = f.index.trim();
  const l = w || i;
  return l === "?" ? "U" : l;
}

function AiEditsSection() {
  const edits = usePendingEdits((s) => s.edits);
  const order = usePendingEdits((s) => s.order);
  const open = (path: string) =>
    useWorkspace.getState().openTab({ kind: "diff-review", path });

  if (order.length === 0) return null;

  return (
    <>
      <div className="or-changes-head">
        <span className="or-changes-count">
          AI edits · {order.length} {order.length === 1 ? "file" : "files"}
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
    </>
  );
}

function GitRow({
  file,
  staged,
  root,
}: {
  file: GitFileState;
  staged: boolean;
  root: string;
}) {
  const refresh = useGit((s) => s.refresh);
  const letter = staged ? file.index.trim() : statusLetter(file);

  const openFile = () => {
    const abs = `${root}/${file.path}`;
    useWorkspace
      .getState()
      .openTab({ kind: "file", path: abs }, { label: basename(file.path), preferRole: "editor" });
  };

  const act = async (fn: () => Promise<void>, label: string) => {
    try {
      await fn();
    } catch (e) {
      log.error(`${label} failed`, e);
      toast.error(`${label} failed`, {
        body: e instanceof Error ? e.message : String(e),
      });
    }
    refresh();
  };

  return (
    <div className="or-changes-row" onClick={openFile}>
      <span className={`or-git-letter k-${letter}`}>{letter}</span>
      <span className="or-changes-name">{basename(file.path)}</span>
      <span className="or-changes-dir">{file.path.split("/").slice(0, -1).join("/")}</span>
      <span className="or-changes-rowact">
        {staged ? (
          <button
            type="button"
            title="Unstage"
            onClick={(ev) => {
              ev.stopPropagation();
              void act(() => ipc.gitUnstage(root, [file.path]), "Unstage");
            }}
          >
            <Minus size={12} />
          </button>
        ) : (
          <>
            <button
              type="button"
              title="Discard changes"
              onClick={(ev) => {
                ev.stopPropagation();
                void (async () => {
                  const ok = await confirmAction({
                    title: `Discard changes in ${basename(file.path)}?`,
                    body: "Restores the file to its last committed state. This cannot be undone.",
                    confirmLabel: "Discard",
                    danger: true,
                  });
                  if (ok) await act(() => ipc.gitDiscard(root, [file.path]), "Discard");
                })();
              }}
            >
              <Undo2 size={12} />
            </button>
            <button
              type="button"
              title="Stage"
              onClick={(ev) => {
                ev.stopPropagation();
                void act(() => ipc.gitStage(root, [file.path]), "Stage");
              }}
            >
              <Plus size={12} />
            </button>
          </>
        )}
      </span>
    </div>
  );
}

function GitSection() {
  const isRepo = useGit((s) => s.isRepo);
  const files = useGit((s) => s.files);
  const ahead = useGit((s) => s.ahead);
  const refresh = useGit((s) => s.refresh);
  const project = useProjectStore((s) => s.active);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"" | "ai" | "commit" | "push">("");

  if (!project || !isRepo) return null;
  const root = project.root_path;

  const all = [...files.values()];
  const staged = all.filter((f) => {
    const i = f.index.trim();
    return i !== "" && i !== "?";
  });
  const unstaged = all.filter((f) => f.worktree.trim() !== "");

  const generateMessage = async () => {
    setBusy("ai");
    try {
      const diff = await ipc.gitWorkingDiff(root);
      const msg = await ipc.claudeOneshot(
        `Write a conventional-commit message for this diff. First line: type(scope): summary under 65 chars. If the change warrants it, add a short body (2-4 bullet lines) after a blank line. Output ONLY the commit message.\n\n${diff.slice(0, 24_000)}`,
      );
      if (msg.trim()) setMessage(msg.trim());
    } catch (e) {
      toast.error("Couldn't generate a message", {
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy("");
    }
  };

  const commit = async () => {
    setBusy("commit");
    try {
      await ipc.gitCommit(root, message.trim());
      setMessage("");
      toast.success("Committed", { body: message.trim().split("\n")[0] });
    } catch (e) {
      toast.error("Commit failed", {
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy("");
      refresh();
    }
  };

  const push = async () => {
    setBusy("push");
    try {
      const out = await ipc.gitPush(root);
      toast.success("Pushed", { body: out.trim().split("\n")[0] || undefined });
    } catch (e) {
      toast.error("Push failed", {
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy("");
      refresh();
    }
  };

  return (
    <>
      <div className="or-changes-head">
        <span className="or-changes-count">Source control</span>
        <div className="or-changes-bulk">
          {unstaged.length > 0 && (
            <button
              type="button"
              className="or-diff-btn"
              title="Stage all changes"
              onClick={() =>
                void ipc
                  .gitStage(root, unstaged.map((f) => f.path))
                  .catch((e) => toast.error("Stage all failed", { body: String(e) }))
                  .finally(refresh)
              }
            >
              <Plus size={12} /> Stage all
            </button>
          )}
        </div>
      </div>

      <div className="or-git-commitbox">
        <textarea
          value={message}
          rows={Math.min(4, Math.max(1, message.split("\n").length))}
          placeholder={`Commit message (${staged.length} staged)`}
          spellCheck={false}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="or-git-commitrow">
          <button
            type="button"
            className="or-diff-btn"
            title="Generate message from the working diff"
            disabled={busy !== ""}
            onClick={() => void generateMessage()}
          >
            {busy === "ai" ? <Loader2 size={12} className="or-ke-spin" /> : <Wand2 size={12} />}
            AI
          </button>
          <button
            type="button"
            className="or-diff-btn accept"
            disabled={busy !== "" || staged.length === 0 || !message.trim()}
            title={staged.length === 0 ? "Stage files first" : "Commit staged files"}
            onClick={() => void commit()}
          >
            {busy === "commit" ? (
              <Loader2 size={12} className="or-ke-spin" />
            ) : (
              <GitCommitHorizontal size={12} />
            )}
            Commit
          </button>
          <button
            type="button"
            className="or-diff-btn"
            disabled={busy !== ""}
            title="git push"
            onClick={() => void push()}
          >
            {busy === "push" ? (
              <Loader2 size={12} className="or-ke-spin" />
            ) : (
              <ArrowUp size={12} />
            )}
            Push{ahead > 0 ? ` ${ahead}` : ""}
          </button>
        </div>
      </div>

      {staged.length > 0 && (
        <>
          <div className="or-git-subhead">staged · {staged.length}</div>
          <div className="or-changes-list">
            {staged.map((f) => (
              <GitRow key={`s-${f.path}`} file={f} staged root={root} />
            ))}
          </div>
        </>
      )}
      <div className="or-git-subhead">changes · {unstaged.length}</div>
      <div className="or-changes-list">
        {unstaged.length === 0 && (
          <div className="or-git-clean">working tree clean</div>
        )}
        {unstaged.map((f) => (
          <GitRow key={`w-${f.path}`} file={f} staged={false} root={root} />
        ))}
      </div>
    </>
  );
}

export function OrionChangesPanel() {
  const order = usePendingEdits((s) => s.order);
  const isRepo = useGit((s) => s.isRepo);

  if (order.length === 0 && !isRepo) {
    return (
      <div className="or-changes or-changes--empty">
        <CheckCheck size={18} color="var(--neon-green)" />
        <span>No pending changes</span>
      </div>
    );
  }

  return (
    <div className="or-changes">
      <AiEditsSection />
      <GitSection />
    </div>
  );
}
