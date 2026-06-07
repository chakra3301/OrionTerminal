import type { HermesStatus } from "@/store/hermesStore";

// status → uppercase badge label (matches the reference command-center vibe)
export const STATUS_LABEL: Record<HermesStatus, string> = {
  idle: "IDLE",
  running: "WORKING",
  completed: "DONE",
  failed: "ERROR",
  cancelled: "STOPPED",
  paused: "PAUSED",
};

// status → css class suffix; the orange+black palette keys colors off these
// (.s-working = orange, .s-done = green, .s-error = red, .s-idle/.s-cancel = grey)
export const STATUS_CLS: Record<HermesStatus, string> = {
  idle: "idle",
  running: "working",
  completed: "done",
  failed: "error",
  cancelled: "cancel",
  paused: "paused",
};

// Models a Hermes agent can run on come from the shared registry; re-exported
// under the name the Hermes components already import.
export {
  MODELS as HERMES_MODELS,
  DEFAULT_MODEL_ID,
  modelLabel,
  modelShort,
} from "@/lib/models";

// floor sort: running first, then paused (needs attention), errors, idle, done
export const STATUS_RANK: Record<HermesStatus, number> = {
  running: 0,
  paused: 1,
  failed: 2,
  idle: 3,
  completed: 4,
  cancelled: 5,
};

// Each task reads like a "department" on the floor — give it a stable color
// (a small distinct palette so swarms are visually separable on a black floor).
const DEPT_PALETTE = [
  "#ff8a3d",
  "#ffce5c",
  "#b07cff",
  "#4fd18b",
  "#5a9bff",
  "#ff7eb6",
];
export function deptColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return DEPT_PALETTE[h % DEPT_PALETTE.length] ?? "#ff8a3d";
}

// Tail of an agent's streamed output, rendered as a live log feed on the card.
export function tailLines(text: string, n: number): string[] {
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  return lines.slice(-n);
}

// Heuristic kind for a log line, so the feed gets the reference's colored
// left-borders without inventing structured event data.
export function logKind(line: string): string {
  const t = line.trim();
  // Live-feed glyphs from the engine: ▸ tool call, ✓ done, ✗ failed.
  if (t.startsWith("▸")) return "dispatch";
  if (t.startsWith("✗")) return "error";
  if (t.startsWith("✓")) return "report";
  const l = t.toLowerCase();
  if (/(error|fail|exception|cannot|denied|timed? ?out|refused)/.test(l))
    return "error";
  if (/(✓|✔|done|complete|finished|success|wrote|created|saved|committed)/.test(l))
    return "report";
  if (/(tool_call|running|executing|fetch|search|read |calling|invoke|\$ |npm |git )/.test(l))
    return "dispatch";
  if (/(found|finding|result|insight|note:|confidence)/.test(l)) return "finding";
  return "info";
}

// Compact relative time (e.g. "3m", "2h") for card/rail/detail meta.
export function relTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}
