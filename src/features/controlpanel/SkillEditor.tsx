import { useState } from "react";
import { useSkillsStore } from "@/store/skillsStore";
import { useMcpServers } from "@/store/mcpServersStore";
import { BUILTIN_TOOLS } from "@/features/agents/toolCatalog";
import type { Skill, ToolGrant } from "@/features/agents/agentTypes";

function hasGrant(tools: ToolGrant[], g: ToolGrant): boolean {
  return tools.some((t) => (t.kind === "builtin" && g.kind === "builtin" && t.name === g.name) || (t.kind === "mcp" && g.kind === "mcp" && t.server === g.server));
}

export function SkillEditor({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const save = useSkillsStore((s) => s.save);
  const remove = useSkillsStore((s) => s.remove);
  const mcp = useMcpServers((s) => s.servers.filter((x) => x.enabled));
  const [draft, setDraft] = useState<Skill>(skill);

  const toggle = (g: ToolGrant) =>
    setDraft((d) => ({ ...d, tools: hasGrant(d.tools, g) ? d.tools.filter((t) => !hasGrant([t], g)) : [...d.tools, g] }));

  return (
    <div className="cp-form">
      <div className="cp-form-row">
        <input className="cp-input" style={{ width: 64 }} value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
        <input className="cp-input" style={{ flex: 1 }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </div>
      <textarea className="cp-input" rows={6} placeholder="Instructions appended to the agent's system prompt…" value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
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
