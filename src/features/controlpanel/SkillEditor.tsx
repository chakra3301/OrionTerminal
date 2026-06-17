import { useState } from "react";
import { useSkillsStore } from "@/store/skillsStore";
import { useMcpServers } from "@/store/mcpServersStore";
import { BUILTIN_TOOLS } from "@/features/agents/toolCatalog";
import type { Skill, ToolGrant } from "@/features/agents/agentTypes";
import { SkillEmblem } from "./SkillEmblem";

const ACCENTS = ["#b14cff", "#00e0ff", "#39ff88", "#e6ff3a", "#ff3ea5"];

function hasGrant(tools: ToolGrant[], g: ToolGrant): boolean {
  return tools.some((t) => (t.kind === "builtin" && g.kind === "builtin" && t.name === g.name) || (t.kind === "mcp" && g.kind === "mcp" && t.server === g.server));
}

export function SkillEditor({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const save = useSkillsStore((s) => s.save);
  const remove = useSkillsStore((s) => s.remove);
  const mcp = useMcpServers((s) => s.servers).filter((x) => x.enabled);
  const [draft, setDraft] = useState<Skill>(skill);

  const toggle = (g: ToolGrant) =>
    setDraft((d) => ({ ...d, tools: hasGrant(d.tools, g) ? d.tools.filter((t) => !hasGrant([t], g)) : [...d.tools, g] }));

  return (
    <div className="cp-form">
      <div className="cp-form-row" style={{ gap: 16, alignItems: "center" }}>
        <SkillEmblem skill={draft} size={80} equipped />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <input className="cp-input" placeholder="Skill name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <div className="forge-accents">
            {ACCENTS.map((c) => (
              <button key={c} type="button" className={`forge-dot${draft.accent === c ? " on" : ""}`} style={{ background: c, color: c }} onClick={() => setDraft({ ...draft, accent: c })} aria-label="accent" />
            ))}
          </div>
        </div>
      </div>

      <div className="cp-label">Instructions</div>
      <textarea className="cp-input" rows={6} placeholder="Appended to the agent's system prompt when this skill is equipped…" value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />

      <div className="cp-label">Granted tools</div>
      <div className="cp-tool-grid">
        {BUILTIN_TOOLS.map((t) => {
          const g: ToolGrant = { kind: "builtin", name: t.name };
          return <label key={t.name} className="cp-tool"><input type="checkbox" checked={hasGrant(draft.tools, g)} onChange={() => toggle(g)} />{t.label}</label>;
        })}
        {mcp.map((s) => {
          const g: ToolGrant = { kind: "mcp", server: s.name };
          return <label key={s.id} className="cp-tool"><input type="checkbox" checked={hasGrant(draft.tools, g)} onChange={() => toggle(g)} />MCP: {s.name}</label>;
        })}
      </div>

      <div className="cp-form-actions">
        {!skill.builtin && <button className="cp-link-danger" onClick={() => { void remove(draft.id); onClose(); }}>Delete</button>}
        <button className="cp-btn ghost" onClick={onClose}>Cancel</button>
        <button className="cp-btn" onClick={() => { void save(draft); onClose(); }}>Save skill</button>
      </div>
    </div>
  );
}
