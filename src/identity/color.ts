import { identitySeed } from "./glyph";

const STARTERS: Record<string, { hue: number; previous: string }> = {
  "builtin:web-research": { hue: 190, previous: "#00e0ff" },
  "builtin:cite-sources": { hue: 225, previous: "#00e0ff" },
  "builtin:code-reviewer": { hue: 145, previous: "#39ff88" },
  "builtin:summarizer": { hue: 275, previous: "#b14cff" },
  "builtin:data-analyst": { hue: 42, previous: "#e6ff3a" },
  "builtin:note-taker": { hue: 325, previous: "#39ff88" },
};

export function identityAccent(identity: string): string {
  const seed = identitySeed(`color:${identity}`);
  const hue = STARTERS[identity.replace(/^skill:/, "")]?.hue ?? seed % 36000 / 100;
  const saturation = .82 + ((seed >>> 8) % 9) / 100, light = .61 + ((seed >>> 16) % 5) / 100;
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12, a = saturation * Math.min(light, 1 - light);
    return Math.round((light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function skillAccent(id: string, saved: string): string {
  const original = STARTERS[id];
  // Upgrade the old repeated defaults at render time; keep explicit custom colours and saved data.
  return !saved || original?.previous === saved.toLowerCase() ? identityAccent(`skill:${id}`) : saved;
}
