import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readGlb, writeGlb } from "./lib/companion-fingers.mjs";
import { handTransfer } from "./lib/companion-hand-retarget.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const input = path.join(root, "scripts/characters-src/companion-finger-repair-2026-10-12");
const output = path.resolve(root, process.argv[2] ?? "scripts/characters-src/companion-texting-repair-2026-10-13");
const index = JSON.parse(await readFile(path.join(input, "all-six-companions-index.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(input, "manifest.json"), "utf8"));
const donorBytes = await readFile(path.join(root, "scripts/characters-src/mixamo-companion-library-2026-10-12/sources/motions/119340901-texting-while-standing.fbx"));
const buffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const loader = new GLTFLoader();
loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new THREE.Texture() }));
const report = [];
await mkdir(path.join(output, "runtime"), { recursive: true });
for (const entry of index.characters) {
  const bytes = await readFile(path.resolve(input, entry.model));
  if (hash(bytes) !== entry.sha256) throw new Error(`Source changed: ${entry.id}`);
  const gltf = await loader.parseAsync(buffer(bytes), "");
  const source = new FBXLoader().parse(buffer(donorBytes), "");
  const transfer = handTransfer(gltf.scene, source);
  const clip = gltf.animations.find((clip) => clip.name === "Texting While Standing");
  const targetMixer = new THREE.AnimationMixer(gltf.scene);
  const sourceMixer = new THREE.AnimationMixer(source);
  for (const [mixer, animation] of [[targetMixer, clip], [sourceMixer, source.animations[0]]]) {
    const action = mixer.clipAction(animation); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  }
  const tracks = new Map(clip.tracks.map((track) => [track.name, track]));
  const times = tracks.get(`${transfer.bones[0].name}.quaternion`).times;
  const animatedBones = transfer.bones.filter((bone) => tracks.has(`${bone.name}.quaternion`));
  const values = new Map(animatedBones.map((bone) => [bone.name, new Float32Array(times.length * 4)]));
  const armTracks = transfer.arms.map((bone) => ({ bone, sample: tracks.get(`${bone.name}.quaternion`).InterpolantFactoryMethodLinear() }));
  const previous = new Map();
  for (let i = 0; i < times.length; i++) {
    targetMixer.setTime(times[i]); sourceMixer.setTime(times[i]);
    // Constant mixer tracks can skip writes; reset the authored arm before each independent IK sample.
    for (const { bone, sample } of armTracks) bone.quaternion.fromArray(sample.evaluate(times[i]));
    transfer.apply();
    for (const bone of animatedBones) {
      const q = bone.quaternion.clone();
      if (previous.get(bone.name)?.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      q.toArray(values.get(bone.name), i * 4); previous.set(bone.name, q);
    }
  }
  targetMixer.stopAllAction(); sourceMixer.stopAllAction();
  const { doc, binary } = readGlb(bytes);
  const animation = doc.animations.find((animation) => animation.name === clip.name);
  const chunks = [binary];
  let length = binary.length;
  const accessor = (array, type, count) => {
    const padding = Buffer.alloc((-length) & 3); chunks.push(padding); length += padding.length;
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const view = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    chunks.push(bytes); length += bytes.length;
    const index = doc.accessors.length;
    doc.accessors.push({ bufferView: view, componentType: 5126, count, type });
    return index;
  };
  const inputAccessor = accessor(times, "SCALAR", times.length);
  doc.accessors[inputAccessor].min = [times[0]];
  doc.accessors[inputAccessor].max = [times[times.length - 1]];
  let changed = 0;
  for (const channel of animation.channels) {
    if (channel.target.path !== "rotation") continue;
    const outputValues = values.get(THREE.PropertyBinding.sanitizeNodeName(doc.nodes[channel.target.node].name));
    if (!outputValues) continue;
    channel.sampler = animation.samplers.length;
    animation.samplers.push({ input: inputAccessor, output: accessor(outputValues, "VEC4", times.length), interpolation: "LINEAR" });
    changed++;
  }
  if (changed !== animatedBones.length) throw new Error(`Missing hand tracks: ${entry.id}`);
  const repaired = writeGlb(doc, Buffer.concat(chunks));
  entry.model = `runtime/${entry.id}.glb`; entry.manifest = "manifest.json"; entry.sha256 = hash(repaired);
  for (const key of ["originalAuthoringBlend"]) if (entry[key]) entry[key] = path.relative(output, path.resolve(input, entry[key]));
  await writeFile(path.join(output, entry.model), repaired);
  const character = manifest.characters.find((character) => character.id === entry.id);
  character.model = entry.model; character.sha256 = entry.sha256; character.bytes = repaired.length;
  if (character.originalAuthoringBlend) character.originalAuthoringBlend = path.relative(output, path.resolve(input, character.originalAuthoringBlend));
  character.textingRetarget = { method: "source-anatomical-hand-frame-v2", rotationChannels: changed, fullFingerRig: transfer.fullFingerRig };
  report.push({ id: entry.id, sourceSha256: hash(bytes), sha256: entry.sha256, changedRotationChannels: changed, samples: times.length, scope: "Texting arms, wrists and fingers only" });
  console.log(entry.id, changed, "Texting arm/hand channels repaired");
}
index.status = "texting-hand-frame-repaired";
if (index.blenderPreview) index.blenderPreview = path.relative(output, path.resolve(input, index.blenderPreview));
await writeFile(path.join(output, "all-six-companions-index.json"), JSON.stringify(index, null, 2) + "\n");
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(path.join(output, "repair-report.json"), JSON.stringify(report, null, 2) + "\n");
