import { useState } from "react";
import { X, Home, Plus } from "lucide-react";
import { flushActive, useXDProjects } from "./projectsStore";
import { ProjectNameInput } from "./ProjectNameInput";
import { useXDesignSaveState } from "./saveState";

export function XDesignTabs() {
  const registry = useXDProjects((s) => s.registry);
  const openTabs = useXDProjects((s) => s.openTabs);
  const activeId = useXDProjects((s) => s.activeId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const names = useXDesignSaveState((s) => s.names);
  const unsaved = useXDesignSaveState((s) => activeId ? s.documents[activeId] : undefined);
  const [saving, setSaving] = useState(false);

  const nameOf = (id: string) =>
    registry.find((m) => m.id === id)?.name ?? "Untitled";

  const retrySave = async () => {
    setSaving(true);
    try { await flushActive(); } catch { /* flushActive reports the failure and retains dirty state. */ }
    finally { setSaving(false); }
  };

  return (
    <div className="xd-tabs">
      <button
        type="button"
        className="xd-tab-home"
        onClick={() => void useXDProjects.getState().goHome().catch(() => {})}
        title="Home"
        aria-label="Home"
      >
        <Home size={14} />
      </button>
      <div className="xd-tabs-strip">
        {openTabs.map((id) => (
          <div
            key={id}
            className={`xd-tab${id === activeId ? " active" : ""}`}
            onClick={() => void useXDProjects.getState().switchTo(id).catch(() => {})}
            onDoubleClick={() => {
              setEditingId(id);
            }}
            title={nameOf(id)}
          >
            {editingId === id || names[id] ? (
              <ProjectNameInput id={id} name={nameOf(id)} className="xd-tab-rename"
                onFinish={() => setEditingId((current) => current === id ? null : current)} />
            ) : (
              <span className="xd-tab-label">{nameOf(id)}</span>
            )}
            <button
              type="button"
              className="xd-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                void useXDProjects.getState().closeTab(id).catch(() => {});
              }}
              aria-label={`Close ${nameOf(id)}`}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {unsaved && <button type="button" className="xd-tab-save" disabled={saving}
        onClick={() => void retrySave()} title={unsaved.error ?? "Save the current project"}>
        {saving ? "Saving…" : unsaved.error ? "Retry save" : "Unsaved · Save"}
      </button>}
      <button
        type="button"
        className="xd-tab-new"
        onClick={() => void useXDProjects.getState().newProject().catch(() => {})}
        title="New project"
        aria-label="New project"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
