// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AnimationClip, AnimationMixer, Bone, Group, Object3D, PropertyBinding,
  QuaternionKeyframeTrack, Texture, Vector3, VectorKeyframeTrack,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ROSIE_BODY_NAMES, RosieBodySprings, withoutBakedRosieBody } from "./RosieBodySprings";
import { DEFAULT_ROSIE_SPRINGS, sanitizeRosieSprings } from "./rosieSpringSettings";

function syntheticRig(sanitized = false) {
  const scene = new Group();
  const root = new Group();
  const rigid = new Bone();
  rigid.name = "DEF-spine";
  rigid.position.set(0.01, 0.4, 0.02);
  rigid.rotation.set(0.15, -0.2, 0.1);
  root.add(rigid);
  scene.add(root);
  for (const [index, name] of ROSIE_BODY_NAMES.entries()) {
    const parent = new Bone();
    parent.name = `parent-${index}`;
    parent.position.set(0, 0.3 + index * 0.05, 0);
    const soft = new Bone();
    soft.name = sanitized ? PropertyBinding.sanitizeNodeName(name) : name;
    soft.position.set(index % 2 ? -0.03 : 0.03, 0.04, 0.015);
    soft.rotation.set(0.1, 0.2, 0.3);
    soft.scale.set(1, 1.01, 0.99);
    parent.add(soft);
    root.add(parent);
  }
  return { scene, root, rigid, springs: new RosieBodySprings(scene) };
}

function prime(springs: RosieBodySprings, dt = 1 / 60, screen?: Vector3) {
  springs.update(dt, { ...DEFAULT_ROSIE_SPRINGS }, screen);
  springs.update(dt, { ...DEFAULT_ROSIE_SPRINGS }, screen);
}

function excite(rig: ReturnType<typeof syntheticRig>, dt = 1 / 60) {
  prime(rig.springs, dt);
  rig.root.position.x += 0.015;
  rig.springs.update(dt);
}

function expectRest(springs: RosieBodySprings) {
  for (const body of springs.bodies) {
    expect(body.bone.position.distanceTo(body.rest)).toBeLessThan(1e-10);
    expect(body.bone.quaternion.toArray()).toEqual(body.rotation.toArray());
    expect(body.bone.scale.toArray()).toEqual(body.scale.toArray());
    expect(body.offset.length()).toBe(0);
    expect(body.velocity.length()).toBe(0);
  }
}

function expectBounded(springs: RosieBodySprings) {
  for (const body of springs.bodies) {
    const scale = Math.max(...body.parentScale.toArray().map(Math.abs), 0.0001);
    for (const value of [...body.bone.position.toArray(), ...body.velocity.toArray()]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(body.offset.length()).toBeLessThanOrEqual(body.maxOffset * scale + 1e-10);
  }
}

describe("RosieBodySprings synthetic rigs", () => {
  it.each([false, true])("binds all six soft bones with sanitized names=%s", (sanitized) => {
    const { springs } = syntheticRig(sanitized);
    expect(springs.bodies).toHaveLength(6);
    expect(springs.bodies.map((body) => body.region)).toEqual([
      "chest", "chest", "glute", "glute", "thigh", "thigh",
    ]);
  });

  it("leaves models without target bones completely untouched", () => {
    const scene = new Group();
    const bone = new Bone();
    bone.name = "ordinary-bone";
    bone.position.set(1, 2, 3);
    bone.rotation.set(0.2, 0.3, 0.4);
    scene.add(bone);
    const before = bone.toJSON();
    const springs = new RosieBodySprings(scene);
    springs.update(1 / 60);
    springs.reset();
    springs.dispose();
    expect(springs.bodies).toHaveLength(0);
    expect(bone.toJSON()).toEqual(before);
  });

  it("does not activate on a partial custom bone-name match", () => {
    const scene = new Group();
    const bone = new Bone();
    bone.name = PropertyBinding.sanitizeNodeName(ROSIE_BODY_NAMES[0]!);
    bone.position.set(0.1, 0.2, 0.3);
    scene.add(bone);
    const springs = new RosieBodySprings(scene);
    expect(springs.bodies).toHaveLength(0);
    bone.position.x = 0.8;
    springs.update(1 / 60);
    expect(bone.position.x).toBe(0.8);
  });

  it("reacts opposite acceleration and leaves rigid TRS and soft rotation/scale unchanged", () => {
    const rig = syntheticRig();
    const rigidTRS = [rig.rigid.position.toArray(), rig.rigid.quaternion.toArray(), rig.rigid.scale.toArray()];
    excite(rig);
    for (const body of rig.springs.bodies) {
      expect(body.offset.x).toBeLessThan(0);
      expect(body.bone.quaternion.toArray()).toEqual(body.rotation.toArray());
      expect(body.bone.scale.toArray()).toEqual(body.scale.toArray());
    }
    expect([rig.rigid.position.toArray(), rig.rigid.quaternion.toArray(), rig.rigid.scale.toArray()]).toEqual(rigidTRS);
    expectBounded(rig.springs);
  });

  it("converts world displacement correctly through rotated and nonuniformly scaled parents", () => {
    const rig = syntheticRig();
    rig.root.rotation.set(0.5, -0.7, 0.8);
    rig.root.scale.set(1.2, 1.7, 0.8);
    excite(rig);
    for (const body of rig.springs.bodies) {
      const restWorld = body.rest.clone().applyMatrix4(body.bone.parent!.matrixWorld);
      const observed = body.bone.getWorldPosition(new Vector3()).sub(restWorld);
      expect(observed.distanceTo(body.offset)).toBeLessThan(1e-10);
    }
  });

  it("responds to moving the DOM canvas without translating the Three scene", () => {
    const rig = syntheticRig();
    const screen = new Vector3(2, -1, 0);
    prime(rig.springs, 1 / 60, screen);
    screen.x += 0.015;
    rig.springs.update(1 / 60, { ...DEFAULT_ROSIE_SPRINGS }, screen);
    expect(rig.springs.bodies[0]!.offset.x).toBeLessThan(0);
    expect(rig.root.position.toArray()).toEqual([0, 0, 0]);
    for (const body of rig.springs.bodies) {
      const restWorld = body.rest.clone().applyMatrix4(body.bone.parent!.matrixWorld);
      const observed = body.bone.getWorldPosition(new Vector3()).sub(restWorld);
      expect(observed.distanceTo(body.offset)).toBeLessThan(1e-10);
    }
  });

  it("oscillates after release and settles without accumulating rest drift", () => {
    const rig = syntheticRig();
    excite(rig);
    let crossedRest = false;
    for (let frame = 0; frame < 600; frame++) {
      rig.springs.update(1 / 60);
      crossedRest ||= rig.springs.bodies[0]!.offset.x > 0;
      expectBounded(rig.springs);
    }
    expect(crossedRest).toBe(true);
    for (const body of rig.springs.bodies) {
      expect(body.bone.position.distanceTo(body.rest)).toBeLessThan(1e-8);
      expect(body.velocity.length()).toBeLessThan(1e-8);
    }
  });

  it.each([30, 60, 120])("stays finite and capped through repeated impulses at %s Hz", (fps) => {
    const rig = syntheticRig();
    prime(rig.springs, 1 / fps);
    let maxResponse = 0;
    for (let frame = 0; frame < fps * 5; frame++) {
      rig.root.position.set(Math.sin(frame * 0.8) * 0.09, Math.cos(frame * 0.4) * 0.06, 0);
      rig.springs.update(1 / fps, { ...DEFAULT_ROSIE_SPRINGS, strength: 1.6, chest: 1.5 });
      expectBounded(rig.springs);
      maxResponse = Math.max(maxResponse, rig.springs.bodies[0]!.offset.length());
    }
    expect(maxResponse).toBeGreaterThan(0.0001);
  });

  it("has comparable steady-state response at 30, 60 and 120 Hz", () => {
    const amplitudes = [30, 60, 120].map((fps) => {
      const rig = syntheticRig();
      let squares = 0;
      for (let frame = 0; frame < fps * 8; frame++) {
        rig.root.position.x = 0.003 * Math.sin(frame / fps * Math.PI * 4);
        rig.springs.update(1 / fps);
        if (frame >= fps * 4) squares += rig.springs.bodies[0]!.offset.lengthSq();
      }
      return Math.sqrt(squares / (fps * 4));
    });
    expect(Math.min(...amplitudes)).toBeGreaterThan(0.0001);
    expect(Math.max(...amplitudes) / Math.min(...amplitudes)).toBeLessThan(1.2);
  });

  it("turns off at rest, stays off during movement, and reenables without a kick", () => {
    const rig = syntheticRig();
    excite(rig);
    rig.springs.update(1 / 60, { ...DEFAULT_ROSIE_SPRINGS, enabled: false });
    expectRest(rig.springs);
    rig.root.position.x += 0.1;
    rig.springs.update(1 / 60, { ...DEFAULT_ROSIE_SPRINGS, enabled: false });
    expectRest(rig.springs);
    rig.springs.update(1 / 60);
    expectRest(rig.springs);
  });

  it("zero region weights affect only their region and zero strength restores all regions", () => {
    const rig = syntheticRig();
    excite(rig);
    rig.root.position.x += 0.01;
    rig.springs.update(1 / 60, { ...DEFAULT_ROSIE_SPRINGS, chest: 0 });
    for (const body of rig.springs.bodies) {
      if (body.region === "chest") expect(body.offset.length()).toBe(0);
      else expect(body.offset.length()).toBeGreaterThan(0);
    }
    rig.springs.update(1 / 60, { ...DEFAULT_ROSIE_SPRINGS, strength: 0 });
    expectRest(rig.springs);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.5, 30])(
    "resets safely for invalid or post-pause delta %s", (dt) => {
      const rig = syntheticRig();
      excite(rig);
      rig.springs.update(dt);
      expectRest(rig.springs);
      rig.springs.update(1 / 60);
      expectRest(rig.springs);
      expectBounded(rig.springs);
    },
  );

  it("resets on teleport instead of producing an impulse", () => {
    const rig = syntheticRig();
    excite(rig);
    rig.root.position.set(10, -20, 3);
    rig.springs.update(1 / 60);
    expectRest(rig.springs);
    rig.springs.update(1 / 60);
    expectRest(rig.springs);
  });

  it("recovers from a nonfinite screen sample without poisoning future frames", () => {
    const rig = syntheticRig();
    excite(rig);
    rig.springs.update(1 / 60, { ...DEFAULT_ROSIE_SPRINGS }, new Vector3(Number.NaN, 0, 0));
    expectRest(rig.springs);
    for (let frame = 0; frame < 5; frame++) {
      rig.springs.update(1 / 60, { ...DEFAULT_ROSIE_SPRINGS }, new Vector3());
      expectBounded(rig.springs);
      expectRest(rig.springs);
    }
  });

  it("reset/dispose restore every target and a new model instance has no old momentum", () => {
    const oldRig = syntheticRig();
    excite(oldRig);
    oldRig.springs.reset();
    expectRest(oldRig.springs);
    excite(oldRig);
    oldRig.springs.dispose();
    expectRest(oldRig.springs);
    const nextRig = syntheticRig();
    prime(nextRig.springs);
    expectRest(nextRig.springs);
  });
});

describe("animation filtering", () => {
  it("removes only target TRS and preserves source clips, buffers and unrelated tracks", () => {
    const tracks = ROSIE_BODY_NAMES.flatMap((name) => [
      new VectorKeyframeTrack(`${PropertyBinding.sanitizeNodeName(name)}.position`, [0, 1], [0, 0, 0, 1, 0, 0]),
      new QuaternionKeyframeTrack(`${PropertyBinding.sanitizeNodeName(name)}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      new VectorKeyframeTrack(`${PropertyBinding.sanitizeNodeName(name)}.scale`, [0, 1], [1, 1, 1, 1, 1, 1]),
    ]);
    tracks.push(new VectorKeyframeTrack("DEF-spine.position", [0, 1], [0, 0, 0, 0, 1, 0]));
    const source = new AnimationClip("authored", 1, tracks);
    const before = AnimationClip.toJSON(source);
    const [filtered] = withoutBakedRosieBody([source]);
    expect(filtered!.tracks).toHaveLength(1);
    expect(filtered!.tracks[0]!.name).toBe("DEF-spine.position");
    expect(filtered!.tracks[0]).not.toBe(tracks.at(-1));
    expect(filtered!.tracks[0]!.values).not.toBe(tracks.at(-1)!.values);
    expect(AnimationClip.toJSON(source)).toEqual(before);
    expect(filtered!.duration).toBe(source.duration);
    expect(filtered!.name).toBe(source.name);
  });

  it("recognizes original dotted names inside skeleton bone track bindings", () => {
    const clip = new AnimationClip("bone-path", 1, [
      new VectorKeyframeTrack("mesh.bones[DEF-soft.chest.L].position", [0], [0, 0, 0]),
      new VectorKeyframeTrack("mesh.bones[DEF-spine].position", [0], [0, 0, 0]),
    ]);
    expect(withoutBakedRosieBody([clip])[0]!.tracks.map((track) => track.name))
      .toEqual(["mesh.bones[DEF-spine].position"]);
  });
});

/** Keep real geometry, skin, nodes and animation; textures need a browser. */
async function loadActualGlb() {
  const source = readFileSync(resolve("public/characters/rosie.glb"));
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new Texture() }));
  return loader.parseAsync(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), "");
}

function trsSnapshot(scene: Object3D) {
  const result: Record<string, number[][]> = {};
  scene.traverse((node) => {
    result[node.name] = [node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()];
  });
  return result;
}

describe("actual cybernetic Rosie GLB", () => {
  let gltf: GLTF;
  beforeAll(async () => { gltf = await loadActualGlb(); });

  it("binds all six loaded bones and removes exactly 18 of 111 baked tracks", () => {
    const scene = cloneSkeleton(gltf.scene);
    const springs = new RosieBodySprings(scene);
    expect(gltf.animations).toHaveLength(1);
    expect(gltf.animations[0]!.duration).toBeCloseTo(143 / 24);
    expect(gltf.animations[0]!.tracks).toHaveLength(111);
    expect(springs.bodies).toHaveLength(6);
    const filtered = withoutBakedRosieBody(gltf.animations);
    expect(filtered[0]!.tracks).toHaveLength(93);
    expect(springs.bodies.map((body) => body.bone.userData.name).sort()).toEqual([...ROSIE_BODY_NAMES].sort());
  });

  it("isolates momentum between simultaneous gallery and companion clones", () => {
    const gallery = new RosieBodySprings(cloneSkeleton(gltf.scene));
    const companion = new RosieBodySprings(cloneSkeleton(gltf.scene));
    prime(gallery);
    prime(companion);
    companion.update(1 / 60, { ...DEFAULT_ROSIE_SPRINGS }, new Vector3(0.015, 0, 0));
    gallery.update(1 / 60);
    expect(companion.bodies[0]!.offset.length()).toBeGreaterThan(0);
    expectRest(gallery);
    gallery.dispose();
    expect(companion.bodies[0]!.offset.length()).toBeGreaterThan(0);
  });

  it("keeps cached GLTF immutable across repeated clones, playback, reset and disposal", () => {
    const originalScene = trsSnapshot(gltf.scene);
    const originalClips = gltf.animations.map(AnimationClip.toJSON);
    for (let repeat = 0; repeat < 3; repeat++) {
      const scene = cloneSkeleton(gltf.scene);
      const springs = new RosieBodySprings(scene);
      const mixer = new AnimationMixer(scene);
      mixer.clipAction(withoutBakedRosieBody(gltf.animations)[0]!).play();
      let maximum = 0;
      for (let frame = 0; frame < 360; frame++) {
        mixer.update(1 / 60);
        springs.update(1 / 60);
        expectBounded(springs);
        maximum = Math.max(maximum, ...springs.bodies.map((body) => body.offset.length()));
      }
      expect(maximum).toBeGreaterThan(0.0001);
      mixer.stopAllAction();
      springs.dispose();
      expectRest(springs);
    }
    expect(trsSnapshot(gltf.scene)).toEqual(originalScene);
    expect(gltf.animations.map(AnimationClip.toJSON)).toEqual(originalClips);
  });

  it("preserves every animated non-soft local TRS throughout actual playback", () => {
    const controlled = cloneSkeleton(gltf.scene);
    const baseline = cloneSkeleton(gltf.scene);
    const springs = new RosieBodySprings(controlled);
    const filtered = withoutBakedRosieBody(gltf.animations);
    const liveMixer = new AnimationMixer(controlled);
    const baselineMixer = new AnimationMixer(baseline);
    liveMixer.clipAction(filtered[0]!).play();
    baselineMixer.clipAction(gltf.animations[0]!).play();
    const softNames = new Set(springs.bodies.map((body) => body.bone.name));
    for (let frame = 0; frame < 180; frame++) {
      liveMixer.update(1 / 30);
      baselineMixer.update(1 / 30);
      springs.update(1 / 30);
      controlled.traverse((node) => {
        if (softNames.has(node.name)) return;
        const reference = baseline.getObjectByName(node.name)!;
        expect(node.position.toArray()).toEqual(reference.position.toArray());
        expect(node.quaternion.toArray()).toEqual(reference.quaternion.toArray());
        expect(node.scale.toArray()).toEqual(reference.scale.toArray());
      });
    }
  });

  it("measures real-clip response at baseline, default and maximum settings", () => {
    const report = [];
    for (const fps of [30, 60, 120]) {
      for (const level of ["baseline", "default", "maximum"]) {
        const scene = cloneSkeleton(gltf.scene);
        const springs = new RosieBodySprings(scene);
        const mixer = new AnimationMixer(scene);
        mixer.clipAction(withoutBakedRosieBody(gltf.animations)[0]!).play();
        const config = level === "baseline" ? { ...DEFAULT_ROSIE_SPRINGS, strength: 1 }
          : level === "maximum" ? { enabled: true, strength: 1.6, chest: 1.5, glute: 1.5, thigh: 1.5 }
          : { ...DEFAULT_ROSIE_SPRINGS };
        const measurements = Object.fromEntries(["chest", "glute", "thigh"].map((region) => [region,
          { maximum: 0, squares: 0, samples: 0, capped: 0 },
        ]));
        for (let frame = 0; frame < 12 * fps; frame++) {
          mixer.update(1 / fps);
          springs.update(1 / fps, config);
          if (frame < 6 * fps) continue;
          for (const body of springs.bodies) {
            const measurement = measurements[body.region]!;
            const length = body.offset.length();
            const scale = Math.max(...body.parentScale.toArray().map(Math.abs));
            measurement.maximum = Math.max(measurement.maximum, length);
            measurement.squares += length * length;
            measurement.samples++;
            if (length >= body.maxOffset * scale * (1 - 1e-6)) measurement.capped++;
          }
        }
        const regions = Object.fromEntries(Object.entries(measurements).map(([region, value]) => [region, {
          maxMm: value.maximum * 1000,
          rmsMm: Math.sqrt(value.squares / value.samples) * 1000,
          cappedPercent: value.capped / value.samples * 100,
        }]));
        report.push({ fps, level, regions });
        springs.dispose();
        mixer.stopAllAction();
      }
    }
    if (process.env.ROSIE_REPORT_METRICS === "1") console.info(JSON.stringify(report, null, 2));
    for (const fps of [30, 60, 120]) {
      const baseline = report.find((entry) => entry.fps === fps && entry.level === "baseline")!;
      const defaults = report.find((entry) => entry.fps === fps && entry.level === "default")!;
      for (const region of ["chest", "glute", "thigh"]) {
        expect(defaults.regions[region]!.rmsMm / baseline.regions[region]!.rmsMm).toBeGreaterThan(1.1);
        expect(defaults.regions[region]!.cappedPercent).toBeLessThan(50);
      }
    }
    // Real authored keyframes contain velocity discontinuities; a smooth sine
    // fixture alone would miss raw-acceleration clamps losing impulse at 120 Hz.
    for (const region of ["chest", "glute", "thigh"]) {
      const rms = report.filter((entry) => entry.level === "default")
        .map((entry) => entry.regions[region]!.rmsMm);
      expect(Math.max(...rms) / Math.min(...rms)).toBeLessThan(1.2);
    }
  });
});

describe("spring settings validation", () => {
  it("keeps defaults and rejects invalid persisted numbers", () => {
    expect(sanitizeRosieSprings()).toEqual(DEFAULT_ROSIE_SPRINGS);
    expect(sanitizeRosieSprings({ strength: Number.NaN, chest: -2, glute: 80, thigh: Infinity }))
      .toEqual({ enabled: true, strength: 1.25, chest: 0, glute: 1.5, thigh: 1 });
  });
});
