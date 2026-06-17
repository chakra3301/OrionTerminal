import { useState } from "react";
import { ulid } from "ulid";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAgentsStore } from "@/store/agentsStore";
import { useSkillsStore } from "@/store/skillsStore";
import { useProvidersStore } from "@/store/providersStore";
import type { Agent } from "@/features/agents/agentTypes";

const ACCENTS = ["#b14cff", "#00e0ff", "#39ff88", "#e6ff3a", "#ff3ea5"];

function blank(): Agent {
  return { id: ulid(), name: "New Agent", role: "", accent: "#b14cff", avatarAssetId: null, avatarUrl: null, brainModel: "claude-opus-4-8", actionModel: "", skillIds: [] };
}

export function AgentForge() {
  const agents = Array.from(useAgentsStore((s) => s.agents).values());
  const skills = Array.from(useSkillsStore((s) => s.skills).values());
  const save = useAgentsStore((s) => s.save);
  const remove = useAgentsStore((s) => s.remove);
  const providers = useProvidersStore((s) => s.providers);
  const runnableModels = providers.filter((p) => p.builtin).flatMap((p) => p.models);
  const [draft, setDraft] = useState<Agent>(blank());

  const equipped = new Set(draft.skillIds);
  const toggleSkill = (id: string) =>
    setDraft((d) => ({ ...d, skillIds: equipped.has(id) ? d.skillIds.filter((x) => x !== id) : [...d.skillIds, id] }));

  const pickAvatar = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (typeof path === "string") setDraft({ ...draft, avatarUrl: convertFileSrc(path), avatarAssetId: null });
  };

  return (
    <div className="forge">
      <div className="forge-grid">
        <div className="forge-equip">
          <div className="forge-eyebrow">EQUIPMENT</div>
          <div className="forge-slot brain">
            <div className="forge-slot-label">🧠 BRAIN · THINKS</div>
            <select className="cp-input" value={draft.brainModel} onChange={(e) => setDraft({ ...draft, brainModel: e.target.value })}>
              {runnableModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="forge-slot action">
            <div className="forge-slot-label">⚡ ACTION · DOES <span className="forge-hint">(wires up in a later update)</span></div>
            <select className="cp-input" value={draft.actionModel} onChange={(e) => setDraft({ ...draft, actionModel: e.target.value })}>
              <option value="">same as brain</option>
              {runnableModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div className="forge-center">
          <button className="forge-portrait" style={{ borderColor: draft.accent }} onClick={pickAvatar} title="Choose a portrait image">
            {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : <span>＋ image</span>}
          </button>
          <input className="cp-input forge-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="cp-input forge-role" placeholder="role / tagline" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          <div className="forge-accents">
            {ACCENTS.map((c) => <button key={c} className={`forge-dot${draft.accent === c ? " on" : ""}`} style={{ background: c }} onClick={() => setDraft({ ...draft, accent: c })} />)}
          </div>
          <div className="forge-eyebrow">EQUIPPED SKILLS · {draft.skillIds.length}</div>
          <div className="forge-equipped">
            {draft.skillIds.map((id) => { const s = skills.find((x) => x.id === id); return s ? <span key={id} className="forge-chip" style={{ borderColor: s.accent }} onClick={() => toggleSkill(id)}>{s.icon} {s.name} ✕</span> : null; })}
          </div>
        </div>

        <div className="forge-inv">
          <div className="forge-eyebrow">SKILL INVENTORY</div>
          <div className="cp-skill-grid">
            {skills.map((s) => (
              <button key={s.id} className={`cp-skill-tile${equipped.has(s.id) ? " on" : ""}`} style={{ borderColor: equipped.has(s.id) ? s.accent : "var(--glass-border)" }} onClick={() => toggleSkill(s.id)}>
                <span className="cp-skill-icon">{s.icon || "✨"}</span>
                <span className="cp-skill-name">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="forge-bar">
        <div className="forge-summary">🧠 {draft.brainModel.replace("claude-", "")} · ⚡ {(draft.actionModel || draft.brainModel).replace("claude-", "")} · 📚 {draft.skillIds.length} skills</div>
        <button className="cp-btn" onClick={() => { void save(draft); setDraft(blank()); }}>⚒ Forge Agent</button>
      </div>

      {agents.length > 0 && (
        <div className="forge-saved">
          <div className="forge-eyebrow">YOUR AGENTS</div>
          {agents.map((a) => (
            <div key={a.id} className="cp-card">
              <div className="cp-card-main"><div className="cp-card-title">{a.name}</div><div className="cp-card-sub">{a.role || "—"}</div></div>
              <button className="cp-link-danger" onClick={() => setDraft(a)}>Edit</button>
              <button className="cp-link-danger" onClick={() => remove(a.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
