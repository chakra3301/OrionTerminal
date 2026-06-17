import { useState } from "react";
import type { CSSProperties } from "react";
import { ulid } from "ulid";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Brain, Zap, Hammer } from "lucide-react";
import { useAgentsStore } from "@/store/agentsStore";
import { useSkillsStore } from "@/store/skillsStore";
import { useProvidersStore } from "@/store/providersStore";
import type { Agent, Skill } from "@/features/agents/agentTypes";
import { SkillTile } from "./SkillTile";
import { SkillEmblem } from "./SkillEmblem";
import { hexToRgb } from "./sigil";

const ACCENTS = ["#b14cff", "#00e0ff", "#39ff88", "#e6ff3a", "#ff3ea5"];
const HEX = "60,4 112,34 112,98 60,128 8,98 8,34";
// The six hexagon vertices in portrait pixel space (132×146), for corner slots.
const CORNERS = [
  { x: 66, y: 4 }, { x: 123, y: 38 }, { x: 123, y: 108 },
  { x: 66, y: 142 }, { x: 9, y: 108 }, { x: 9, y: 38 },
];

function blank(): Agent {
  return { id: ulid(), name: "New Agent", role: "", accent: "#b14cff", avatarAssetId: null, avatarUrl: null, brainModel: "claude-opus-4-8", actionModel: "", skillIds: [] };
}

function ForgePortrait({ url, accent, equipped, onPick, onUnequip }: { url: string | null; accent: string; equipped: Skill[]; onPick: () => void; onUnequip: (id: string) => void }) {
  return (
    <div className="forge-portrait-wrap" style={{ "--acc-rgb": hexToRgb(accent) } as CSSProperties}>
      <button className="forge-portrait" onClick={onPick} title="Choose a portrait image">
        <svg width={132} height={146} viewBox="0 0 120 132" style={{ overflow: "visible" }} aria-hidden>
          <defs>
            <clipPath id="fp-hex"><polygon points={HEX} /></clipPath>
          </defs>
          <g className="fp-reticle">
            <circle cx="60" cy="66" r="62" fill="none" stroke="rgba(var(--acc-rgb), 0.3)" strokeWidth="0.8" strokeDasharray="2 9" />
            <path d="M60,2 v9 M60,130 v-9 M4,66 h9 M116,66 h-9" stroke="rgba(var(--acc-rgb), 0.85)" strokeWidth="1.2" />
          </g>
          <polygon className="fp-plate" points={HEX} />
          {url ? (
            <image href={url} x="8" y="4" width="104" height="124" preserveAspectRatio="xMidYMid slice" clipPath="url(#fp-hex)" />
          ) : (
            <text className="fp-empty" x="60" y="70" textAnchor="middle">ADD IMAGE</text>
          )}
        </svg>
      </button>
      <div className="forge-corners">
        {CORNERS.map((pos, i) => {
          const s = equipped[i];
          return s ? (
            <button key={s.id} className="forge-corner" style={{ left: pos.x, top: pos.y }} onClick={() => onUnequip(s.id)} title={`${s.name} — unequip`}>
              <SkillEmblem skill={s} size={36} equipped />
            </button>
          ) : null;
        })}
      </div>
    </div>
  );
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
  const equippedSkills = draft.skillIds.map((id) => skills.find((x) => x.id === id)).filter((s): s is Skill => !!s);
  const toggleSkill = (id: string) =>
    setDraft((d) => ({ ...d, skillIds: equipped.has(id) ? d.skillIds.filter((x) => x !== id) : [...d.skillIds, id] }));

  const pickAvatar = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (typeof path === "string") setDraft({ ...draft, avatarUrl: convertFileSrc(path), avatarAssetId: null });
  };

  const short = (m: string) => m.replace("claude-", "");

  return (
    <div className="forge">
      <div className="forge-grid">
        <div className="forge-equip">
          <div className="cp-eyebrow">Equipment</div>
          <div className="forge-slot brain">
            <div className="forge-slot-label"><Brain size={13} strokeWidth={2} /> Brain · thinks</div>
            <select value={draft.brainModel} onChange={(e) => setDraft({ ...draft, brainModel: e.target.value })}>
              {runnableModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="forge-slot action">
            <div className="forge-slot-label"><Zap size={13} strokeWidth={2} /> Action · does <span className="forge-hint">soon</span></div>
            <select value={draft.actionModel} onChange={(e) => setDraft({ ...draft, actionModel: e.target.value })}>
              <option value="">same as brain</option>
              {runnableModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div className="forge-center">
          <ForgePortrait url={draft.avatarUrl} accent={draft.accent} equipped={equippedSkills} onPick={pickAvatar} onUnequip={toggleSkill} />
          <input className="forge-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="forge-role" placeholder="class / title" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          <div className="forge-accents">
            {ACCENTS.map((c) => <button key={c} type="button" className={`forge-dot${draft.accent === c ? " on" : ""}`} style={{ background: c, color: c }} onClick={() => setDraft({ ...draft, accent: c })} aria-label="accent" />)}
          </div>
          <div className="cp-eyebrow">Equipped <span className="cp-count">{draft.skillIds.length}</span></div>
        </div>

        <div className="forge-inv">
          <div className="cp-eyebrow">Skill Inventory <span className="cp-count">{skills.length}</span></div>
          <div className="cp-skill-grid">
            {skills.map((s) => (
              <SkillTile key={s.id} skill={s} equipped={equipped.has(s.id)} onClick={() => toggleSkill(s.id)} title={equipped.has(s.id) ? "Unequip" : "Equip"} />
            ))}
          </div>
        </div>
      </div>

      <div className="forge-bar">
        <div className="forge-summary">Brain <b>{short(draft.brainModel)}</b> · Action <b>{short(draft.actionModel || draft.brainModel)}</b> · <b>{draft.skillIds.length}</b> skills</div>
        <button className="forge-btn" onClick={() => { void save(draft); setDraft(blank()); }}><Hammer size={14} strokeWidth={2.2} /> Forge Agent</button>
      </div>

      {agents.length > 0 && (
        <div className="forge-saved">
          <div className="cp-eyebrow">Your Agents <span className="cp-count">{agents.length}</span></div>
          {agents.map((a) => (
            <div key={a.id} className="cp-card" style={{ "--acc-rgb": hexToRgb(a.accent) } as CSSProperties}>
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
