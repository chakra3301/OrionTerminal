import { createHash } from "node:crypto";
import { readFile, writeFile, copyFile, mkdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const indexPath = process.argv[2] ?? "scripts/characters-src/mixamo-companion-final-character-2026-10-12/all-six-companions-index.json";
const indexFile = path.resolve(root, indexPath);
const bundle = path.dirname(indexFile);
const index = JSON.parse(await readFile(indexFile, "utf8"));
if (index.characterCount !== 6 || index.motionCountPerCharacter !== 20) throw new Error("Expected six companions with twenty clips each");
const out = path.join(root, "public/characters");
await mkdir(out, { recursive: true });
const manifest = { schemaVersion: 1, defaultCharacter: "anthropomorphic-fox", defaultAnimation: "Sad Idle", fps: 30, upAxis: "+Y", forwardAxis: "+Z", units: "meters", characters: [] };
const validated = [];

for (const entry of index.characters) {
  if (!/^[a-z0-9-]+$/.test(entry.id)) throw new Error(`Invalid character ID: ${entry.id}`);
  const source = path.resolve(bundle, entry.model);
  const data = await readFile(source);
  const hash = createHash("sha256").update(data).digest("hex");
  if (hash !== entry.sha256) throw new Error(`Source hash mismatch: ${entry.id}`);
  const doc = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString("utf8"));
  const sourceManifest = JSON.parse(await readFile(path.resolve(bundle, entry.manifest), "utf8"));
  const character = sourceManifest.characters.find((item) => item.id === entry.id);
  if (!character || doc.animations?.length !== 20 || doc.meshes?.length !== 1 || doc.skins?.length !== 1) throw new Error(`Invalid prepared asset: ${entry.id}`);
  if (JSON.stringify(doc.animations.map((clip) => clip.name)) !== JSON.stringify(character.animations.map((clip) => clip.name))) throw new Error(`Animation names differ: ${entry.id}`);
  validated.push({ source, destination: path.join(out, `${entry.id}.glb`) });
  manifest.characters.push({ id: entry.id, name: entry.name, model: `/characters/${entry.id}.glb`, sha256: hash, bytes: data.length, boneCount: character.boneCount, weightedBoneGroups: character.weightedBoneGroups, animationCount: 20, sourceFilename: character.sourceFilename, rigSource: character.rigSource, animations: character.animations });
}

for (const { source, destination } of validated) {
  await copyFile(source, destination + ".tmp");
  await rename(destination + ".tmp", destination);
}
const manifestPath = path.join(out, "manifest.json");
await writeFile(manifestPath + ".tmp", JSON.stringify(manifest, null, 2) + "\n");
await rename(manifestPath + ".tmp", manifestPath);
console.log(`Installed ${manifest.characters.length} verified companions with 20 animations each`);
