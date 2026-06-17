import { useState } from "react";
import type { CSSProperties } from "react";
import { ulid } from "ulid";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAgentsStore } from "@/store/agentsStore";
import { useSkillsStore } from "@/store/skillsStore";
import { useProvidersStore } from "@/store/providersStore";
import type { Agent } from "@/features/agents/agentTypes";
import { SkillGlyph } from "./SkillGlyph";

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

  const portraitStyle = { "--acc": draft.accent } as CSSProperties;
  const short = (m: string) => m.replace("claude-", "");

  return (
    <div className="forge">
      <div className="forge-grid">
        <div className="forge-equip">
          <div className="cp-eyebrow">Equipment</div>
          <div className="forge-slot brain">
            <div className="forge-slot-label">🧠 Brain · thinks</div>
            <select value={draft.brainModel} onChange={(e) => setDraft({ ...draft, brainModel: e.target.value })}>
              {runnableModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="forge-slot action">
            <div className="forge-slot-label">⚡ Action · does <span className="forge-hint">wires up later</span></div>
            <select value={draft.actionModel} onChange={(e) => setDraft({ ...draft, actionModel: e.target.value })}>
              <option value="">same as brain</option>
              {runnableModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div className="forge-center">
          <button className="forge-portrait" style={portraitStyle} onClick={pickAvatar} title="Choose a portrait glyph">
            <span className="forge-portrait-face">
              {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : <span>＋ glyph</span>}
              <span className="forge-portrait-scan" aria-hidden />
            </span>
          </button>
          <input className="forge-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="forge-role" placeholder="class / title" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          <div className="forge-accents">
            {ACCENTS.map((c) => <button key={c} type="button" className={`forge-dot${draft.accent === c ? " on" : ""}`} style={{ background: c, color: c }} onClick={() => setDraft({ ...draft, accent: c })} aria-label="accent" />)}
          </div>
          <div className="cp-eyebrow">Equipped <span className="cp-count">{draft.skillIds.length}</span></div>
          <div className="forge-equipped">
            {draft.skillIds.map((id) => {
              const s = skills.find((x) => x.id === id);
              return s ? (
                <span key={id} className="forge-equip-chip" style={{ "--acc": s.accent || "var(--neon-violet)" } as CSSProperties} onClick={() => toggleSkill(id)} title="Unequip">
                  {s.icon} {s.name} <span className="forge-equip-x">✕</span>
                </span>
              ) : null;
            })}
          </div>
        </div>

        <div className="forge-inv">
          <div className="cp-eyebrow">Skill Inventory <span className="cp-count">{skills.length}</span></div>
          <div className="cp-glyph-grid">
            {skills.map((s) => (
              <SkillGlyph key={s.id} skill={s} equipped={equipped.has(s.id)} onClick={() => toggleSkill(s.id)} title={equipped.has(s.id) ? "Unequip" : "Equip"} />
            ))}
          </div>
        </div>
      </div>

      <div className="forge-bar">
        <div className="forge-summary">🧠 <b>{short(draft.brainModel)}</b> · ⚡ <b>{short(draft.actionModel || draft.brainModel)}</b> · 📚 {draft.skillIds.length} skills</div>
        <button className="forge-btn" onClick={() => { void save(draft); setDraft(blank()); }}>⚒ Forge Agent</button>
      </div>

      {agents.length > 0 && (
        <div className="forge-saved">
          <div className="cp-eyebrow">Your Agents <span className="cp-count">{agents.length}</span></div>
          {agents.map((a) => (
            <div key={a.id} className="cp-card" style={{ "--acc": a.accent || "var(--neon-violet)" } as CSSProperties}>
              <div className="cp-card-main"><div className="cp-card-title">{a.name}</div><div className="cp-card-sub">{a.role || "—"} · {short(a.brainModel)}</div></div>
              <button className="cp-link-danger" onClick={() => setDraft(a)}>Edit</button>
              <button className="cp-link-danger" onClick={() => remove(a.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
