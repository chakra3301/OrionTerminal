import { describe, it, expect, beforeEach } from "vitest";
import {
  useFxStore,
  snapshotFxDoc,
  emptyFxDoc,
  sanitizeScene,
} from "./fxStore";
import { emptyScene, defaultParams } from "./fxModel";
import { fxEffect } from "./fxRegistry";

beforeEach(() => {
  useFxStore.getState().hydrateFx({ scene: emptyScene() });
});

describe("layer CRUD", () => {
  it("addLayer appends with registry defaults and selects it", () => {
    useFxStore.getState().addLayer("gradient");
    const { scene, selectedLayerId } = useFxStore.getState();
    expect(scene.layers).toHaveLength(1);
    const l = scene.layers[0]!;
    expect(l.effectId).toBe("gradient");
    expect(l.opacity).toBe(1);
    expect(l.params).toEqual(defaultParams(fxEffect("gradient")!));
    expect(selectedLayerId).toBe(l.id);
  });

  it("addLayer ignores unknown effects", () => {
    useFxStore.getState().addLayer("does-not-exist");
    expect(useFxStore.getState().scene.layers).toHaveLength(0);
  });

  it("adds a dropped image as a selected source layer", () => {
    useFxStore.getState().addImageLayer("/app/assets/photo.png", "photo.png");
    const { scene, selectedLayerId } = useFxStore.getState();
    expect(scene.layers).toHaveLength(1);
    expect(scene.layers[0]).toMatchObject({
      effectId: "srcImage",
      name: "photo.png",
      params: { file: "/app/assets/photo.png" },
    });
    expect(selectedLayerId).toBe(scene.layers[0]!.id);
  });

  it("names duplicates uniquely", () => {
    useFxStore.getState().addLayer("gradient");
    useFxStore.getState().addLayer("gradient");
    const names = useFxStore.getState().scene.layers.map((l) => l.name);
    expect(new Set(names).size).toBe(2);
  });

  it("removeLayer drops it and clears selection", () => {
    useFxStore.getState().addLayer("gradient");
    const id = useFxStore.getState().scene.layers[0]!.id;
    useFxStore.getState().removeLayer(id);
    expect(useFxStore.getState().scene.layers).toHaveLength(0);
    expect(useFxStore.getState().selectedLayerId).toBeNull();
  });

  it("setParam patches a single param", () => {
    useFxStore.getState().addLayer("noiseDistort");
    const id = useFxStore.getState().scene.layers[0]!.id;
    useFxStore.getState().setParam(id, "strength", 0.25);
    expect(useFxStore.getState().scene.layers[0]!.params.strength).toBe(0.25);
  });

  it("moveLayer reorders within bounds and clamps at edges", () => {
    const s = useFxStore.getState();
    s.addLayer("gradient");
    s.addLayer("noiseDistort");
    const [a, b] = useFxStore.getState().scene.layers.map((l) => l.id);
    useFxStore.getState().moveLayer(a!, 1);
    expect(useFxStore.getState().scene.layers.map((l) => l.id)).toEqual([b, a]);
    // Already at top — no-op.
    useFxStore.getState().moveLayer(a!, 1);
    expect(useFxStore.getState().scene.layers.map((l) => l.id)).toEqual([b, a]);
  });
});

describe("persistence round-trip", () => {
  it("snapshot → hydrate preserves the scene", () => {
    const s = useFxStore.getState();
    s.addLayer("gradient");
    s.patchScene({ width: 640, height: 480, background: "#112233" });
    const doc = snapshotFxDoc();
    useFxStore.getState().hydrateFx({ scene: emptyScene() });
    useFxStore.getState().hydrateFx(doc);
    const scene = useFxStore.getState().scene;
    expect(scene.width).toBe(640);
    expect(scene.height).toBe(480);
    expect(scene.background).toBe("#112233");
    expect(scene.layers).toHaveLength(1);
  });

  it("hydrate resets transient state", () => {
    useFxStore.getState().addLayer("gradient");
    useFxStore.getState().setPlaying(false);
    useFxStore.getState().hydrateFx({ scene: emptyScene() });
    expect(useFxStore.getState().selectedLayerId).toBeNull();
    expect(useFxStore.getState().playing).toBe(true);
  });

  it("emptyFxDoc seeds a gradient layer", () => {
    const doc = emptyFxDoc();
    expect(doc.scene.layers).toHaveLength(1);
    expect(doc.scene.layers[0]!.effectId).toBe("gradient");
  });
});

describe("sanitizeScene", () => {
  it("drops layers with unknown effects", () => {
    const scene = emptyScene();
    scene.layers.push({
      id: "x",
      effectId: "removed-effect",
      name: "Ghost",
      opacity: 1,
      params: {},
    });
    expect(sanitizeScene(scene).layers).toHaveLength(0);
  });

  it("backfills params added after the doc was saved", () => {
    const scene = emptyScene();
    scene.layers.push({
      id: "x",
      effectId: "gradient",
      name: "Gradient",
      opacity: 1,
      params: { angle: 90 }, // stored before other params existed
    });
    const out = sanitizeScene(scene);
    expect(out.layers[0]!.params.angle).toBe(90);
    expect(out.layers[0]!.params.colorA).toBeDefined();
    expect(out.layers[0]!.params.warp).toBeDefined();
  });
});
