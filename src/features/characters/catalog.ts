// Built-in characters live in public/characters/<slug>.glb (Meshy "merged
// animations" exports: one skinned mesh + a few clips). Idle/select clip names
// differ per model, so playback resolves clips by name at runtime (see
// resolveClips) rather than hard-coding them here.

export type CharacterAccent = "cyan" | "green" | "magenta" | "violet" | "yellow";

export type BuiltinCharacter = {
  id: string;
  name: string;
  blurb: string;
  accent: CharacterAccent;
  /** Wireframe energy-core color (each character distinct). */
  color: string;
  /** URL served from /public. */
  url: string;
};

export type CustomCharacter = {
  id: string;
  name: string;
  /** Absolute path on disk (rendered via convertFileSrc). */
  filePath: string;
  custom: true;
  color?: string;
};

/** Energy-core color for any character (custom defaults to cyan). */
export function colorOf(c: Character): string {
  return c.color ?? "#00e0ff";
}

export type Character =
  | (BuiltinCharacter & { custom?: false })
  | CustomCharacter;

// The original R.O.S.I.E companion. Kept first + default so the desktop
// companion is unchanged out of the box; selecting another character swaps the
// companion model ("your version of R.O.S.I.E").
export const ROSIE_ID = "rosie";

export const BUILTIN_CHARACTERS: BuiltinCharacter[] = [
  {
    id: ROSIE_ID,
    name: "R.O.S.I.E",
    blurb: "The original. Your default companion.",
    accent: "cyan",
    color: "#00e0ff",
    url: "/companion/companion.glb",
  },
  {
    id: "azure-halo-knight",
    name: "Azure Halo Knight",
    blurb: "Haloed sentinel in azure plate.",
    accent: "cyan",
    color: "#4cc2ff",
    url: "/characters/azure-halo-knight.glb",
  },
  {
    id: "azure-horizon-runner",
    name: "Azure Horizon Runner",
    blurb: "Built for speed. Comes with a power spin.",
    accent: "cyan",
    color: "#39ff88",
    url: "/characters/azure-horizon-runner.glb",
  },
  {
    id: "azure-rebellion",
    name: "Azure Rebellion",
    blurb: "Defiant edge, electric blue.",
    accent: "violet",
    color: "#b14cff",
    url: "/characters/azure-rebellion.glb",
  },
  {
    id: "haloed-blue-demon",
    name: "Haloed Blue Demon",
    blurb: "Angelic halo, demonic intent.",
    accent: "magenta",
    color: "#ff3ea5",
    url: "/characters/haloed-blue-demon.glb",
  },
  {
    id: "horned-shadow-knight",
    name: "Horned Shadow Knight",
    blurb: "Dark armor, sharper horns.",
    accent: "violet",
    color: "#ff6a3a",
    url: "/characters/horned-shadow-knight.glb",
  },
  {
    id: "pink-hatted-alien",
    name: "Pink Hatted Alien",
    blurb: "Friendly visitor, questionable hat.",
    accent: "magenta",
    color: "#e6ff3a",
    url: "/characters/pink-hatted-alien.glb",
  },
  {
    id: "winged-guardian",
    name: "Winged Guardian",
    blurb: "Watches over the terminal. Has wings.",
    accent: "green",
    color: "#00ffd0",
    url: "/characters/winged-guardian.glb",
  },
];

export const ACCENT_VAR: Record<CharacterAccent, string> = {
  cyan: "var(--neon-cyan)",
  green: "var(--neon-green)",
  magenta: "var(--neon-magenta)",
  violet: "var(--neon-violet)",
  yellow: "var(--neon-yellow)",
};

/** Pick idle + a one-shot "select" clip from whatever the GLB ships with. */
export function resolveClips(names: string[]): {
  idle: string | null;
  select: string | null;
} {
  const lower = names.map((n) => n.toLowerCase());
  const find = (pred: (n: string) => boolean) => {
    const i = lower.findIndex(pred);
    return i >= 0 ? names[i] : null;
  };
  const idle =
    find((n) => n.includes("idle")) ??
    find((n) => n.includes("swim")) ??
    find((n) => n.includes("walk")) ??
    names[0] ??
    null;
  const select =
    find((n) => n.includes("spin") || n.includes("jump") || n.includes("power")) ??
    find((n) => n.includes("run")) ??
    find((n) => n.includes("walk")) ??
    idle;
  return { idle, select };
}
