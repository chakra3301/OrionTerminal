import * as THREE from "three";

const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const digits = ["thumb", "index", "middle", "ring", "pinky"];

export function fingerIdentity(name) {
  const local = /^(thumb|index|middle|ring|pinky)_0([123])_([lr])$/i.exec(name);
  if (local) return { digit: local[1].toLowerCase(), segment: Number(local[2]), side: local[3].toLowerCase() };
  const mixamo = /^mixamorig:?((?:Left|Right))Hand(Thumb|Index|Middle|Ring|Pinky)([1234])$/i.exec(name);
  return mixamo ? { digit: mixamo[2].toLowerCase(), segment: Number(mixamo[3]), side: mixamo[1].toLowerCase() === "left" ? "l" : "r" } : null;
}

function hand(bones, side) {
  const name = side === "l" ? "mixamorigLeftHand" : "mixamorigRightHand";
  return bones.find((bone) => normalize(bone.name) === normalize(name) || bone.name === `hand_${side}`);
}

function finger(bones, side, digit, segment) {
  return bones.find((bone) => {
    const id = fingerIdentity(bone.name);
    return id?.side === side && id.digit === digit && id.segment === segment;
  });
}

function palmNormal(bones, side, secondDigit) {
  const wrist = hand(bones, side).getWorldPosition(new THREE.Vector3());
  const first = finger(bones, side, "index", 1).getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
  const second = finger(bones, side, secondDigit, 1).getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
  const normal = first.cross(second);
  if (normal.lengthSq() < 1e-12) throw new Error(`Degenerate ${side} palm`);
  return normal.normalize();
}

function jointFrame(bone, normal) {
  const id = fingerIdentity(bone.name);
  const child = bone.children.find((child) => {
    const next = fingerIdentity(child.name);
    return next?.side === id.side && next.digit === id.digit && next.segment === id.segment + 1;
  });
  const position = bone.getWorldPosition(new THREE.Vector3());
  const direction = child
    ? child.getWorldPosition(new THREE.Vector3()).sub(position)
    : position.sub(bone.parent.getWorldPosition(new THREE.Vector3()));
  const x = direction.normalize();
  const z = normal.clone().addScaledVector(x, -normal.dot(x)).normalize();
  const y = z.clone().cross(x).normalize();
  if (x.lengthSq() < 0.99 || z.lengthSq() < 0.99) throw new Error(`Degenerate finger frame: ${bone.name}`);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function fingerCorrections(targetBones, sourceBones) {
  const corrections = new Map();
  for (const side of ["l", "r"]) {
    if (!hand(targetBones, side) || !finger(targetBones, side, "index", 1) || !finger(targetBones, side, "pinky", 1)) continue;
    const targetNormal = palmNormal(targetBones, side, "pinky");
    const sourceNormal = palmNormal(sourceBones, side, "pinky");
    for (const digit of digits) for (let segment = 1; segment <= 4; segment++) {
      const target = finger(targetBones, side, digit, segment);
      const source = finger(sourceBones, side, digit, segment);
      if (!target || !source) continue;
      const alignment = jointFrame(target, targetNormal).multiply(jointFrame(source, sourceNormal).invert());
      const parent = target.parent.getWorldQuaternion(new THREE.Quaternion());
      corrections.set(normalize(target.name), {
        alignment: parent.clone().invert().multiply(alignment).multiply(parent),
        rest: target.quaternion.clone(),
      });
    }
  }
  return corrections;
}

export function remapFingerRotation(rotation, { alignment, rest }) {
  // Move the bend axis into the character's palm frame while preserving its bind pose and bend amount.
  return alignment.clone().multiply(rotation.clone().multiply(rest.clone().invert()))
    .multiply(alignment.clone().invert()).multiply(rest).normalize();
}

export function readGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error("Expected GLB 2");
  const jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binaryStart = 20 + jsonLength + 8;
  return { doc, binary: Buffer.from(bytes.subarray(binaryStart, binaryStart + bytes.readUInt32LE(binaryStart - 8))) };
}

function writeGlb(doc, binary) {
  doc.buffers[0].byteLength = binary.length;
  const json = Buffer.from(JSON.stringify(doc));
  const jsonPadding = Buffer.alloc((-json.length) & 3, 0x20);
  const binaryPadding = Buffer.alloc((-binary.length) & 3);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + jsonPadding.length + binary.length + binaryPadding.length, 8);
  header.writeUInt32LE(json.length + jsonPadding.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length + binaryPadding.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, jsonPadding, binHeader, binary, binaryPadding]);
}

export function repairFingerChannels(bytes, corrections) {
  if (!corrections.size) return { bytes: Buffer.from(bytes), channels: 0 };
  const { doc, binary } = readGlb(bytes);
  const original = Buffer.from(binary);
  const usage = new Map();
  const samplerUsage = new Map();
  for (const animation of doc.animations) for (const channel of animation.channels) {
    const sampler = animation.samplers[channel.sampler];
    usage.set(sampler.output, (usage.get(sampler.output) ?? 0) + 1);
    samplerUsage.set(sampler, (samplerUsage.get(sampler) ?? 0) + 1);
  }
  const extras = [];
  let binaryLength = binary.length;
  let channels = 0;
  for (const animation of doc.animations) for (const channel of animation.channels) {
    if (channel.target.path !== "rotation") continue;
    const correction = corrections.get(normalize(doc.nodes[channel.target.node].name));
    if (!correction) continue;
    let sampler = animation.samplers[channel.sampler];
    if (samplerUsage.get(sampler) > 1) {
      sampler = { ...sampler };
      channel.sampler = animation.samplers.length;
      animation.samplers.push(sampler);
    }
    if (!["LINEAR", "STEP"].includes(sampler.interpolation ?? "LINEAR")) throw new Error("Finger repair expects sampled rotation keys");
    const accessor = doc.accessors[sampler.output];
    if (accessor.componentType !== 5126 || accessor.type !== "VEC4" || accessor.sparse) throw new Error("Expected float quaternion keys");
    const view = doc.bufferViews[accessor.bufferView];
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? 16;
    const output = Buffer.alloc(accessor.count * 16);
    let previous;
    for (let i = 0; i < accessor.count; i++) {
      const q = new THREE.Quaternion(...Array.from({ length: 4 }, (_, k) => original.readFloatLE(offset + i * stride + k * 4)));
      const repaired = remapFingerRotation(q, correction);
      if (previous && repaired.dot(previous) < 0) repaired.set(-repaired.x, -repaired.y, -repaired.z, -repaired.w);
      repaired.toArray().forEach((value, k) => output.writeFloatLE(value, i * 16 + k * 4));
      previous = repaired;
    }
    if (usage.get(sampler.output) === 1) {
      for (let i = 0; i < accessor.count; i++) output.copy(binary, offset + i * stride, i * 16, i * 16 + 16);
      delete accessor.min; delete accessor.max;
    } else {
      const padding = Buffer.alloc((-binaryLength) & 3);
      extras.push(padding, output); binaryLength += padding.length;
      const bufferView = doc.bufferViews.length;
      doc.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: output.length });
      const newAccessor = { ...accessor, bufferView, byteOffset: 0 };
      delete newAccessor.min; delete newAccessor.max;
      sampler.output = doc.accessors.length; doc.accessors.push(newAccessor);
      binaryLength += output.length;
    }
    channels++;
  }
  return { bytes: writeGlb(doc, Buffer.concat([binary, ...extras])), channels };
}
