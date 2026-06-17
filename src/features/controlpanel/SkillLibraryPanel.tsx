import { useState } from "react";
import { ulid } from "ulid";
import { useSkillsStore } from "@/store/skillsStore";
import type { Skill } from "@/features/agents/agentTypes";
import { SkillEditor } from "./SkillEditor";
import { SkillTile } from "./SkillTile";

export function SkillLibraryPanel() {
  const skills = Array.from(useSkillsStore((s) => s.skills).values());
  const [editing, setEditing] = useState<Skill | null>(null);

  const newSkill = (): Skill => ({ id: ulid(), name: "New Skill", icon: "", accent: "#b14cff", instructions: "", tools: [], builtin: false });
  const duplicate = (s: Skill): Skill => ({ ...s, id: ulid(), name: `${s.name} (copy)`, builtin: false });

  if (editing) return <SkillEditor skill={editing} onClose={() => setEditing(null)} />;

  return (
    <div>
      <div className="cp-eyebrow">Skill Codex <span className="cp-count">{skills.length}</span></div>
      <div className="cp-skill-grid">
        {skills.map((s) => (
          <SkillTile
            key={s.id}
            skill={s}
            onClick={() => setEditing(s.builtin ? duplicate(s) : s)}
            title={s.builtin ? "Built-in — opens a customizable copy" : "Edit"}
          />
        ))}
      </div>
      <button className="cp-btn" onClick={() => setEditing(newSkill())}>Inscribe new skill</button>
    </div>
  );
}
