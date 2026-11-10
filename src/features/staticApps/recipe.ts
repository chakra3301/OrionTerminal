import declaration from "./recipe2048.json";
import { compareAscii, STATIC_RECIPE, STATIC_SOURCE_LIMIT, sourceKey } from "./contracts";
export type RecipeFile = Readonly<{ repository: string; commit: string; path: string; bytes: number; sha256: string; gitBlobSha: string; kind: "text" | "font"; packagePath: string; sourceMode?: "100644" | "100755" }>;
const safePath = (path: string) => path.length <= 240 && path.split("/").every((part) => /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== "..");
const files = declaration.files.map((file): RecipeFile => {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(file.repository) || !/^[a-f0-9]{40}$/.test(file.commit)
    || !safePath(file.path) || !safePath(file.packagePath) || !/^[a-f0-9]{64}$/.test(file.sha256) || !/^[a-f0-9]{40}$/.test(file.gitBlobSha)
    || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 128 * 1024 || !["text", "font"].includes(file.kind)
    || (file.sourceMode !== undefined && !["100644", "100755"].includes(file.sourceMode))) throw new Error("Invalid owned recipe declaration");
  return Object.freeze({ ...file, kind: file.kind as RecipeFile["kind"], sourceMode: file.sourceMode as RecipeFile["sourceMode"] });
}).sort((a, b) => compareAscii(sourceKey(a), sourceKey(b)));
if (declaration.version !== 1 || declaration.id !== STATIC_RECIPE || files.length !== 24 || new Set(files.map(sourceKey)).size !== files.length
  || new Set(files.map((f) => f.packagePath.toLowerCase())).size !== files.length || files.reduce((n, f) => n + f.bytes, 0) > STATIC_SOURCE_LIMIT) throw new Error("Inconsistent owned recipe declaration");
export const RECIPE_2048 = Object.freeze({ ...declaration, id: STATIC_RECIPE, files: Object.freeze(files), enginePaths: Object.freeze([...declaration.enginePaths]), excluded: Object.freeze([...declaration.excluded]), limitations: Object.freeze([...declaration.limitations]) });
