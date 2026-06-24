import { useState } from "react";
import { X, Home, Plus } from "lucide-react";
import { useXDProjects } from "./projectsStore";

export function XDesignTabs() {
  const registry = useXDProjects((s) => s.registry);
  const openTabs = useXDProjects((s) => s.openTabs);
  const activeId = useXDProjects((s) => s.activeId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const nameOf = (id: string) =>
    registry.find((m) => m.id === id)?.name ?? "Untitled";

  const commit = (id: string) => {
    setEditingId(null);
    if (draft.trim()) void useXDProjects.getState().renameProject(id, draft);
  };

  return (
    <div className="xd-tabs">
      <button
        type="button"
        className="xd-tab-home"
        onClick={() => void useXDProjects.getState().goHome()}
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
            onClick={() => void useXDProjects.getState().switchTo(id)}
            onDoubleClick={() => {
              setDraft(nameOf(id));
              setEditingId(id);
            }}
            title={nameOf(id)}
          >
            {editingId === id ? (
              <input
                className="xd-tab-rename"
                value={draft}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit(id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit(id);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <span className="xd-tab-label">{nameOf(id)}</span>
            )}
            <button
              type="button"
              className="xd-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                void useXDProjects.getState().closeTab(id);
              }}
              aria-label={`Close ${nameOf(id)}`}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="xd-tab-new"
        onClick={() => void useXDProjects.getState().newProject()}
        title="New project"
        aria-label="New project"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
