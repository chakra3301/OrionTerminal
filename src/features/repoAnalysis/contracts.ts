import { parseDeclarations, type DeclarationEvidence } from "./declarations";
export const ANALYZER_VERSION = "intake-advisory-v3";
type SourceScope = "repository-documents";
export type Citation = { path: string; quote: string };
export type Assessment = {
  summary: string; mentalModel: string; goalFit: "candidate" | "uncertain" | "poor";
  strategy: "direct-skill" | "unsupported"; stackFit: string;
  integrationCost: "low" | "medium" | "high" | "unknown";
  blockers: string[];
  risks: { title: string; detail: string; severity: "concern" | "warning"; basis: "excerpt" | "inferred"; citations: Citation[] }[];
  nextSteps: string[]; limitations: string[];
};
export type SourceExcerpt = { path: string; sha256: string; excerptHash: string; originalBytes: number; truncated: boolean; text: string };
export type AnalysisSource = { declarations?: DeclarationEvidence[]; scope?: SourceScope; id: string; artifactHash: string; sourceHash: string; label: string; origin: string; inventory: { path: string; bytes: number; kind: string; sha256: string }[]; excerpts: SourceExcerpt[] };
export type HostProfile = { policy: "intake-text-v1"; enabledApps: string[] };
export type AnalysisEvidence = {
  version: 1; kind: "ai-assessment"; analyzer: typeof ANALYZER_VERSION | "intake-advisory-v1" | "intake-advisory-v2"; declarations?: DeclarationEvidence[]; scope?: SourceScope; id: string; createdAt: number;
  snapshotId: string; artifactHash: string; sourceHash: string; origin: string; label: string; goal: string; model: string;
  providerFingerprint: string; promptHash: string; host: HostProfile;
  coverage: Omit<SourceExcerpt, "text">[]; assessment: Assessment;
};
function record(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid analysis object");
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some((k) => !keys.includes(k) && !optional.includes(k)) || keys.some((k) => !Object.hasOwn(r, k))) throw new Error("Unsupported analysis fields");
  return r;
}
function text(value: unknown, max = 1600): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new Error("Invalid analysis text");
  return value;
}
function enumeration<T extends string>(value: unknown, choices: T[]): T {
  if (!choices.includes(value as T)) throw new Error("Unsupported analysis value");
  return value as T;
}
function list<T>(value: unknown, max: number, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid analysis list");
  return value.map(parse);
}
function hash(value: unknown): string { const s = text(value, 64); if (!/^[a-f0-9]{64}$/.test(s)) throw new Error("Invalid analysis hash"); return s; }
function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw new Error("Invalid analysis size");
  return value as number;
}
export function parseHostProfile(value: unknown): HostProfile {
  const h = record(value, ["policy", "enabledApps"]);
  if (h.policy !== "intake-text-v1") throw new Error("Unsupported analysis host policy");
  const enabledApps = list(h.enabledApps, 3, (v) => enumeration(v, ["orion", "archives", "xdesign"]));
  if (new Set(enabledApps).size !== enabledApps.length) throw new Error("Duplicate host capability");
  return { policy: "intake-text-v1", enabledApps: enabledApps.sort() };
}
export function parseAnalysisSource(value: unknown): AnalysisSource {
  const s = record(value, ["id", "artifactHash", "sourceHash", "label", "origin", "inventory", "excerpts"], ["scope", "declarations"]);
  const scope = s.scope === undefined ? {} : { scope: enumeration(s.scope, ["repository-documents"]) };
  const inventory = list(s.inventory, 128, (v) => {
    const f = record(v, ["path", "bytes", "kind", "sha256"]);
    return { path: text(f.path, 240), bytes: count(f.bytes, 1024 * 1024), kind: enumeration(f.kind, ["text", "attribution", "opaque", "inactive-code"]), sha256: hash(f.sha256) };
  });
  const excerpts = list(s.excerpts, 4, (v) => {
    const e = record(v, ["path", "sha256", "excerptHash", "originalBytes", "truncated", "text"]);
    if (typeof e.truncated !== "boolean") throw new Error("Invalid excerpt coverage");
    return { path: text(e.path, 240), sha256: hash(e.sha256), excerptHash: hash(e.excerptHash), originalBytes: count(e.originalBytes, 256 * 1024), truncated: e.truncated, text: text(e.text, 8300) };
  });
  if (!inventory.length || !excerpts.length || new Set(inventory.map((f) => f.path)).size !== inventory.length || new Set(excerpts.map((f) => f.path)).size !== excerpts.length || inventory.reduce((n, f) => n + f.bytes, 0) > 8 * 1024 * 1024) throw new Error("Invalid source inventory");
  const declarations = declarationScope(s.declarations, s.scope, excerpts);
  return { ...scope, ...declarations, id: text(s.id, 64), artifactHash: hash(s.artifactHash), sourceHash: hash(s.sourceHash), label: text(s.label, 240), origin: text(s.origin, 1024), inventory, excerpts };
}
function declarationScope(value: unknown, scope: unknown, files: { path: string; sha256: string }[]): { declarations?: DeclarationEvidence[] } {
  if (value === undefined) return {};
  if (scope !== "repository-documents") throw new Error("Declarations require repository-document scope");
  const declarations = parseDeclarations(value);
  if (declarations.some((d) => !files.some((f) => f.path === d.path && f.sha256 === d.sha256))) throw new Error("Declaration source identity mismatch");
  return { declarations };
}
export function parseAssessment(value: unknown, excerpts?: SourceExcerpt[]): Assessment {
  const r = record(value, ["summary", "mentalModel", "goalFit", "strategy", "stackFit", "integrationCost", "blockers", "risks", "nextSteps", "limitations"]);
  const risks = list(r.risks, 6, (v) => {
    const risk = record(v, ["title", "detail", "severity", "basis", "citations"]);
    const basis = enumeration(risk.basis, ["excerpt", "inferred"]);
    const citations = list(risk.citations, 3, (v) => {
      const c = record(v, ["path", "quote"]), path = text(c.path, 240), quote = text(c.quote, 240);
      if (quote.trim().length < 8 || (excerpts && !excerpts.some((e) => e.path === path && e.text.includes(quote)))) throw new Error("An analysis citation does not match a submitted excerpt");
      return { path, quote };
    });
    if ((basis === "excerpt") !== (citations.length > 0)) throw new Error("Analysis evidence basis is inconsistent");
    return { title: text(risk.title, 160), detail: text(risk.detail), severity: enumeration(risk.severity, ["concern", "warning"]), basis, citations };
  });
  return {
    summary: text(r.summary), mentalModel: text(r.mentalModel), goalFit: enumeration(r.goalFit, ["candidate", "uncertain", "poor"]),
    strategy: enumeration(r.strategy, ["direct-skill", "unsupported"]), stackFit: text(r.stackFit), integrationCost: enumeration(r.integrationCost, ["low", "medium", "high", "unknown"]),
    blockers: list(r.blockers, 6, (v) => text(v)), risks, nextSteps: list(r.nextSteps, 5, (v) => text(v)), limitations: list(r.limitations, 6, (v) => text(v)),
  };
}
export function parseEvidence(value: unknown): AnalysisEvidence {
  const r = record(value, ["version", "kind", "analyzer", "id", "createdAt", "snapshotId", "artifactHash", "sourceHash", "origin", "label", "goal", "model", "providerFingerprint", "promptHash", "host", "coverage", "assessment"], ["scope", "declarations"]);
  if (r.version !== 1 || r.kind !== "ai-assessment" || ![ANALYZER_VERSION, "intake-advisory-v1", "intake-advisory-v2"].includes(r.analyzer as string)) throw new Error("Unsupported saved analysis version");
  const scope = r.scope === undefined ? {} : { scope: enumeration(r.scope, ["repository-documents"]) };
  if ((r.scope && r.analyzer === "intake-advisory-v1") || (r.declarations !== undefined && r.analyzer !== ANALYZER_VERSION)) throw new Error("Invalid legacy analysis scope");
  const host = parseHostProfile(r.host);
  const coverage = list(r.coverage, 4, (v) => {
    const e = record(v, ["path", "sha256", "excerptHash", "originalBytes", "truncated"]);
    if (typeof e.truncated !== "boolean") throw new Error("Invalid excerpt coverage");
    return { path: text(e.path, 240), sha256: hash(e.sha256), excerptHash: hash(e.excerptHash), originalBytes: count(e.originalBytes, 256 * 1024), truncated: e.truncated };
  });
  if (!coverage.length || new Set(coverage.map((e) => e.path)).size !== coverage.length) throw new Error("Invalid analysis coverage");
  const declarations = declarationScope(r.declarations, r.scope, coverage);
  const result: AnalysisEvidence = { ...scope, ...declarations, version: 1, kind: "ai-assessment", analyzer: r.analyzer as AnalysisEvidence["analyzer"], id: text(r.id, 64), createdAt: count(r.createdAt), snapshotId: text(r.snapshotId, 64), artifactHash: hash(r.artifactHash), sourceHash: hash(r.sourceHash), origin: text(r.origin, 1024), label: text(r.label, 240), goal: text(r.goal, 2000), model: text(r.model, 1024), providerFingerprint: hash(r.providerFingerprint), promptHash: hash(r.promptHash), host, coverage, assessment: parseAssessment(r.assessment) };
  if (result.scope && result.assessment.strategy !== "unsupported") throw new Error("Repository documents cannot qualify as installable skills");
  if (new TextEncoder().encode(JSON.stringify(result)).length > 32_768) throw new Error("Analysis exceeds saved report limit");
  return result;
}
export function parseHistory(value: unknown): AnalysisEvidence[] {
  const r = record(value, ["version", "items"]);
  if (r.version !== 1) throw new Error("Unsupported analysis history version");
  const items = list(r.items, 8, parseEvidence);
  if (new Set(items.map((e) => e.id)).size !== items.length) throw new Error("Duplicate saved analysis ID");
  return items;
}
