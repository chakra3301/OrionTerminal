import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, textureCompress, weld } from "@gltf-transform/functions";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = path.join(root, "scripts/characters-src/rosie-companion-2026-10-13");
const preparation = JSON.parse(await readFile(path.join(bundle, "reports/preparation.json"), "utf8"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const staticInput = path.join(bundle, "exports/rosie-static.glb");
if (hash(await readFile(staticInput)) !== preparation.staticSha256) throw new Error("Prepared Rosie export changed");
if (hash(await readFile(path.resolve(root, preparation.source))) !== preparation.sourceSha256) throw new Error("Fitted Rosie source changed; prepare it again");
const animatedInput = path.join(bundle, "exports/rosie-animations-repaired.glb");
const animatedBytes = await readFile(animatedInput);
const build = JSON.parse(await readFile(path.join(bundle, "reports/animation-build.json"), "utf8"));
const hands = JSON.parse(await readFile(path.join(bundle, "reports/hand-repair.json"), "utf8"));
if (build.preparedSha256 !== preparation.staticSha256
  || build.rigSha256 !== hash(await readFile(path.join(bundle, "sources/rosie-rigged.fbx")))
  || hands.inputSha256 !== hash(await readFile(path.join(bundle, "exports/rosie-animations.glb")))
  || hands.outputSha256 !== hash(animatedBytes)) throw new Error("Rosie animation bake is stale");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(animatedInput);
await document.transform(
  dedup(), prune(), weld(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [2048, 2048], quality: 90 }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }),
);
const bytes = await io.writeBinary(document);
const json = JSON.parse(Buffer.from(bytes).subarray(20, 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true)));
if (json.meshes?.length !== 1 || json.skins?.length !== 1 || json.animations?.length !== 20
  || JSON.stringify(json.animations.map((clip) => clip.name)) !== JSON.stringify(build.clips.map((clip) => clip.name))) throw new Error("Invalid Rosie mesh/rig/clip contract");
const weighted = new Set();
for (const mesh of document.getRoot().listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const joints = primitive.getAttribute("JOINTS_0")?.getArray();
    const weights = primitive.getAttribute("WEIGHTS_0")?.getArray();
    if (joints && weights) for (let index = 0; index < joints.length; index++) if (weights[index] > 0) weighted.add(joints[index]);
  }
}
const manifestPath = path.join(root, "public/characters/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const character = {
  id: "rosie-stylized", name: "Rosie", model: "/characters/rosie-stylized.glb",
  sha256: hash(bytes), bytes: bytes.length, boneCount: json.skins?.[0]?.joints.length ?? 0,
  weightedBoneGroups: weighted.size, animationCount: 20,
  animations: build.clips.map((clip) => ({ name: clip.name, motionId: clip.motionId, duration: clip.duration,
    frameRange: clip.frames, loopHint: clip.name === "Texting While Standing" || clip.name === "Sad Idle",
    needsPositioningReview: ["Kneeling Pointing", "Female Dynamic Pose", "Sitting Clap", "Falling"].includes(clip.name) })),
  sourceFilename: "rosie-stylized.glb",
  rigSource: "Local humanoid landmarks and Blender heat binding; unweighted glove landmarks",
  preparation: { sourceSha256: preparation.sourceSha256, sourceTriangles: preparation.sourceTriangles,
    triangles: preparation.triangles, textureSize: 2048, metallic: 0, roughness: 0.88 },
};
character.fingerRetarget = { method: "rigid-closed-gloves", independentFingerMotion: false };
character.textingRetarget = { method: "source-anatomical-hand-frame-v2", fullFingerRig: false,
  surfaceContact: true, rotationChannels: hands.clips.find((clip) => clip.name === "Texting While Standing").rotationChannels };
character.handRetarget = { method: "source-anatomical-hand-frame-v2", correctedClips: 19,
  acceptedTextingPreserved: true, contactSpacingClips: ["Clapping", "Sitting Clap"], sourceSpacingClips: ["Clapping", "Sitting Clap"] };
const previous = manifest.characters.findIndex((entry) => entry.id === character.id);
if (previous >= 0) manifest.characters[previous] = character;
else manifest.characters.push(character);
await mkdir(path.join(root, "public/characters"), { recursive: true });
const destination = path.join(root, "public", character.model.slice(1));
await writeFile(destination + ".tmp", bytes);
await rename(destination + ".tmp", destination);
await writeFile(manifestPath + ".tmp", JSON.stringify(manifest, null, 2) + "\n");
await rename(manifestPath + ".tmp", manifestPath);
console.log(`Installed Rosie: ${bytes.length} bytes, ${preparation.triangles} triangles; ${character.animationCount} clips`);
