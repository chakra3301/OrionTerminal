import { useId, useMemo } from "react";
import type { CSSProperties } from "react";
import type { Skill } from "@/features/agents/agentTypes";
import { skillSigil, hexToRgb } from "./sigil";

// Octagon plate + inner ring, in a 64×64 box centered on (32,32).
const OCT = "32,11 47,17 53,32 47,47 32,53 17,47 11,32 17,17";
const OCT_INNER = "32,17 43,21 47,32 43,43 32,47 21,43 17,32 21,21";

function sigilPoints(seed: string): string {
  return skillSigil(seed)
    .map((p) => `${(32 + (p.x - 0.5) * 30).toFixed(1)},${(32 + (p.y - 0.5) * 30).toFixed(1)}`)
    .join(" ");
}

/** An animated SVG emblem for a skill — rotating reticle, counter-rotating
 *  sub-dial, scanline, and a seeded sigil. Mirrors the Learn mastery badge. */
export function SkillEmblem({ skill, size = 62, equipped = false }: { skill: Skill; size?: number; equipped?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const sigil = useMemo(() => sigilPoints(skill.id || skill.name), [skill.id, skill.name]);
  const style = { "--acc-rgb": hexToRgb(skill.accent) } as CSSProperties;
  const clip = `seclip-${uid}`;

  return (
    <svg className={`se${equipped ? " on" : ""}`} width={size} height={size} viewBox="0 0 64 64" style={style} aria-hidden>
      <defs>
        <clipPath id={clip}><polygon points={OCT} /></clipPath>
      </defs>

      <g className="se-reticle">
        <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(var(--acc-rgb), 0.28)" strokeWidth="0.8" strokeDasharray="2 7" />
        <path d="M32,3 v6 M32,61 v-6 M3,32 h6 M61,32 h-6" stroke="rgba(var(--acc-rgb), 0.85)" strokeWidth="1.1" />
      </g>

      <polygon className="se-plate" points={OCT} />
      <polygon points={OCT_INNER} fill="none" stroke="rgba(var(--acc-rgb), 0.3)" strokeWidth="0.7" />

      <g className="se-subdial">
        <circle cx="32" cy="32" r="14" fill="none" stroke="rgba(var(--acc-rgb), 0.4)" strokeWidth="0.8" strokeDasharray="7 5" />
      </g>

      <rect className="se-scan" x="11" y="31" width="42" height="1.6" fill="rgba(var(--acc-rgb), 0.5)" clipPath={`url(#${clip})`} />

      <polygon className="se-sigil" points={sigil} />
      <circle className="se-core" cx="32" cy="32" r="1.7" />
    </svg>
  );
}
