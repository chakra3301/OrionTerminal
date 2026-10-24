import manifest from "../../../public/characters/manifest.json";
import type { CompanionId } from "./companionProfiles";

export type BuiltinCharacter = {
  id: CompanionId;
  /** Display name, spelled exactly as on the card art. */
  name: string;
  code: string;
  blurb: string;
  color: string;
  /** URL served from /public. */
  url: string;
  /** Card art from the site (orion-site /companions/cards). */
  card: { art: string; clean: string; spec: string };
};

export type CustomCharacter = {
  id: string;
  name: string;
  /** Absolute path on disk (rendered via convertFileSrc). */
  filePath: string;
  custom: true;
  color?: string;
};

export type Character =
  | (BuiltinCharacter & { custom?: false })
  | CustomCharacter;

export function colorOf(c: Character): string {
  return c.color ?? "#00e0ff";
}

export const DEFAULT_CHARACTER_ID: CompanionId = "rosie";

export function versionedCharacterUrl(url: string) {
  const asset = manifest.characters.find((character) => character.model === url);
  return asset ? `${url}?v=${asset.sha256.slice(0, 12)}` : url;
}

const card = (id: CompanionId) => ({
  art: `/companions/cards/${id}.webp`,
  clean: `/companions/cards/${id}-clean.webp`,
  spec: `/companions/cards/${id}.json`,
});

// Order and colours follow the cards: OT-01 R.O.S.I.E cyan, OT-02 M.X.S.H.Y
// pink, OT-03 A.N.G.3.L silver, OT-04 S.U.K.I red.
export const BUILTIN_CHARACTERS: BuiltinCharacter[] = [
  { id: "rosie", name: "R.O.S.I.E", code: "OT-01", blurb: "The original. Your default companion.", color: "#00e0ff", url: "/characters/rosie.glb", card: card("rosie") },
  { id: "mxshy", name: "M.X.S.H.Y", code: "OT-02", blurb: "Your companion. A little otherworldly.", color: "#ff5fa8", url: "/characters/mxshy.glb", card: card("mxshy") },
  { id: "ang3l", name: "A.N.G.3.L", code: "OT-03", blurb: "Cybernetic visor, mechanical wings.", color: "#e8edf2", url: "/characters/ang3l.glb", card: card("ang3l") },
  { id: "suki", name: "S.U.K.I", code: "OT-04", blurb: "Cream helmet, ruby eyes. System online.", color: "#ff3b46", url: "/characters/suki.glb", card: card("suki") },
];

export function builtinCharacter(id: string): BuiltinCharacter | undefined {
  return BUILTIN_CHARACTERS.find((c) => c.id === id);
}

/** Clip roles for uploaded models (Mixamo-style libraries). Built-ins use the sleeve gestures. */
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
    find((n) => n === "idle") ??
    find((n) => n === "texting while standing") ??
    find((n) => n === "sad idle") ??
    find((n) => n.includes("idle")) ??
    find((n) => n.includes("swim")) ??
    find((n) => n.includes("walk")) ??
    names[0] ??
    null;
  const select =
    find((n) => n === "greeting") ??
    find((n) => n === "standing greeting") ??
    find((n) => n.includes("spin") || n.includes("jump") || n.includes("power")) ??
    find((n) => n.includes("run")) ??
    find((n) => n.includes("walk")) ??
    idle;
  return { idle, select };
}
