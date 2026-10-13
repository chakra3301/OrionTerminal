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
const input = path.join(root, "scripts/characters-src/companion-texting-repair-2026-10-13");
const output = path.resolve(root, process.argv[2] ?? "scripts/characters-src/companion-hand-library-2026-10-13");
const motionFolder = path.join(root, "scripts/characters-src/mixamo-companion-library-2026-10-12");
const index = JSON.parse(await readFile(path.join(input, "all-six-companions-index.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(input, "manifest.json"), "utf8"));
const catalog = JSON.parse(await readFile(path.join(motionFolder, "sources/motion-catalog.json"), "utf8"));
const contactClips = new Set(["Clapping", "Sitting Clap", "Angry"]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const buffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const loader = new GLTFLoader();
loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new THREE.Texture() }));
const donors = new Map();
for (const motion of catalog.motions) {
  if (motion.name !== "Texting While Standing") donors.set(motion.name, await readFile(path.join(motionFolder, motion.file)));
}
const report = [];
await mkdir(path.join(output, "runtime"), { recursive: true });

for (const entry of index.characters) {
  const bytes = await readFile(path.resolve(input, entry.model));
  if (hash(bytes) !== entry.sha256) throw new Error(`Source changed: ${entry.id}`);
  const gltf = await loader.parseAsync(buffer(bytes), "");
  const rest = [];
  gltf.scene.traverse((bone) => {
    if (bone.isBone) rest.push({ bone, rotation: bone.quaternion.clone(), position: bone.position.clone(), scale: bone.scale.clone() });
  });
  const { doc, binary } = readGlb(bytes);
  const chunks = [binary];
  let length = binary.length;
  const append = (array, type, count) => {
    const padding = Buffer.alloc((-length) & 3); chunks.push(padding); length += padding.length;
    const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const view = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length });
    chunks.push(data); length += data.length;
    const accessor = doc.accessors.length;
    doc.accessors.push({ bufferView: view, componentType: 5126, count, type });
    return accessor;
  };
  const characterReport = { id: entry.id, sourceSha256: hash(bytes), clips: [] };
  for (const clip of gltf.animations) {
    if (clip.name === "Texting While Standing") continue;
    for (const { bone, rotation, position, scale } of rest) {
      bone.quaternion.copy(rotation); bone.position.copy(position); bone.scale.copy(scale);
    }
    gltf.scene.updateMatrixWorld(true);
    const source = new FBXLoader().parse(buffer(donors.get(clip.name)), "");
    const matchGripSpacing = contactClips.has(clip.name) && entry.id !== "horned-demon";
    const transfer = handTransfer(gltf.scene, source, { matchGripSpacing, continuousElbows: true, limitContact: contactClips.has(clip.name) });
    const targetMixer = new THREE.AnimationMixer(gltf.scene), sourceMixer = new THREE.AnimationMixer(source);
    for (const [mixer, animation] of [[targetMixer, clip], [sourceMixer, source.animations[0]]]) {
      const action = mixer.clipAction(animation); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    }
    const tracks = new Map(clip.tracks.map((track) => [track.name, track]));
    const animated = transfer.bones.filter((bone) => tracks.has(`${bone.name}.quaternion`));
    const times = transfer.contact
      ? Float32Array.from({ length: Math.ceil(clip.duration * 60) + 1 }, (_, index) => Math.min(clip.duration, index / 60))
      : tracks.get(`${animated[0].name}.quaternion`).times;
    const values = new Map(animated.map((bone) => [bone.name, new Float32Array(times.length * 4)]));
    const armTracks = transfer.arms.map((bone) => ({ bone, sample: tracks.get(`${bone.name}.quaternion`).InterpolantFactoryMethodLinear() }));
    const previous = new Map();
    for (let i = 0; i < times.length; i++) {
      targetMixer.setTime(times[i]); sourceMixer.setTime(Math.min(times[i], source.animations[0].duration));
      for (const { bone, sample } of armTracks) bone.quaternion.fromArray(sample.evaluate(times[i]));
      transfer.apply();
      for (const bone of animated) {
        const q = bone.quaternion.clone();
        if (previous.get(bone.name)?.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        q.toArray(values.get(bone.name), i * 4); previous.set(bone.name, q);
      }
    }
    targetMixer.stopAllAction(); sourceMixer.stopAllAction();
    targetMixer.uncacheRoot(gltf.scene); sourceMixer.uncacheRoot(source);
    const animation = doc.animations.find((animation) => animation.name === clip.name);
    const inputAccessor = append(times, "SCALAR", times.length);
    doc.accessors[inputAccessor].min = [times[0]];
    doc.accessors[inputAccessor].max = [times[times.length - 1]];
    let changed = 0;
    for (const channel of animation.channels) {
      if (channel.target.path !== "rotation") continue;
      const outputValues = values.get(THREE.PropertyBinding.sanitizeNodeName(doc.nodes[channel.target.node].name));
      if (!outputValues) continue;
      channel.sampler = animation.samplers.length;
      animation.samplers.push({ input: inputAccessor, output: append(outputValues, "VEC4", times.length), interpolation: "LINEAR" });
      changed++;
    }
    if (changed !== animated.length) throw new Error(`Missing hand channels: ${entry.id}/${clip.name}`);
    characterReport.clips.push({ name: clip.name, rotationChannels: changed, samples: times.length, matchGripSpacing, surfaceContact: transfer.contact?.counts ?? null });
  }
  const repaired = writeGlb(doc, Buffer.concat(chunks));
  entry.model = `runtime/${entry.id}.glb`; entry.manifest = "manifest.json"; entry.sha256 = hash(repaired);
  if (entry.originalAuthoringBlend) entry.originalAuthoringBlend = path.relative(output, path.resolve(input, entry.originalAuthoringBlend));
  await writeFile(path.join(output, entry.model), repaired);
  const character = manifest.characters.find((character) => character.id === entry.id);
  character.model = entry.model; character.sha256 = entry.sha256; character.bytes = repaired.length;
  if (character.originalAuthoringBlend) character.originalAuthoringBlend = path.relative(output, path.resolve(input, character.originalAuthoringBlend));
  character.handRetarget = { method: "source-anatomical-hand-frame-v2", correctedClips: 19, acceptedTextingPreserved: true, contactSpacingClips: [...contactClips], sourceSpacingClips: entry.id === "horned-demon" ? [] : [...contactClips] };
  characterReport.sha256 = entry.sha256;
  report.push(characterReport);
  console.log(entry.id, characterReport.clips.length, "gesture clips repaired");
}
index.status = "gesture-hand-frame-repaired";
if (index.blenderPreview) index.blenderPreview = path.relative(output, path.resolve(input, index.blenderPreview));
manifest.knownSourceIssues = [{ clip: "Angry", issue: "Cached source motion duplicates Sitting Clap; genuine Angry source replacement is still required" }];
await writeFile(path.join(output, "all-six-companions-index.json"), JSON.stringify(index, null, 2) + "\n");
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(path.join(output, "repair-report.json"), JSON.stringify(report, null, 2) + "\n");
