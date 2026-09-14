import { useRef } from "react";
import { useXDProjects } from "./projectsStore";
import { setProjectNameDraft, useXDesignSaveState } from "./saveState";

export function ProjectNameInput({ id, name, className, onFinish }: {
  id: string; name: string; className: string; onFinish: () => void;
}) {
  const draft = useXDesignSaveState((s) => s.names[id]);
  const finished = useRef(false);
  const close = () => { finished.current = true; setProjectNameDraft(id, null); onFinish(); };
  const submit = async () => {
    const current = useXDesignSaveState.getState().names[id];
    if (finished.current || current?.saving) return;
    const value = current?.value ?? name;
    if (!value.trim() || value.trim() === name) { close(); return; }
    setProjectNameDraft(id, { value, saving: true });
    try {
      await useXDProjects.getState().renameProject(id, value);
      close();
    } catch (error) {
      setProjectNameDraft(id, { value, saving: false, error: String(error) });
    }
  };
  return <input
    className={className}
    aria-label="Project name"
    aria-invalid={!!draft?.error}
    title={draft?.error ? `${draft.error}. Press Enter to retry or Escape to discard.` : "Enter to save; Escape to discard"}
    value={draft?.value ?? name}
    readOnly={draft?.saving}
    autoFocus
    onClick={(e) => e.stopPropagation()}
    onDoubleClick={(e) => e.stopPropagation()}
    onChange={(e) => {
      if (!useXDesignSaveState.getState().names[id]?.saving) setProjectNameDraft(id, { value: e.target.value, saving: false });
    }}
    onBlur={() => void submit()}
    onKeyDown={(e) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Enter") void submit();
      else if (!useXDesignSaveState.getState().names[id]?.saving) close();
    }}
  />;
}
