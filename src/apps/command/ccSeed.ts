// Pure, deterministic default org seed. Stable ids make it idempotent — a
// second seed (insert-or-ignore) is a no-op. No IO here; the store persists.

import {
  type CCProfile,
  type CCChannel,
  DIVISIONS,
} from "./ccTypes";

export const COMMAND_ACCENT = "#ffc24b"; // gold — the command tier
export const GENERAL_ACCENT = "#39ff88";

// The Design division is provisioned as a "PI Designer" workspace (mirror of the
// PI DESIGNER setup): elite-frontend persona via AGENTS.md + project-local
// design skills. Its cwd is the division root (not a /wiki subdir) so pi
// discovers the workspace skills + AGENTS.md.
export const DESIGN_SKILLS = [
  "web-design-guidelines",
  "vercel-react-best-practices",
  "accessibility",
  "performance",
  "core-web-vitals",
  "best-practices",
  "web-quality-audit",
  "3d-web-experience",
  "threejs-webgl",
  "shader-programming-glsl",
  "gsap-core",
  "gsap-framer-scroll-animation",
  "motion-framer",
  "generative-art",
  "design-taste-frontend",
  "shadcn-ui",
  "build-color-palette",
  "typography",
  "frontend-design",
  "ui-design",
  "llm-wiki",
];
const DESIGN_CHARTER =
  "PI DESIGNER — a world-class, highly creative frontend engineer and designer. Ships distinctive, production-grade, fast, accessible interfaces at Awwwards Site-of-the-Day caliber (Three.js + GSAP ScrollTrigger + custom GLSL, scrollytelling, reduced-motion + Lighthouse 90+). Full persona, standards, skills and workflow live in this workspace AGENTS.md.";

export type CCSeed = { profiles: CCProfile[]; channels: CCChannel[] };

/** Build the starting org: Commander (you) + General + one Captain per
 * division, and the command/cross/per-division channels. Pure & deterministic
 * given `wikiBase` and `now`. */
export function defaultSeed(opts: { wikiBase: string; now: number }): CCSeed {
  const { wikiBase, now } = opts;
  const base = wikiBase.replace(/\/+$/, "");

  const profiles: CCProfile[] = [
    {
      id: "cc-prof-commander",
      name: "Commander",
      rank: "commander",
      division: "",
      accent: COMMAND_ACCENT,
      brainModel: "",
      skillIds: [],
      wikiRoot: "",
      charter: "You. Issue missions, approve plans, receive briefings.",
      autonomyLevel: 0,
      position: 0,
      createdAt: now,
      updatedAt: now,
      avatarPath: "",
    },
    {
      id: "cc-prof-general",
      name: "General",
      rank: "general",
      division: "",
      accent: GENERAL_ACCENT,
      brainModel: "",
      skillIds: ["llm-wiki"],
      wikiRoot: `${base}/org/wiki`,
      charter:
        "Pure coordinator. Decompose missions into directives, route to divisions, aggregate reports into one briefing for the Commander. Does not do division work.",
      autonomyLevel: 1,
      position: 0,
      createdAt: now,
      updatedAt: now,
      avatarPath: "",
    },
    ...DIVISIONS.map((d, i) => {
      const isDesign = d.division === "design";
      return {
        id: `cc-prof-cap-${d.division}`,
        name: isDesign ? "PI Designer" : `${d.name} Captain`,
        rank: "captain" as const,
        division: d.division,
        accent: d.accent,
        brainModel: "",
        skillIds: isDesign ? DESIGN_SKILLS : ["llm-wiki"],
        // Design runs at the division root (its provisioned workspace); others
        // keep a /wiki vault until they're set up.
        wikiRoot: isDesign
          ? `${base}/divisions/${d.division}`
          : `${base}/divisions/${d.division}/wiki`,
        charter: isDesign
          ? DESIGN_CHARTER
          : `Head of the ${d.name} division. Owns its memory vault and skills; works directives itself, serially; reports to the General.`,
        autonomyLevel: 1,
        position: i,
        createdAt: now,
        updatedAt: now,
        avatarPath: "",
      };
    }),
  ];

  const channels: CCChannel[] = [
    {
      id: "cc-chan-command",
      kind: "command",
      division: "",
      name: "command",
      position: 0,
      createdAt: now,
    },
    {
      id: "cc-chan-cross",
      kind: "cross",
      division: "",
      name: "cross-division",
      position: 1,
      createdAt: now,
    },
    ...DIVISIONS.map((d, i) => ({
      id: `cc-chan-div-${d.division}`,
      kind: "division" as const,
      division: d.division,
      name: d.division,
      position: 2 + i,
      createdAt: now,
    })),
  ];

  return { profiles, channels };
}
