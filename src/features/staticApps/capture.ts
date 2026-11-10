import { invoke } from "@tauri-apps/api/core";
import { dataList, exactData, preparationId, sourceKey, STATIC_RECIPE, type SourceFile, type SourcePacket, type ValidatedSource } from "./contracts";
import { RECIPE_2048 } from "./recipe";
import { digest, encodeText } from "./hash";
import { validateStaticSource } from "./source";

export type CaptureOrigin = Readonly<{ url: string; requestedRef: string; commit: string; tree: string }>;
export type CaptureSummary = Readonly<{ schemaVersion: 1; id: string; recipeId: typeof STATIC_RECIPE; sourceHash: string; captureHash: string; totalBytes: number; fileCount: number; createdAt: number; origins: readonly CaptureOrigin[] }>;
export type ValidatedCapture = Readonly<{ summary: CaptureSummary; source: ValidatedSource }>;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const gitHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const origins = new Map(RECIPE_2048.files.map((f) => [`https://github.com/${f.repository}`, f.commit]));
const PRIMARY_TREE = "693fbb47db2d71aa65cc0e566a288473970233e6";
export function parseCaptureSummary(value: unknown): CaptureSummary {
  const r = exactData(value, ["schemaVersion", "id", "recipeId", "sourceHash", "captureHash", "totalBytes", "fileCount", "createdAt", "origins"]);
  const id = preparationId(r.id);
  if (r.schemaVersion !== 1 || r.recipeId !== STATIC_RECIPE || !hash(r.sourceHash) || !hash(r.captureHash) || r.totalBytes !== RECIPE_2048.files.reduce((sum, f) => sum + f.bytes, 0) || r.fileCount !== RECIPE_2048.files.length || !Number.isSafeInteger(r.createdAt) || (r.createdAt as number) < 0) throw new Error("Unsupported captured source metadata; saved data was not changed");
  const seen = new Set<string>();
  const copiedOrigins = dataList(r.origins, origins.size).map((value): CaptureOrigin => {
    const o = exactData(value, ["url", "requestedRef", "commit", "tree"]);
    if (typeof o.url !== "string" || origins.get(o.url) !== o.commit || o.requestedRef !== o.commit || !gitHash(o.tree) || seen.has(o.url) || (o.url === "https://github.com/gabrielecirulli/2048" && o.tree !== PRIMARY_TREE)) throw new Error("Captured repository/revision/tree changed");
    seen.add(o.url);
    return Object.freeze({ url: o.url, requestedRef: o.requestedRef as string, commit: o.commit as string, tree: o.tree });
  });
  if (seen.size !== origins.size) throw new Error("Incomplete captured repository inventory");
  return Object.freeze({ schemaVersion: 1, id, recipeId: STATIC_RECIPE, sourceHash: r.sourceHash, captureHash: r.captureHash, totalBytes: r.totalBytes as number, fileCount: r.fileCount as number, createdAt: r.createdAt as number, origins: Object.freeze(copiedOrigins) });
}
export function parseCaptureList(value: unknown): readonly CaptureSummary[] {
  const seen = new Set<string>();
  return Object.freeze(dataList(value, 8).map((value) => {
    const s = parseCaptureSummary(value);
    if (seen.has(s.id)) throw new Error("Duplicate captured source identity");
    seen.add(s.id); return s;
  }));
}
function copyPacket(value: unknown): SourcePacket {
  const r = exactData(value, ["version", "recipeId", "files"]);
  if (r.version !== 1 || r.recipeId !== STATIC_RECIPE) throw new Error("Unsupported captured source version");
  const catalog = new Map(RECIPE_2048.files.map((f) => [sourceKey(f), f]));
  const files = dataList(r.files, 24).map((value) => {
    const f = exactData(value, ["repository", "commit", "path", "sourceMode", "dataBase64"]);
    if (typeof f.repository !== "string" || f.repository.length > 128 || typeof f.commit !== "string" || f.commit.length !== 40 || typeof f.path !== "string" || f.path.length > 240 || !["100644", "100755"].includes(f.sourceMode as string) || typeof f.dataBase64 !== "string") throw new Error("Invalid captured source file");
    const spec = catalog.get(sourceKey(f as SourceFile));
    if (!spec || f.dataBase64.length !== 4 * Math.ceil(spec.bytes / 3)) throw new Error("Captured file is unpinned or exceeds bounds");
    return { repository: f.repository, commit: f.commit, path: f.path, sourceMode: f.sourceMode, dataBase64: f.dataBase64 } as SourceFile;
  });
  return { version: 1, recipeId: STATIC_RECIPE, files };
}
export async function validateCapture(value: unknown): Promise<ValidatedCapture> {
  const r = exactData(value, ["summary", "packet"]), summary = parseCaptureSummary(r.summary), packet = copyPacket(r.packet);
  const source = await validateStaticSource(packet);
  const identity = { schemaVersion: summary.schemaVersion, id: summary.id, recipeId: summary.recipeId, sourceHash: summary.sourceHash, totalBytes: summary.totalBytes, createdAt: summary.createdAt, origins: summary.origins, packet };
  if (source.sourceHash !== summary.sourceHash || source.totalBytes !== summary.totalBytes || await digest(encodeText(JSON.stringify(identity))) !== summary.captureHash) throw new Error("Captured source identity or bytes changed; reload before preparation");
  return Object.freeze({ summary, source });
}
export const staticCaptures = {
  async fetch(jobId: string): Promise<ValidatedCapture> {
    return validateCapture(await invoke<unknown>("intake_static_fetch", { recipeId: STATIC_RECIPE, jobId: preparationId(jobId) }));
  },
  async cancel(jobId: string): Promise<void> { await invoke("intake_static_cancel", { jobId: preparationId(jobId) }); },
  async list(): Promise<readonly CaptureSummary[]> { return parseCaptureList(await invoke<unknown>("intake_static_list")); },
  async read(value: CaptureSummary): Promise<ValidatedCapture> {
    const expected = parseCaptureSummary(value);
    const capture = await validateCapture(await invoke<unknown>("intake_static_read", { id: expected.id, expectedHash: expected.captureHash }));
    if (capture.summary.id !== expected.id || capture.summary.captureHash !== expected.captureHash || capture.summary.sourceHash !== expected.sourceHash) throw new Error("Captured source changed since selection; reload and review again");
    return capture;
  },
  async discard(value: CaptureSummary): Promise<void> {
    const expected = parseCaptureSummary(value);
    await invoke("intake_static_discard", { id: expected.id, expectedHash: expected.captureHash });
  },
};
