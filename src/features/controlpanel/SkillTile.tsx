import type { CSSProperties } from "react";
import type { Skill } from "@/features/agents/agentTypes";
import { SkillEmblem } from "./SkillEmblem";
import { hexToRgb } from "./sigil";

/** A skill rendered as an equippable emblem tile — used by the Skill Library
 *  and the Forge inventory. */
export function SkillTile({
  skill,
  equipped = false,
  onClick,
  title,
  disabled = false,
}: {
  skill: Skill;
  equipped?: boolean;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`cp-skill${equipped ? " on" : ""}`}
      style={{ "--acc-rgb": hexToRgb(skill.accent) } as CSSProperties}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <SkillEmblem skill={skill} equipped={equipped} size={64} />
      <span className="cp-skill-name">{skill.name}</span>
      {skill.imported ? (
        <span className="cp-skill-tag dim">{skill.imported.enabled ? (equipped ? "imported · equipped" : "imported") : "disabled"}</span>
      ) : equipped ? (
        <span className="cp-skill-tag">equipped</span>
      ) : skill.builtin ? (
        <span className="cp-skill-tag dim">core</span>
      ) : (
        <span className="cp-skill-tag dim">custom</span>
      )}
    </button>
  );
}
