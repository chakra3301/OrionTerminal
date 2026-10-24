import controller from "./adapter2048/controller.js?raw";
import input from "./adapter2048/input.js?raw";
import boot from "./adapter2048/boot.js?raw";
import changes from "./changes2048.md?raw";
import appearance from "./appearance2048.md?raw";
import generatorCode from "./generator.ts?raw";
import templateCode from "./template.ts?raw";
import sourceCode from "./source.ts?raw";
import recipeCode from "./recipe.ts?raw";
import contractsCode from "./contracts.ts?raw";
import hashCode from "./hash.ts?raw";
import { validatePluginManifest } from "@/plugins/manifest";
import { compareAscii, dataList, exactData, preparationId, sourceKey, STATIC_OUTPUT_LIMIT, STATIC_RECIPE, type OutputFile, type PreparedCandidate, type ValidatedSource } from "./contracts";
import { RECIPE_2048 } from "./recipe";
import { decodeText, digest, encodeText, toBase64 } from "./hash";
import { sourceForPreparation } from "./source";
import { build2048Document, sassyLicense } from "./template";
const ADAPTERS = { "controller.js": controller, "input.js": input, "boot.js": boot };
const IMPLEMENTATION = { "generator.ts": generatorCode, "template.ts": templateCode, "source.ts": sourceCode, "recipe.ts": recipeCode, "contracts.ts": contractsCode, "hash.ts": hashCode, "CHANGES.md": changes, "APPEARANCE.md": appearance };
const jsonBytes = (value: unknown) => encodeText(JSON.stringify(value, null, 2) + "\n");

export async function prepareStaticCandidate(source: ValidatedSource, id: string): Promise<PreparedCandidate> {
  const candidateId = preparationId(id), bytesByKey = sourceForPreparation(source), payloads = new Map<string, Uint8Array>();
  const pluginId = `dev.orion.prepared2048.${candidateId.toLowerCase()}`;
  const get = (path: string): Uint8Array => {
    const spec = RECIPE_2048.files.find((f) => f.packagePath === path), bytes = spec && bytesByKey.get(sourceKey(spec));
    if (!bytes) throw new Error("Validated source snapshot is incomplete");
    return bytes;
  };
  const manifest = {
    id: pluginId, name: "2048 · Orion adaptation", version: "0.1.0", apiVersion: "1", engines: { orion: "*" }, publisher: "Orion local adaptation (not upstream)",
    entrypoints: { ui: "ui.html" }, activationEvents: ["onApp:game2048"], dependencies: {},
    contributes: { apps: [{ id: "game2048", name: "2048", description: "Local adaptation of original 2048; review before enabling", accent: "yellow", window: { title: "2048", subtitle: "Orion local adaptation", width: 680, height: 900 } }], commands: [{ id: "game2048.open", title: "Open 2048", app: "game2048", keywords: ["game", "2048"] }], views: [], settings: [], statusItems: [], fileHandlers: [], aiTools: [] }, permissions: ["storage.plugin"],
  };
  const parsed = validatePluginManifest(manifest);
  if (!parsed.ok) throw new Error(parsed.issues.join("\n"));
  const scripts = RECIPE_2048.enginePaths.map((path) => decodeText(get(`original/${path}`))).concat(Object.values(ADAPTERS));
  const document = build2048Document(get, scripts);
  payloads.set("orion-plugin.json", jsonBytes(manifest)); payloads.set("ui.html", encodeText(document));
  payloads.set("CHANGES.md", encodeText(changes)); payloads.set("APPEARANCE.md", encodeText(appearance));
  for (const spec of RECIPE_2048.files) payloads.set(spec.packagePath, new Uint8Array(get(spec.packagePath)));
  payloads.set("LICENSE-MIT-2048.txt", get("original/LICENSE.txt")); payloads.set("LICENSE-APACHE-CLEAR-SANS.txt", get("notices/intel-LICENSE.txt"));
  payloads.set("LICENSE-MIT-SASSY-MATH.txt", encodeText(sassyLicense(decodeText(get("notices/sassy-readme.md"))) + "\n"));
  const adapterHashes = await Promise.all(Object.entries(ADAPTERS).map(async ([path, text]) => {
    const bytes = encodeText(text); payloads.set(`adapter/${path}`, bytes);
    return { path: `adapter/${path}`, bytes: bytes.length, sha256: await digest(bytes) };
  }));
  const implementationHashes = await Promise.all(Object.entries(IMPLEMENTATION).map(async ([path, text]) => ({ path, sha256: await digest(encodeText(text)) })));
  const recipeHash = await digest(jsonBytes({ declaration: RECIPE_2048, implementationHashes, adapterHashes, appearancePolicy: "orion-appearance-v1/2048" }));
  const inventory = async () => Promise.all([...payloads].sort(([a], [b]) => compareAscii(a, b)).map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await digest(bytes) })));
  const beforeProvenance = await inventory();
  payloads.set("PROVENANCE.json", jsonBytes({ version: 1, recipeId: STATIC_RECIPE, recipeHash, candidateId, pluginId, sourceHash: source.sourceHash, sourceInventory: source.files, adapterHashes, implementationHashes, runtimeEnginePaths: RECIPE_2048.enginePaths, runtimeAdapterPaths: Object.keys(ADAPTERS), appearancePolicy: "orion-appearance-v1/2048", limitations: RECIPE_2048.limitations, excluded: RECIPE_2048.excluded, payloadBeforeProvenance: beforeProvenance, authority: "none; installation and enablement require separate review" }));
  const finalInventory = await inventory(), totalBytes = finalInventory.reduce((n, f) => n + f.bytes, 0);
  if (finalInventory.length !== 35 || totalBytes > STATIC_OUTPUT_LIMIT || finalInventory.some((f) => f.bytes < 1 || f.bytes > STATIC_OUTPUT_LIMIT)) throw new Error("Prepared candidate exceeds recipe bounds");
  const outputHash = await digest(jsonBytes({ version: 1, recipeId: STATIC_RECIPE, sourceHash: source.sourceHash, recipeHash, candidateId, pluginId, files: finalInventory }));
  const files = finalInventory.map((f): OutputFile => ({ ...f, dataBase64: toBase64(payloads.get(f.path)!) }));
  return { version: 1, recipeId: STATIC_RECIPE, candidateId, pluginId, sourceHash: source.sourceHash, recipeHash, outputHash, totalBytes, files };
}

export async function verifyPreparedCandidate(value: unknown, source: ValidatedSource): Promise<PreparedCandidate> {
  const r = exactData(value, ["version", "recipeId", "candidateId", "pluginId", "sourceHash", "recipeHash", "outputHash", "totalBytes", "files"]);
  if (r.version !== 1 || r.recipeId !== STATIC_RECIPE || typeof r.pluginId !== "string" || [r.sourceHash, r.recipeHash, r.outputHash].some((v) => typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v))
    || !Number.isSafeInteger(r.totalBytes) || (r.totalBytes as number) < 1 || (r.totalBytes as number) > STATIC_OUTPUT_LIMIT) throw new Error("Invalid prepared candidate; saved bytes were not changed");
  const candidateId = preparationId(r.candidateId);
  const files = dataList(r.files, 35).map((v): OutputFile => {
    const f = exactData(v, ["path", "bytes", "sha256", "dataBase64"]);
    if (typeof f.path !== "string" || f.path.length > 240 || typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(f.sha256)
      || !Number.isSafeInteger(f.bytes) || (f.bytes as number) < 1 || (f.bytes as number) > STATIC_OUTPUT_LIMIT || typeof f.dataBase64 !== "string" || f.dataBase64.length !== 4 * Math.ceil((f.bytes as number) / 3)) throw new Error("Invalid candidate file bounds");
    return { path: f.path, bytes: f.bytes as number, sha256: f.sha256, dataBase64: f.dataBase64 };
  });
  if (files.length !== 35 || files.reduce((n, f) => n + f.bytes, 0) !== r.totalBytes) throw new Error("Inconsistent candidate inventory or aggregate bounds");
  const detached = { version: 1, recipeId: STATIC_RECIPE, candidateId, pluginId: r.pluginId, sourceHash: r.sourceHash, recipeHash: r.recipeHash, outputHash: r.outputHash, totalBytes: r.totalBytes, files };
  const regenerated = await prepareStaticCandidate(source, candidateId);
  // Provenance is evidence, not authority: verify every byte against the known recipe.
  if (JSON.stringify(detached) !== JSON.stringify(regenerated)) throw new Error("Candidate source, recipe, identity or bytes changed; prepare and review again");
  return regenerated;
}
