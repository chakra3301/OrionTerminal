import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";
import { readGlb, writeGlb } from "./lib/companion-fingers.mjs";
import { bindTransforms, handFrame, handTransfer } from "./lib/companion-hand-retarget.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = path.join(root, "scripts/characters-src/rosie-companion-2026-10-13");
const motions = path.join(root, "scripts/characters-src/mixamo-companion-library-2026-10-12");
const catalog = JSON.parse(await readFile(path.join(motions, "sources/motion-catalog.json"), "utf8"));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(path.join(bundle, "exports/rosie-animations.glb"));
await document.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [2048, 2048], quality: 90 }));
const bytes = Buffer.from(await io.writeBinary(document));
const buffer = (data) => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const loader = new GLTFLoader();
loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new THREE.Texture() }));
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
const report = [];
const openingClips = new Set(["Clapping", "Sitting Clap"]);
const contactClips = new Set([...openingClips, "Texting While Standing"]);
for (const clip of gltf.animations) {
  for (const { bone, rotation, position, scale } of rest) {
    bone.quaternion.copy(rotation); bone.position.copy(position); bone.scale.copy(scale);
  }
  gltf.scene.updateMatrixWorld(true);
  const motion = catalog.motions.find((motion) => motion.name === clip.name);
  const donor = await readFile(clip.name === "Angry" ? path.join(bundle, "sources/angry.fbx") : path.join(motions, motion.file));
  const source = new FBXLoader().parse(buffer(donor), "");
  const contact = contactClips.has(clip.name);
  const opening = openingClips.has(clip.name);
  const sourceMixer = new THREE.AnimationMixer(source);
  const sourceAction = sourceMixer.clipAction(source.animations[0]);
  sourceAction.setLoop(THREE.LoopOnce, 1); sourceAction.clampWhenFinished = true; sourceAction.play();
  const palms = ["l", "r"].map((side) => handFrame(bindTransforms(gltf.scene), side, "thumb"));
  const donorPalms = ["l", "r"].map((side) => handFrame(bindTransforms(source), side, "thumb"));
  const span = () => donorPalms[0].wrist.getWorldPosition(new THREE.Vector3())
    .distanceTo(donorPalms[1].wrist.getWorldPosition(new THREE.Vector3()));
  let closed = Infinity, opened = -Infinity;
  if (opening) {
    for (let time = 0; time <= source.animations[0].duration; time += 1 / 60) {
      sourceMixer.setTime(time); source.updateMatrixWorld(true);
      const value = span(); closed = Math.min(closed, value); opened = Math.max(opened, value);
    }
    sourceMixer.stopAllAction();
    sourceAction.reset().play();
    source.updateMatrixWorld(true);
  }
  // Closed mitts need the donor's opening stroke added beyond their surface contact distance.
  const openingDistance = palms.reduce((sum, palm) => sum + palm.palmLength, 0) * .75;
  const transfer = handTransfer(gltf.scene, source, {
    matchGripSpacing: contact || clip.name === "Texting While Standing",
    continuousElbows: contact, limitContact: contact,
    contactOpening: opening ? () => THREE.MathUtils.clamp((span() - closed) / Math.max(1e-6, opened - closed), 0, 1) * openingDistance : undefined,
  });
  const targetMixer = new THREE.AnimationMixer(gltf.scene);
  for (const [mixer, animation] of [[targetMixer, clip]]) {
    const action = mixer.clipAction(animation); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  }
  const tracks = new Map(clip.tracks.map((track) => [track.name, track]));
  const animated = transfer.bones.filter((bone) => tracks.has(`${bone.name}.quaternion`));
  const times = contact
    ? Float32Array.from({ length: Math.ceil(clip.duration * 60) + 1 }, (_, index) => Math.min(clip.duration, index / 60))
    : tracks.get(`${animated[0].name}.quaternion`).times;
  const values = new Map(animated.map((bone) => [bone.name, new Float32Array(times.length * 4)]));
  const armTracks = transfer.arms.map((bone) => ({ bone, sample: tracks.get(`${bone.name}.quaternion`).InterpolantFactoryMethodLinear() }));
  const previous = new Map();
  for (let index = 0; index < times.length; index++) {
    targetMixer.setTime(times[index]); sourceMixer.setTime(Math.min(times[index], source.animations[0].duration));
    for (const { bone, sample } of armTracks) bone.quaternion.fromArray(sample.evaluate(times[index]));
    transfer.apply();
    for (const bone of animated) {
      const q = bone.quaternion.clone();
      if (previous.get(bone.name)?.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      q.toArray(values.get(bone.name), index * 4); previous.set(bone.name, q);
    }
  }
  targetMixer.stopAllAction(); sourceMixer.stopAllAction();
  targetMixer.uncacheRoot(gltf.scene); sourceMixer.uncacheRoot(source);
  const animation = doc.animations.find((animation) => animation.name === clip.name);
  const input = append(times, "SCALAR", times.length);
  doc.accessors[input].min = [times[0]]; doc.accessors[input].max = [times[times.length - 1]];
  let changed = 0;
  for (const channel of animation.channels) {
    if (channel.target.path !== "rotation") continue;
    const output = values.get(THREE.PropertyBinding.sanitizeNodeName(doc.nodes[channel.target.node].name));
    if (!output) continue;
    channel.sampler = animation.samplers.length;
    animation.samplers.push({ input, output: append(output, "VEC4", times.length), interpolation: "LINEAR" });
    changed++;
  }
  if (changed !== animated.length) throw new Error(`Missing Rosie hand channels: ${clip.name}`);
  report.push({ name: clip.name, rotationChannels: changed, samples: times.length,
    contactSurfaceCounts: transfer.contact?.counts ?? null, fullFingerRig: transfer.fullFingerRig });
  console.log("ROSIE_HANDS_READY", clip.name);
}
const repaired = writeGlb(doc, Buffer.concat(chunks));
const hash = (data) => createHash("sha256").update(data).digest("hex");
await writeFile(path.join(bundle, "exports/rosie-animations-repaired.glb"), repaired);
await writeFile(path.join(bundle, "reports/hand-repair.json"), JSON.stringify({
  inputSha256: hash(await readFile(path.join(bundle, "exports/rosie-animations.glb"))),
  outputSha256: hash(repaired), clips: report,
}, null, 2) + "\n");
