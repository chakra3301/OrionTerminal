export const DECLARATION_PARSER = "manifest-declarations-v1";
export type Declaration = { category: "runtime" | "platform" | "dependency" | "script" | "unparsed"; name: string; value: string };
const ISSUES = ["invalid-json", "ambiguous-json", "json-depth", "shape", "complex-requirement", "output-limit", "unsupported-format", "input-limit"] as const;
type Issue = typeof ISSUES[number];
export type DeclarationEvidence = {
  parser: typeof DECLARATION_PARSER; path: string; sha256: string;
  format: "package-json" | "requirements-lines" | "unsupported";
  status: "observed" | "partial" | "invalid" | "unsupported";
  declarations: Declaration[]; omitted: number; issues: Issue[];
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function exact(v: unknown, keys: string[]): Record<string, unknown> {
  if (!object(v) || Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k))) throw new Error("Invalid declaration evidence fields");
  return v;
}
function bounded(v: unknown, max: number): v is string { return typeof v === "string" && !!v.trim() && v.length <= max && !v.includes("\0"); }
export function parseDeclarations(value: unknown): DeclarationEvidence[] {
  if (!Array.isArray(value) || value.length > 4) throw new Error("Invalid declaration evidence list");
  const result = value.map((v): DeclarationEvidence => {
    const r = exact(v, ["parser", "path", "sha256", "format", "status", "declarations", "omitted", "issues"]);
    if (r.parser !== DECLARATION_PARSER || !bounded(r.path, 240) || !bounded(r.sha256, 64) || !/^[a-f0-9]{64}$/.test(r.sha256)
      || !["package-json", "requirements-lines", "unsupported"].includes(r.format as string)
      || !["observed", "partial", "invalid", "unsupported"].includes(r.status as string)
      || !Number.isSafeInteger(r.omitted) || (r.omitted as number) < 0 || (r.omitted as number) > 262144
      || !Array.isArray(r.issues) || r.issues.length > ISSUES.length || r.issues.some((i) => !ISSUES.includes(i)) || new Set(r.issues).size !== r.issues.length
      || !Array.isArray(r.declarations) || r.declarations.length > 12) throw new Error("Invalid declaration evidence");
    const expectedFormat = r.path === "package.json" ? "package-json" : r.path === "requirements.txt" ? "requirements-lines" : "unsupported";
    if (r.format !== expectedFormat || (r.status === "unsupported") !== (r.format === "unsupported" && r.status !== "invalid")) throw new Error("Inconsistent declaration format");
    const declarations = r.declarations.map((v): Declaration => {
      const d = exact(v, ["category", "name", "value"]);
      if (!["runtime", "platform", "dependency", "script", "unparsed"].includes(d.category as string) || !bounded(d.name, 96) || !bounded(d.value, 256)) throw new Error("Invalid declaration");
      return { category: d.category as Declaration["category"], name: d.name, value: d.value };
    });
    if ((r.status === "observed" && (r.issues.length || r.omitted)) || (["invalid", "unsupported"].includes(r.status as string) && declarations.length)
      || (r.status !== "observed" && !r.issues.length)) throw new Error("Inconsistent declaration coverage");
    return { parser: DECLARATION_PARSER, path: r.path, sha256: r.sha256, format: r.format as DeclarationEvidence["format"], status: r.status as DeclarationEvidence["status"], declarations, omitted: r.omitted as number, issues: r.issues as Issue[] };
  });
  if (new Set(result.map((r) => r.path)).size !== result.length || new TextEncoder().encode(JSON.stringify(result)).length > 16 * 1024) throw new Error("Declaration evidence exceeds its limit");
  return result;
}
function jsonIssue(text: string): Issue | null {
  const stack: { keys: Set<string> | null; key: boolean }[] = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)) {
    const token = match[0], frame = stack.at(-1);
    if (token === "{" || token === "[") {
      if (stack.length >= 64) return "json-depth";
      stack.push({ keys: token === "{" ? new Set() : null, key: true });
    } else if (token === "}" || token === "]") stack.pop();
    else if (frame && token === ":") frame.key = false;
    else if (frame && token === ",") frame.key = true;
    else if (frame?.keys && frame.key && token.startsWith('"')) {
      const key = JSON.parse(token) as string;
      if (frame.keys.has(key)) return "ambiguous-json";
      frame.keys.add(key);
    }
  }
  return null;
}
export function inspectDeclarations(file: { path: string; sha256: string; text: string }): DeclarationEvidence {
  const format = file.path === "package.json" ? "package-json" : file.path === "requirements.txt" ? "requirements-lines" : "unsupported";
  const report: DeclarationEvidence = { parser: DECLARATION_PARSER, path: file.path, sha256: file.sha256, format, status: "observed", declarations: [], omitted: 0, issues: [] };
  const issue = (v: Issue) => { if (!report.issues.includes(v)) report.issues.push(v); };
  let emittedBytes = 0;
  const emit = (category: Declaration["category"], name: string, value: unknown) => {
    if (typeof value !== "string" || !value.trim() || value.includes("\0") || !name.trim() || name.includes("\0")) { ++report.omitted; issue("shape"); return; }
    if (name.length > 96 || value.length > 256 || report.declarations.length >= 12) { ++report.omitted; issue("output-limit"); return; }
    const declaration = { category, name, value };
    const bytes = new TextEncoder().encode(JSON.stringify(declaration)).length;
    if (emittedBytes + bytes > 2500) { ++report.omitted; issue("output-limit"); return; }
    emittedBytes += bytes;
    report.declarations.push(declaration);
  };
  if (new TextEncoder().encode(file.text).length > 256 * 1024) { report.status = "invalid"; issue("input-limit"); return report; }
  if (format === "unsupported") { report.status = "unsupported"; issue("unsupported-format"); return report; }
  if (format === "package-json") {
    let data: unknown;
    try { data = JSON.parse(file.text); } catch { report.status = "invalid"; issue("invalid-json"); return report; }
    const ambiguity = jsonIssue(file.text);
    if (ambiguity || !object(data)) { report.status = "invalid"; issue(ambiguity ?? "shape"); return report; }
    const map = (field: string, category: Declaration["category"]) => {
      if (!Object.hasOwn(data, field)) return;
      const value = data[field];
      if (!object(value)) { ++report.omitted; issue("shape"); return; }
      for (const [name, spec] of Object.entries(value)) emit(category, `${field}.${name}`, spec);
    };
    if (Object.hasOwn(data, "packageManager")) emit("runtime", "packageManager", data.packageManager);
    map("engines", "runtime");
    for (const field of ["os", "cpu", "libc"]) {
      if (!Object.hasOwn(data, field)) continue;
      const values = data[field];
      if (!Array.isArray(values)) { ++report.omitted; issue("shape"); continue; }
      for (const value of values) emit("platform", field, value);
    }
    map("scripts", "script");
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) map(field, "dependency");
  } else {
    for (const [index, raw] of file.text.split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const simple = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s*(?:==|>=|<=|~=|!=|>|<)[A-Za-z0-9.*+!_-]+)?$/.exec(line);
      if (simple) emit("dependency", simple[1]!, line);
      else { issue("complex-requirement"); emit("unparsed", `line ${index + 1}`, line); }
    }
  }
  if (report.issues.length) report.status = "partial";
  return report;
}
