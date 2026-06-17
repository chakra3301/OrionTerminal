import { useState } from "react";
import { ulid } from "ulid";
import { useSkillsStore } from "@/store/skillsStore";
import type { Skill } from "@/features/agents/agentTypes";
import { SkillEditor } from "./SkillEditor";

export function SkillLibraryPanel() {
  const skills = Array.from(useSkillsStore((s) => s.skills).values());
  const [editing, setEditing] = useState<Skill | null>(null);

  const newSkill = (): Skill => ({ id: ulid(), name: "New Skill", icon: "✨", accent: "#b14cff", instructions: "", tools: [], builtin: false });
  const duplicate = (s: Skill): Skill => ({ ...s, id: ulid(), name: `${s.name} (copy)`, builtin: false });

  if (editing) return <SkillEditor skill={editing} onClose={() => setEditing(null)} />;

  return (
    <div>
      <div className="cp-skill-grid">
        {skills.map((s) => (
          <button key={s.id} className="cp-skill-tile" style={{ borderColor: s.accent || "var(--glass-border)" }}
            onClick={() => setEditing(s.builtin ? duplicate(s) : s)} title={s.builtin ? "Built-in — opens a customizable copy" : "Edit"}>
            <span className="cp-skill-icon">{s.icon || "✨"}</span>
            <span className="cp-skill-name">{s.name}</span>
            {s.builtin && <span className="cp-skill-flag">built-in</span>}
          </button>
        ))}
      </div>
      <button className="cp-btn" onClick={() => setEditing(newSkill())}>+ New skill</button>
    </div>
  );
}
