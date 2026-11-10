export type RepositoryOrigin = { url: string; requestedRef: string; commit: string; tree: string };
export type SkillMetadata = {
  name: string; description: string; license: string | null; compatibility: string | null;
  allowedTools: string | null; metadata: Record<string, string>;
};
export type IntakeFile = { path: string; sourcePath: string; bytes: number; sha256: string; sourceMode: number; kind: "text" | "opaque" | "inactive-code" | "attribution" };
export type IntakeCandidate = {
  schemaVersion: 1; id: string; sourceLabel: string; entrypoint: string;
  sourceHash: string; artifactHash: string; metadata: SkillMetadata;
  files: IntakeFile[]; totalBytes: number; createdAt: number; warnings: string[];
  repository?: RepositoryOrigin;
};
export type RepositoryDocument = { path: string; bytes: number };
export type RepositoryReview = { schemaVersion: 1; id: string; label: string; repository: RepositoryOrigin; files: (RepositoryDocument & { sha256: string; text: string })[] };
export type IntakeDiscovery = { id: string; label: string; entries: { path: string }[]; attributionFiles: string[]; repository?: RepositoryOrigin; reviewFiles?: RepositoryDocument[] };
export function repositoryDocumentPath(value: unknown): string {
  const path = packagePath(value);
  if (!["readme", "readme.md", "readme.txt", "readme.rst", "license", "license.md", "license.txt", "notice", "notice.md", "notice.txt", "package.json", "pyproject.toml", "cargo.toml", "go.mod", "requirements.txt", "setup.cfg", "dockerfile", "compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"].includes(path.toLowerCase())) throw new Error("Unsupported repository review document");
  return path;
}

function object(v: unknown, keys?: string[], optional: string[] = []): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid Intake record");
  const r = v as Record<string, unknown>;
  if (keys && (Object.keys(r).some((k) => !keys.includes(k) && !optional.includes(k)) || keys.some((k) => !(k in r)))) throw new Error("Unsupported Intake fields");
  return r;
}
function text(v: unknown, max = 4096): string {
  if (typeof v !== "string" || v.length > max || v.includes("\0")) throw new Error("Invalid Intake text");
  return v;
}
function count(v: unknown, max: number): number {
  if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > max) throw new Error("Invalid Intake size");
  return v as number;
}
function array<T>(v: unknown, max: number, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > max) throw new Error("Invalid Intake list");
  return v.map(parse);
}
function id(v: unknown): string { const s = text(v, 26); if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(s)) throw new Error("Invalid Intake ID"); return s; }
function hash(v: unknown): string { const s = text(v, 64); if (!/^[a-f0-9]{64}$/.test(s)) throw new Error("Invalid Intake hash"); return s; }
export function packagePath(v: unknown): string {
  const s = text(v, 240);
  if (!s || s.split("/").some((p) => !/^[A-Za-z0-9._ -]+$/.test(p) || p === "." || p === ".." || /[ .]$/.test(p))) throw new Error("Invalid package-relative path");
  return s;
}
export function repositoryUrl(value: string): string {
  const url = value.trim();
  if (url.length > 512 || !/^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,104}(?:\/tree\/[a-f0-9]{40})?\/?$/.test(url)) throw new Error("Use a public https://github.com/owner/repo link, optionally /tree/<full commit SHA>.");
  const name = url.split("/")[4]!.replace(/\.git$/, "");
  if (!name || name.length > 100 || name === "." || name === "..") throw new Error("Invalid repository name");
  return url;
}
function repository(v: unknown): RepositoryOrigin {
  const r = object(v, ["url", "requestedRef", "commit", "tree"]);
  const url = repositoryUrl(text(r.url, 512));
  if (url.endsWith("/") || url.endsWith(".git") || url.split("/").length !== 5) throw new Error("Invalid canonical repository URL");
  const commit = text(r.commit, 40), tree = text(r.tree, 40), requestedRef = text(r.requestedRef, 40);
  if (![commit, tree].every((v) => /^[a-f0-9]{40}$/.test(v)) || !(requestedRef === "HEAD" || /^[a-f0-9]{40}$/.test(requestedRef))) throw new Error("Invalid pinned revision");
  return { url, commit, tree, requestedRef };
}
const optionalText = (v: unknown) => v === null ? null : text(v);
export function parseCandidate(v: unknown): IntakeCandidate {
  const r = object(v, ["schemaVersion", "id", "sourceLabel", "entrypoint", "sourceHash", "artifactHash", "metadata", "files", "totalBytes", "createdAt", "warnings"], ["repository"]);
  if (r.schemaVersion !== 1) throw new Error("Unsupported Intake version; stored data was not changed");
  const m = object(r.metadata, ["name", "description", "license", "compatibility", "allowedTools", "metadata"]);
  const name = text(m.name, 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("Invalid skill name");
  const description = text(m.description, 2048);
  if (!description.trim()) throw new Error("Missing skill description");
  const extra = object(m.metadata);
  if (Object.keys(extra).length > 32) throw new Error("Too much skill metadata");
  const files = array(r.files, 128, (v): IntakeFile => {
    const f = object(v, ["path", "sourcePath", "bytes", "sha256", "sourceMode", "kind"]);
    if (!["text", "opaque", "inactive-code", "attribution"].includes(f.kind as string)) throw new Error("Unsupported resource type");
    if (![0o100644, 0o100755].includes(f.sourceMode as number)) throw new Error("Unsupported source mode");
    return { path: packagePath(f.path), sourcePath: packagePath(f.sourcePath), bytes: count(f.bytes, 1024 * 1024), sha256: hash(f.sha256), sourceMode: f.sourceMode as number, kind: f.kind as IntakeFile["kind"] };
  });
  const totalBytes = count(r.totalBytes, 8 * 1024 * 1024);
  if (!files.length || new Set(files.map((f) => f.path.toLowerCase())).size !== files.length || files.some((f) => !f.path.startsWith(`${name}/`)) || !files.some((f) => f.path === `${name}/SKILL.md`) || files.reduce((n, f) => n + f.bytes, 0) !== totalBytes) throw new Error("Inconsistent Intake manifest");
  return {
    schemaVersion: 1, id: id(r.id), sourceLabel: text(r.sourceLabel, 240), entrypoint: packagePath(r.entrypoint),
    sourceHash: hash(r.sourceHash), artifactHash: hash(r.artifactHash), files, totalBytes, createdAt: count(r.createdAt, Number.MAX_SAFE_INTEGER),
    metadata: { name, description, license: optionalText(m.license), compatibility: optionalText(m.compatibility), allowedTools: optionalText(m.allowedTools), metadata: Object.fromEntries(Object.entries(extra).map(([k, v]) => [text(k, 128), text(v)])) },
    warnings: array(r.warnings, 32, (v) => text(v)),
    ...(r.repository === undefined ? {} : { repository: repository(r.repository) }),
  };
}
export function parseDiscovery(v: unknown): IntakeDiscovery {
  const r = object(v, ["id", "label", "entries", "attributionFiles"], ["repository", "reviewFiles"]);
  const entries = array(r.entries, 64, (v) => ({ path: packagePath(object(v, ["path"]).path) }));
  const reviewFiles = r.reviewFiles === undefined ? undefined : array(r.reviewFiles, 32, (v) => {
    const f = object(v, ["path", "bytes"]);
    const bytes = count(f.bytes, 256 * 1024);
    if (!bytes) throw new Error("Empty review document");
    return { path: repositoryDocumentPath(f.path), bytes };
  });
  if (reviewFiles && (!r.repository || new Set(reviewFiles.map((f) => f.path.toLowerCase())).size !== reviewFiles.length)) throw new Error("Invalid repository document catalog");
  if ((!entries.length && !(r.repository && reviewFiles)) || new Set(entries.map((e) => e.path)).size !== entries.length || entries.some((e) => !e.path.endsWith("SKILL.md"))) throw new Error("Invalid skill entrypoints");
  return { id: id(r.id), label: text(r.label, 240), entries, attributionFiles: array(r.attributionFiles, 6, packagePath), ...(r.repository === undefined ? {} : { repository: repository(r.repository) }), ...(reviewFiles === undefined ? {} : { reviewFiles }) };
}
export function parseRepositoryReview(value: unknown): RepositoryReview {
  const r = object(value, ["schemaVersion", "id", "label", "repository", "files"]);
  if (r.schemaVersion !== 1) throw new Error("Unsupported repository review version");
  const files = array(r.files, 4, (v) => {
    const f = object(v, ["path", "bytes", "sha256", "text"]);
    const body = text(f.text, 256 * 1024), bytes = count(f.bytes, 256 * 1024);
    if (!bytes || new TextEncoder().encode(body).length !== bytes || body.startsWith("#!")) throw new Error("Invalid repository document bytes");
    return { path: repositoryDocumentPath(f.path), bytes, sha256: hash(f.sha256), text: body };
  });
  if (!files.length || new Set(files.map((f) => f.path.toLowerCase())).size !== files.length) throw new Error("Invalid repository review files");
  return { schemaVersion: 1, id: id(r.id), label: text(r.label, 240), repository: repository(r.repository), files };
}
export function parseCandidates(v: unknown): IntakeCandidate[] { return array(v, 4, parseCandidate); }

export type InstalledSkill = { skillId: string; enabled: boolean; active: IntakeCandidate; versions: IntakeCandidate[] };
export type SkillContextSelection = { skillId: string; versionId: string; paths: string[] };
export type SkillContextPart = { skillId: string; versionId: string; path: string; sha256: string; text: string };
export function importedSkillId(v: unknown): string {
  const s = text(v, 35);
  if (!s.startsWith("imported:")) throw new Error("Invalid imported skill identity");
  id(s.slice(9)); return s;
}
export function parseInstalledSkill(v: unknown): InstalledSkill {
  const r = object(v, ["skillId", "enabled", "active", "versions"]);
  if (typeof r.enabled !== "boolean") throw new Error("Invalid skill enabled state");
  const active = parseCandidate(r.active), versions = array(r.versions, 2, parseCandidate);
  if (!versions.length || new Set(versions.map((v) => v.id)).size !== versions.length || !versions.some((v) => JSON.stringify(v) === JSON.stringify(active)) || versions.some((v) => v.metadata.name !== active.metadata.name)) throw new Error("Invalid installed version ownership");
  return { skillId: importedSkillId(r.skillId), enabled: r.enabled, active, versions };
}
export function parseInstalledSkills(v: unknown): InstalledSkill[] {
  const items = array(v, 24, parseInstalledSkill);
  if (new Set(items.map((s) => s.skillId)).size !== items.length) throw new Error("Duplicate installed identity");
  return items;
}
export function parseSkillContext(v: unknown): SkillContextPart[] {
  const parts = array(v, 36, (v): SkillContextPart => {
    const r = object(v, ["skillId", "versionId", "path", "sha256", "text"]);
    return { skillId: importedSkillId(r.skillId), versionId: id(r.versionId), path: packagePath(r.path), sha256: hash(r.sha256), text: text(r.text, 256 * 1024) };
  });
  if (!parts.length || parts.reduce((n, p) => n + new TextEncoder().encode(p.text).length, 0) > 256 * 1024) throw new Error("Invalid skill context size");
  return parts;
}
