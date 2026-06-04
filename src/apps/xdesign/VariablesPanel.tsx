import { useState } from "react";
import { Plus, Trash2, Variable as VariableIcon } from "lucide-react";
import { useXDesign, type Variable } from "@/apps/xdesign/store";

function VariableRow({ v }: { v: Variable }) {
  const activeModeId = useXDesign((s) => s.activeModeId);
  const renameVariable = useXDesign((s) => s.renameVariable);
  const setVariableValue = useXDesign((s) => s.setVariableValue);
  const removeVariable = useXDesign((s) => s.removeVariable);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(v.name);

  const value = v.values[activeModeId] ?? Object.values(v.values)[0] ?? "";
  const stringValue = typeof value === "string" ? value : String(value);

  return (
    <div className="xd-var-row">
      <input
        type="color"
        className="xd-var-swatch"
        value={
          typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
            ? value
            : "#888888"
        }
        title={stringValue}
        onChange={(e) => setVariableValue(v.id, activeModeId, e.target.value)}
        aria-label={`Color for ${v.name}`}
      />
      {editing ? (
        <input
          className="xd-var-name-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const trimmed = draft.trim();
            if (trimmed) renameVariable(v.id, trimmed);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(v.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="xd-var-name"
          onClick={() => {
            setDraft(v.name);
            setEditing(true);
          }}
          title="Rename"
        >
          {v.name}
        </button>
      )}
      <input
        type="text"
        className="xd-var-value-input"
        value={stringValue}
        onChange={(e) => setVariableValue(v.id, activeModeId, e.target.value)}
        spellCheck={false}
      />
      <button
        type="button"
        className="xd-var-del"
        title="Delete variable"
        onClick={() => removeVariable(v.id)}
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}

function ModesBar() {
  const modes = useXDesign((s) => s.modes);
  const activeModeId = useXDesign((s) => s.activeModeId);
  const setActiveMode = useXDesign((s) => s.setActiveMode);
  const addMode = useXDesign((s) => s.addMode);
  const removeMode = useXDesign((s) => s.removeMode);
  const renameMode = useXDesign((s) => s.renameMode);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <div className="xd-modes">
      {modes.map((m) => {
        const isActive = m.id === activeModeId;
        const isEditing = editingId === m.id;
        return (
          <div
            key={m.id}
            className={`xd-mode${isActive ? " active" : ""}`}
            onClick={() => {
              if (!isEditing) setActiveMode(m.id);
            }}
            onDoubleClick={() => {
              setEditingId(m.id);
              setDraft(m.name);
            }}
            role="button"
            tabIndex={0}
          >
            {isEditing ? (
              <input
                className="xd-mode-name-input"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  const trimmed = draft.trim();
                  if (trimmed) renameMode(m.id, trimmed);
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    setDraft(m.name);
                    setEditingId(null);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="xd-mode-name">{m.name}</span>
            )}
            {modes.length > 1 && !isEditing && (
              <button
                type="button"
                className="xd-mode-del"
                title="Delete mode"
                onClick={(e) => {
                  e.stopPropagation();
                  removeMode(m.id);
                }}
              >
                <Trash2 size={9} />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="xd-mode-add"
        title="New mode"
        onClick={() => {
          const name = `Mode ${modes.length + 1}`;
          const id = addMode(name);
          setActiveMode(id);
        }}
      >
        <Plus size={10} />
      </button>
    </div>
  );
}

export function XDesignVariablesPanel() {
  const variables = useXDesign((s) => s.variables);
  const addVariable = useXDesign((s) => s.addVariable);
  const [open, setOpen] = useState(false);

  const handleAdd = () => {
    const idx = variables.length + 1;
    addVariable(`color-${idx}`, "#39ff88", "color");
    setOpen(true);
  };

  return (
    <div className="xd-vars">
      <div className="xd-vars-head">
        <button
          type="button"
          className="xd-vars-toggle"
          onClick={() => setOpen((o) => !o)}
        >
          <VariableIcon size={11} />
          <span>Variables</span>
          <span className="xd-vars-count">{variables.length}</span>
        </button>
        <button
          type="button"
          className="xd-vars-add"
          title="New variable"
          onClick={handleAdd}
        >
          <Plus size={11} />
        </button>
      </div>
      {open && (
        <>
          <ModesBar />
          {variables.length === 0 ? (
            <div className="xd-vars-empty">
              No variables yet. Press + to create one.
            </div>
          ) : (
            <div className="xd-vars-list">
              {variables.map((v) => (
                <VariableRow key={v.id} v={v} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
