import type { CSSProperties } from "react";
import type { Skill } from "@/features/agents/agentTypes";

/** A single runic skill enchantment — notched cyber frame, glyph mark in a
 *  rune diamond, accent corona. Used by the Skill Library and the Forge
 *  inventory. `equipped` lights the corona; `onClick` toggles/edits. */
export function SkillGlyph({
  skill,
  equipped = false,
  onClick,
  title,
}: {
  skill: Skill;
  equipped?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const acc = skill.accent || "var(--neon-violet)";
  return (
    <button
      type="button"
      className={`cp-glyph${equipped ? " on" : ""}`}
      style={{ "--acc": acc } as CSSProperties}
      onClick={onClick}
      title={title}
    >
      <span className="cp-glyph-face">
        <span className="cp-glyph-icon">{skill.icon || "✦"}</span>
        <span className="cp-glyph-name">{skill.name}</span>
        {skill.builtin && <span className="cp-glyph-rune" aria-hidden>⟡</span>}
        {equipped && <span className="cp-glyph-equipped">equipped</span>}
      </span>
    </button>
  );
}
