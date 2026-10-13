export type CharacterAccent = "cyan" | "green" | "magenta" | "violet" | "yellow";

export type BuiltinCharacter = {
  id: string;
  name: string;
  blurb: string;
  accent: CharacterAccent;
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

export function colorOf(c: Character): string {
  return c.color ?? "#00e0ff";
}

export type Character =
  | (BuiltinCharacter & { custom?: false })
  | CustomCharacter;

export const DEFAULT_CHARACTER_ID = "anthropomorphic-fox";

export const BUILTIN_CHARACTERS: BuiltinCharacter[] = [
  {
    id: DEFAULT_CHARACTER_ID,
    name: "Fox",
    blurb: "A watchful fox with a sweeping tail.",
    accent: "cyan",
    color: "#00e0ff",
    url: "/characters/anthropomorphic-fox.glb",
  },
  {
    id: "horned-demon",
    name: "Demon",
    blurb: "A quiet presence with curved horns.",
    accent: "violet",
    color: "#b14cff",
    url: "/characters/horned-demon.glb",
  },
  {
    id: "mushroom-character",
    name: "Mushroom",
    blurb: "A small wanderer beneath a broad cap.",
    accent: "magenta",
    color: "#ff3ea5",
    url: "/characters/mushroom-character.glb",
  },
  {
    id: "angelic-winged-figure",
    name: "Angel",
    blurb: "Feathered wings and a gentle bearing.",
    accent: "green",
    color: "#39ff88",
    url: "/characters/angelic-winged-figure.glb",
  },
  {
    id: "stylized-humanoid-robot",
    name: "Robot",
    blurb: "Blue armor and a curious visor.",
    accent: "cyan",
    color: "#00e0ff",
    url: "/characters/stylized-humanoid-robot.glb",
  },
  {
    id: "pigtail-character",
    name: "Pigtail",
    blurb: "Twin pigtails, soft boots, expressive gestures.",
    accent: "violet",
    color: "#b14cff",
    url: "/characters/pigtail-character.glb",
  },
];

export const ACCENT_VAR: Record<CharacterAccent, string> = {
  cyan: "var(--neon-cyan)",
  green: "var(--neon-green)",
  magenta: "var(--neon-magenta)",
  violet: "var(--neon-violet)",
  yellow: "var(--neon-yellow)",
};

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
    find((n) => n === "sad idle") ??
    find((n) => n.includes("idle")) ??
    find((n) => n.includes("swim")) ??
    find((n) => n.includes("walk")) ??
    names[0] ??
    null;
  const select =
    find((n) => n === "standing greeting") ??
    find((n) => n.includes("spin") || n.includes("jump") || n.includes("power")) ??
    find((n) => n.includes("run")) ??
    find((n) => n.includes("walk")) ??
    idle;
  return { idle, select };
}
