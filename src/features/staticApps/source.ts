import { dataList, exactData, sourceKey, STATIC_RECIPE, type SourceFile, type SourceEvidence, type ValidatedSource } from "./contracts";
import { RECIPE_2048 } from "./recipe";
import { decodeText, digest, encodeText, fromBase64, gitBlobDigest } from "./hash";
const validated = new WeakMap<ValidatedSource, ReadonlyMap<string, Uint8Array>>();

export async function validateStaticSource(value: unknown): Promise<ValidatedSource> {
  const packet = exactData(value, ["version", "recipeId", "files"]);
  if (packet.version !== 1 || packet.recipeId !== STATIC_RECIPE) throw new Error("Unsupported source or preparation version; no candidate was created");
  const entries = dataList(packet.files, RECIPE_2048.files.length);
  if (entries.length !== RECIPE_2048.files.length) throw new Error("The complete pinned recipe source and notices are required");
  const catalog = new Map(RECIPE_2048.files.map((f) => [sourceKey(f), f])), seen = new Set<string>();
  // Copy before the first await so caller mutation cannot change the reviewed source.
  const captured = entries.map((value) => {
    const r = exactData(value, ["repository", "commit", "path", "sourceMode", "dataBase64"]);
    if (typeof r.repository !== "string" || r.repository.length > 128 || typeof r.commit !== "string" || r.commit.length !== 40 || typeof r.path !== "string" || r.path.length > 240 || !["100644", "100755"].includes(r.sourceMode as string)) throw new Error("Unsupported source identity or file mode");
    const file = r as SourceFile, key = sourceKey(file), spec = catalog.get(key);
    if (!spec || seen.has(key)) throw new Error("Unknown, duplicate or unpinned source; only the declared 2048 recipe is supported");
    if (spec.sourceMode !== undefined && file.sourceMode !== spec.sourceMode) throw new Error("Pinned source mode changed");
    seen.add(key);
    const bytes = fromBase64(file.dataBase64, spec.bytes);
    if (spec.kind === "text") decodeText(bytes);
    return { spec, sourceMode: file.sourceMode, bytes };
  });
  const inventory: SourceEvidence[] = [], bytesByKey = new Map<string, Uint8Array>();
  for (const { spec, sourceMode, bytes } of captured) {
    const [sha256, gitBlobSha] = await Promise.all([digest(bytes), gitBlobDigest(bytes)]);
    if (sha256 !== spec.sha256 || gitBlobSha !== spec.gitBlobSha) throw new Error(`Pinned source bytes changed: ${sourceKey(spec)}; no candidate was created`);
    inventory.push({ repository: spec.repository, commit: spec.commit, path: spec.path, sourceMode, bytes: bytes.length, sha256, gitBlobSha, packagePath: spec.packagePath });
    bytesByKey.set(sourceKey(spec), bytes);
  }
  inventory.sort((a, b) => sourceKey(a) < sourceKey(b) ? -1 : sourceKey(a) > sourceKey(b) ? 1 : 0);
  const totalBytes = inventory.reduce((n, f) => n + f.bytes, 0);
  const sourceHash = await digest(encodeText(JSON.stringify({ version: 1, recipeId: STATIC_RECIPE, files: inventory })));
  const result: ValidatedSource = Object.freeze({ version: 1, recipeId: STATIC_RECIPE, sourceHash, totalBytes, files: Object.freeze(inventory.map((f) => Object.freeze(f))) });
  validated.set(result, bytesByKey);
  return result;
}
export function sourceForPreparation(source: ValidatedSource): ReadonlyMap<string, Uint8Array> {
  const bytes = validated.get(source);
  if (!bytes) throw new Error("Validate the exact captured source again before preparation");
  return new Map([...bytes].map(([key, value]) => [key, new Uint8Array(value)]));
}
