import type { WebsiteRipRow, WebsiteStatus } from "./repolensWebsitesDb";

export function parseUrl(raw: string): { url: string; hostname: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (!u.hostname.includes(".")) return null;
  const hostname = u.hostname.replace(/^www\./i, "");
  return { url: withScheme, hostname };
}

export function isTerminal(status: WebsiteStatus): boolean {
  return status === "done" || status === "error" || status === "cancelled";
}

// Concurrency cap = 1. Returns the id of the oldest queued rip to dispatch,
// or null if one is already running (or nothing is queued).
export function nextQueued(rows: WebsiteRipRow[]): string | null {
  if (rows.some((r) => r.status === "running")) return null;
  const queued = rows
    .filter((r) => r.status === "queued")
    .sort((a, b) => a.created_at - b.created_at);
  return queued[0]?.id ?? null;
}

const PHASES: Record<string, string> = {
  queued: "Queued",
  recon: "Recon",
  foundation: "Foundation",
  building: "Building",
  assembly: "Assembly",
  qa: "Visual QA",
  done: "Done",
};

export function phaseLabel(phase: string): string {
  if (!phase) return "Working";
  return PHASES[phase] ?? phase.charAt(0).toUpperCase() + phase.slice(1);
}
