import type { Skill } from "@/features/agents/agentTypes";
import { ParticleOrb } from "@/identity/ParticleOrb";
import { skillAccent } from "@/identity/color";

export function SkillEmblem({ skill, size = 62, equipped = false }: { skill: Skill; size?: number; equipped?: boolean }) {
  return <span className={equipped ? "skill-orb equipped" : "skill-orb"} aria-hidden="true">
    <ParticleOrb identity={`skill:${skill.id || skill.name}`} accent={skillAccent(skill.id || skill.name, skill.accent)} size={size} />
  </span>;
}
