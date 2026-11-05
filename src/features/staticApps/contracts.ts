export const STATIC_RECIPE = "2048-classic-v1";
export const STATIC_SOURCE_LIMIT = 256 * 1024;
export const STATIC_OUTPUT_LIMIT = 2 * 1024 * 1024;
export type SourceMode = "100644" | "100755";
export type SourceFile = { repository: string; commit: string; path: string; sourceMode: SourceMode; dataBase64: string };
export type SourcePacket = { version: 1; recipeId: typeof STATIC_RECIPE; files: SourceFile[] };
export type SourceEvidence = Omit<SourceFile, "dataBase64"> & { bytes: number; sha256: string; gitBlobSha: string; packagePath: string };
export type ValidatedSource = Readonly<{ version: 1; recipeId: typeof STATIC_RECIPE; sourceHash: string; totalBytes: number; files: readonly Readonly<SourceEvidence>[] }>;
export type OutputFile = { path: string; bytes: number; sha256: string; dataBase64: string };
export type PreparedCandidate = { version: 1; recipeId: typeof STATIC_RECIPE; candidateId: string; pluginId: string; sourceHash: string; recipeHash: string; outputHash: string; totalBytes: number; files: OutputFile[] };

export function exactData(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Invalid preparation record");
  const d = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(d).length !== keys.length || keys.some((key) => !Object.hasOwn(d, key) || !Object.hasOwn(d[key]!, "value"))) throw new Error("Unsupported preparation fields or accessors");
  return Object.fromEntries(keys.map((key) => [key, d[key]!.value]));
}
export function dataList(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid preparation list");
  const d = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>, length = d.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > max || Reflect.ownKeys(d).length !== length + 1) throw new Error("Preparation list exceeds bounds or has unsupported properties");
  return Array.from({ length }, (_, i) => {
    const item = d[String(i)];
    if (!item || !Object.hasOwn(item, "value")) throw new Error("Sparse or accessor preparation list");
    return item.value;
  });
}
export function preparationId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value)) throw new Error("A fresh host-generated preparation ID is required");
  return value;
}
export function sourceKey(file: Pick<SourceFile, "repository" | "commit" | "path">): string { return `${file.repository}@${file.commit}/${file.path}`; }
export function compareAscii(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
