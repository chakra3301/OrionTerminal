import { invoke } from "@tauri-apps/api/core";
import { ulid } from "ulid";
import { dataList, exactData, preparationId, STATIC_OUTPUT_LIMIT, type PreparedCandidate } from "./contracts";
import { parseCaptureSummary, staticCaptures, type CaptureSummary } from "./capture";
import { prepareStaticCandidate, verifyPreparedCandidate } from "./generator";
import { parsePackageInspection } from "@/plugins/pluginInstallReview";
import type { CommunityPluginInspection } from "@/plugins/communityTypes";
export type PreparedSummary = Readonly<{ schemaVersion: 1; id: string; source: CaptureSummary; pluginId: string; recipeHash: string; outputHash: string; totalBytes: number; createdAt: number; inspection: CommunityPluginInspection }>;
export type PreparedReview = { summary: PreparedSummary; candidate: PreparedCandidate };
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function parsePreparedSummary(value: unknown): PreparedSummary {
  const r = exactData(value, ["schemaVersion", "id", "source", "pluginId", "recipeHash", "outputHash", "totalBytes", "createdAt", "inspection"]), id = preparationId(r.id), source = parseCaptureSummary(r.source);
  const inspection = parsePackageInspection(exactData(r.inspection, ["manifest", "fingerprint", "fileCount", "totalBytes"]));
  if (r.schemaVersion !== 1 || r.pluginId !== `dev.orion.prepared2048.${id.toLowerCase()}` || !hash(r.recipeHash) || !hash(r.outputHash) || !Number.isSafeInteger(r.totalBytes) || (r.totalBytes as number) < 1 || (r.totalBytes as number) > STATIC_OUTPUT_LIMIT || !Number.isSafeInteger(r.createdAt) || (r.createdAt as number) < 0
    || inspection.manifest.id !== r.pluginId || inspection.fileCount !== 35 || inspection.totalBytes !== r.totalBytes || inspection.manifest.permissions.join() !== "storage.plugin") throw new Error("Prepared review metadata changed; reload before review");
  return Object.freeze({ schemaVersion: 1, id, source, pluginId: r.pluginId as string, recipeHash: r.recipeHash, outputHash: r.outputHash, totalBytes: r.totalBytes as number, createdAt: r.createdAt as number, inspection });
}
function copyCandidate(input: unknown): Record<string, unknown> {
  const detached = exactData(input, ["version", "recipeId", "candidateId", "pluginId", "sourceHash", "recipeHash", "outputHash", "totalBytes", "files"]);
  const files = dataList(detached.files, 35).map((v) => exactData(v, ["path", "bytes", "sha256", "dataBase64"]));
  return { ...detached, files };
}
export const preparedApps = {
  async list(): Promise<readonly PreparedSummary[]> {
    const seen = new Set<string>();
    return Object.freeze(dataList(await invoke<unknown>("intake_prepared_list"), 8).map((v) => {
      const s = parsePreparedSummary(v); if (seen.has(s.id)) throw new Error("Duplicate prepared identity"); seen.add(s.id); return s;
    }));
  },
  async prepare(value: CaptureSummary, current: () => boolean, onCommit?: () => void): Promise<PreparedSummary> {
    const source = parseCaptureSummary(value), captured = await staticCaptures.read(source);
    if (!current()) throw new Error("Preparation dismissed before generating bytes");
    const candidate = await prepareStaticCandidate(captured.source, ulid());
    if (!current()) throw new Error("Preparation dismissed; no candidate was saved");
    return this.save(source, candidate, current, onCommit);
  },
  async save(value: CaptureSummary, input: unknown, current: () => boolean, onCommit?: () => void): Promise<PreparedSummary> {
    const source = parseCaptureSummary(value);
    const detached = copyCandidate(input);
    const captured = await staticCaptures.read(source);
    const candidate = await verifyPreparedCandidate(detached, captured.source);
    if (!current()) throw new Error("Preparation dismissed; no candidate was saved");
    onCommit?.();
    const saved = parsePreparedSummary(await invoke<unknown>("intake_prepared_save", { sourceId: source.id, expectedCaptureHash: source.captureHash, candidateJson: JSON.stringify(candidate) }));
    if (saved.id !== candidate.candidateId || saved.outputHash !== candidate.outputHash || saved.recipeHash !== candidate.recipeHash || saved.source.captureHash !== source.captureHash) throw new Error("Prepared save couldn't be confirmed. Reload candidates before retrying");
    return saved;
  },
  async read(value: PreparedSummary): Promise<PreparedReview> {
    const expected = parsePreparedSummary(value);
    const raw = exactData(await invoke<unknown>("intake_prepared_read", { id: expected.id, expectedOutputHash: expected.outputHash }), ["schemaVersion", "source", "createdAt", "candidate"]);
    const source = parseCaptureSummary(raw.source);
    if (raw.schemaVersion !== 1 || raw.createdAt !== expected.createdAt || source.captureHash !== expected.source.captureHash || source.id !== expected.source.id) throw new Error("Prepared source selection changed; reload");
    const detached = copyCandidate(raw.candidate);
    const captured = await staticCaptures.read(source), candidate = await verifyPreparedCandidate(detached, captured.source);
    if (candidate.candidateId !== expected.id || candidate.outputHash !== expected.outputHash || candidate.recipeHash !== expected.recipeHash) throw new Error("Prepared candidate changed; reload review");
    return { summary: expected, candidate };
  },
  async discard(value: PreparedSummary): Promise<void> {
    const s = parsePreparedSummary(value);
    await invoke("intake_prepared_discard", { id: s.id, expectedOutputHash: s.outputHash });
  },
};
