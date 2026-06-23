import { useState } from "react";
import { Palette, Plus, Trash2, Copy, Check, Sparkles } from "lucide-react";
import { ulid } from "ulid";
import { useDesignSystems } from "@/store/designSystemStore";
import { useXDesign } from "@/apps/xdesign/store";
import type { DesignSystem, DSColor } from "@/apps/xdesign/designSystem";
import { toast } from "@/store/toastStore";

function blankSystem(name: string): DesignSystem {
  const now = Date.now();
  return {
    id: `ds-${ulid()}`,
    name,
    builtin: false,
    aesthetic: "",
    colors: [
      { name: "brand", value: "#00e0ff", role: "Primary accent" },
      { name: "surface", value: "#0a0a0a", role: "Background" },
      { name: "ink", value: "#f2f2f2", role: "Text" },
    ],
    typography: [],
    voice: "",
    principles: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Compact editor for a single (non-builtin) design system. */
function BrandEditor({ ds, onClose }: { ds: DesignSystem; onClose: () => void }) {
  const save = useDesignSystems((s) => s.save);
  const [draft, setDraft] = useState<DesignSystem>(ds);

  const patch = (p: Partial<DesignSystem>) =>
    setDraft((d) => ({ ...d, ...p }));
  const patchColor = (i: number, p: Partial<DSColor>) =>
    setDraft((d) => ({
      ...d,
      colors: d.colors.map((c, idx) => (idx === i ? { ...c, ...p } : c)),
    }));

  const commit = () => {
    void save({ ...draft, updatedAt: Date.now() });
    onClose();
  };

  return (
    <div className="xd-brand-editor">
      <input
        className="xd-brand-input"
        value={draft.name}
        placeholder="System name"
        onChange={(e) => patch({ name: e.target.value })}
      />
      <input
        className="xd-brand-input"
        value={draft.aesthetic ?? ""}
        placeholder="Aesthetic direction (e.g. bold / editorial)"
        onChange={(e) => patch({ aesthetic: e.target.value })}
      />
      <div className="xd-brand-sub">Colors</div>
      {draft.colors.map((c, i) => (
        <div className="xd-brand-color-row" key={i}>
          <input
            type="color"
            className="xd-var-swatch"
            value={/^#[0-9a-f]{6}$/i.test(c.value) ? c.value : "#888888"}
            onChange={(e) => patchColor(i, { value: e.target.value })}
            aria-label={`Color ${c.name}`}
          />
          <input
            className="xd-brand-input mini"
            value={c.name}
            placeholder="token"
            onChange={(e) => patchColor(i, { name: e.target.value })}
          />
          <input
            className="xd-brand-input mini"
            value={c.value}
            placeholder="#hex / rgba"
            onChange={(e) => patchColor(i, { value: e.target.value })}
          />
          <button
            type="button"
            className="xd-mode-del"
            title="Remove"
            onClick={() =>
              patch({ colors: draft.colors.filter((_, idx) => idx !== i) })
            }
          >
            <Trash2 size={9} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="xd-brand-add-color"
        onClick={() =>
          patch({ colors: [...draft.colors, { name: "token", value: "#888888" }] })
        }
      >
        <Plus size={10} /> Color
      </button>
      <div className="xd-brand-sub">Voice & tone</div>
      <textarea
        className="xd-brand-textarea"
        value={draft.voice ?? ""}
        placeholder="How the copy should sound…"
        onChange={(e) => patch({ voice: e.target.value })}
      />
      <div className="xd-brand-sub">Principles (one per line)</div>
      <textarea
        className="xd-brand-textarea"
        value={(draft.principles ?? []).join("\n")}
        placeholder="One principle per line…"
        onChange={(e) =>
          patch({
            principles: e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
      />
      <div className="xd-brand-editor-actions">
        <button type="button" className="xd-brand-btn primary" onClick={commit}>
          <Check size={11} /> Done
        </button>
        <button type="button" className="xd-brand-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function XDesignBrandPanel() {
  const systems = useDesignSystems((s) => s.systems);
  const activeId = useDesignSystems((s) => s.activeId);
  const setActive = useDesignSystems((s) => s.setActive);
  const save = useDesignSystems((s) => s.save);
  const remove = useDesignSystems((s) => s.remove);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const active = systems.find((s) => s.id === activeId) ?? null;
  const editing = systems.find((s) => s.id === editingId) ?? null;

  const handleNew = () => {
    const ds = blankSystem(`Brand ${systems.length + 1}`);
    void save(ds);
    void setActive(ds.id);
    setEditingId(ds.id);
    setOpen(true);
  };

  const handleDuplicate = (src: DesignSystem) => {
    const now = Date.now();
    const ds: DesignSystem = {
      ...src,
      id: `ds-${ulid()}`,
      name: `${src.name} copy`,
      builtin: false,
      createdAt: now,
      updatedAt: now,
    };
    void save(ds);
    void setActive(ds.id);
    setEditingId(ds.id);
  };

  // Seed the active brand's color tokens into the document's variables so they
  // become usable var: refs on shapes (and editable per-mode).
  const applyToDocument = () => {
    if (!active) return;
    const store = useXDesign.getState();
    const byName = new Map(store.variables.map((v) => [v.name, v.id]));
    let added = 0;
    for (const c of active.colors) {
      const existing = byName.get(c.name);
      if (existing) {
        store.setVariableValue(existing, store.activeModeId, c.value);
      } else {
        store.addVariable(c.name, c.value, "color");
        added++;
      }
    }
    toast.success("Brand applied to document", {
      body: `${active.colors.length} token(s) → variables${added ? ` (${added} new)` : ""}`,
    });
  };

  return (
    <div className="xd-brand">
      <div className="xd-brand-head">
        <button
          type="button"
          className="xd-vars-toggle"
          onClick={() => setOpen((o) => !o)}
        >
          <Palette size={11} />
          <span>Brand</span>
          {active && <span className="xd-brand-active-name">{active.name}</span>}
        </button>
        <button
          type="button"
          className="xd-vars-add"
          title="New design system"
          onClick={handleNew}
        >
          <Plus size={11} />
        </button>
      </div>

      {open && (
        <div className="xd-brand-body">
          <select
            className="xd-brand-select"
            value={activeId ?? ""}
            onChange={(e) => void setActive(e.target.value || null)}
          >
            <option value="">None</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.builtin ? " ·" : ""}
              </option>
            ))}
          </select>

          {active && !editing && (
            <>
              {active.aesthetic && (
                <div className="xd-brand-aesthetic">{active.aesthetic}</div>
              )}
              <div className="xd-brand-swatches">
                {active.colors.map((c, i) => (
                  <div
                    key={i}
                    className="xd-brand-swatch"
                    style={{ background: c.value }}
                    title={`${c.name} — ${c.value}`}
                  />
                ))}
              </div>
              <div className="xd-brand-actions">
                <button
                  type="button"
                  className="xd-brand-btn"
                  onClick={applyToDocument}
                  title="Seed these tokens as document variables"
                >
                  <Sparkles size={10} /> Apply to doc
                </button>
                <button
                  type="button"
                  className="xd-brand-btn"
                  onClick={() => handleDuplicate(active)}
                  title="Duplicate"
                >
                  <Copy size={10} /> Duplicate
                </button>
                {!active.builtin && (
                  <>
                    <button
                      type="button"
                      className="xd-brand-btn"
                      onClick={() => setEditingId(active.id)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="xd-brand-btn danger"
                      onClick={() => void remove(active.id)}
                    >
                      <Trash2 size={10} />
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {editing && (
            <BrandEditor ds={editing} onClose={() => setEditingId(null)} />
          )}
        </div>
      )}
    </div>
  );
}
