import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("undo / redo", () => {
  const S = () => useFxStore.getState();

  it("undoes and redoes layer add and remove", () => {
    S().addLayer("gradient");
    const id = S().scene.layers[0]!.id;
    S().removeLayer(id);
    expect(S().scene.layers).toHaveLength(0);
    S().undo();
    expect(S().scene.layers).toHaveLength(1);
    S().undo();
    expect(S().scene.layers).toHaveLength(0);
    S().redo();
    S().redo();
    expect(S().scene.layers).toHaveLength(0);
    expect(S().future).toHaveLength(0);
  });

  it("undo/redo are no-ops on an empty stack", () => {
    const before = S().scene;
    S().undo();
    S().redo();
    expect(S().scene).toBe(before);
  });

  it("a new edit clears the redo stack", () => {
    S().addLayer("gradient");
    S().undo();
    expect(S().future).toHaveLength(1);
    S().addLayer("gradient");
    expect(S().future).toHaveLength(0);
  });

  it("selection, playback and other transient state are not history steps", () => {
    S().addLayer("gradient");
    const depth = S().past.length;
    S().selectLayer(null);
    S().setPlaying(false);
    S().restart();
    S().setScrub(0.5);
    S().setShowPerf(true);
    S().setAudioOn(true);
    S().setAudioOn(false);
    expect(S().past).toHaveLength(depth);
  });

  it("edits that change nothing do not record a step", () => {
    S().addLayer("gradient");
    const depth = S().past.length;
    S().addLayer("does-not-exist");
    S().duplicateLayer("missing");
    S().moveLayer(S().scene.layers[0]!.id, -1);
    expect(S().past).toHaveLength(depth);
  });

  it("keeps the selection when the layer still exists, otherwise clears it", () => {
    S().addLayer("gradient");
    const a = S().scene.layers[0]!.id;
    S().addLayer("gradient");
    const b = S().scene.layers[1]!.id;
    expect(S().selectedLayerId).toBe(b);
    S().undo(); // b removed
    expect(S().selectedLayerId).toBeNull();
    S().selectLayer(a);
    S().setParam(a, "speed", 3);
    S().undo();
    expect(S().selectedLayerId).toBe(a);
  });

  it("restores the exact previous scene object", () => {
    S().addLayer("gradient");
    const before = S().scene;
    S().patchScene({ background: "#123456" });
    S().undo();
    expect(S().scene).toBe(before);
  });

  it("caps history at 100 steps", () => {
    for (let i = 0; i < 130; i++) S().addLayer("gradient");
    expect(S().past).toHaveLength(100);
  });

  it("hydrateFx clears history", () => {
    S().addLayer("gradient");
    S().undo();
    S().addLayer("gradient");
    S().hydrateFx({ scene: emptyScene() });
    expect(S().past).toHaveLength(0);
    expect(S().future).toHaveLength(0);
  });

  it("changes scene identity on undo/redo so persistence subscribers fire", () => {
    S().addLayer("gradient");
    const seen: unknown[] = [];
    const off = useFxStore.subscribe((s, p) => {
      if (s.scene !== p.scene) seen.push(s.scene);
    });
    S().undo();
    S().redo();
    off();
    expect(seen).toHaveLength(2);
  });

  describe("coalescing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      S().hydrateFx({ scene: emptyScene() });
      S().addLayer("gradient");
      vi.advanceTimersByTime(5000);
    });
    afterEach(() => vi.useRealTimers());

    const layerId = () => S().scene.layers[0]!.id;

    it("a slider drag on one param is a single step", () => {
      const before = S().scene;
      const depth = S().past.length;
      for (let i = 1; i <= 30; i++) {
        S().setParam(layerId(), "speed", i / 10);
        vi.advanceTimersByTime(16);
      }
      expect(S().past).toHaveLength(depth + 1);
      S().undo();
      expect(S().scene).toBe(before);
    });

    it("different params are separate steps", () => {
      const depth = S().past.length;
      S().setParam(layerId(), "speed", 1);
      S().setParam(layerId(), "scale", 2);
      expect(S().past).toHaveLength(depth + 2);
    });

    it("the same param after an idle pause starts a new step", () => {
      const depth = S().past.length;
      S().setParam(layerId(), "speed", 1);
      vi.advanceTimersByTime(5000);
      S().setParam(layerId(), "speed", 2);
      expect(S().past).toHaveLength(depth + 2);
    });

    it("undo breaks the coalescing run", () => {
      S().setParam(layerId(), "speed", 1);
      S().undo();
      const depth = S().past.length;
      S().setParam(layerId(), "speed", 2);
      expect(S().past).toHaveLength(depth + 1);
      expect(S().future).toHaveLength(0);
    });

    it("an unrelated edit between two same-param edits splits them", () => {
      const depth = S().past.length;
      S().setParam(layerId(), "speed", 1);
      S().patchLayer(layerId(), { opacity: 0.5 });
      S().setParam(layerId(), "speed", 2);
      expect(S().past).toHaveLength(depth + 3);
    });

    it("a gesture groups edits across params and pauses into one step", () => {
      const before = S().scene;
      const depth = S().past.length;
      S().beginGesture();
      S().setParam(layerId(), "x", 0.4);
      S().setParam(layerId(), "y", 0.6);
      vi.advanceTimersByTime(5000);
      S().setParam(layerId(), "x", 0.7);
      S().endGesture();
      expect(S().past).toHaveLength(depth + 1);
      S().undo();
      expect(S().scene).toBe(before);
    });

    it("a gesture with no edits records nothing, and ends cleanly", () => {
      const depth = S().past.length;
      S().beginGesture();
      S().endGesture();
      expect(S().past).toHaveLength(depth);
      S().setParam(layerId(), "speed", 1);
      expect(S().past).toHaveLength(depth + 1);
    });

    it("hydrateFx abandons an open gesture", () => {
      S().beginGesture();
      S().hydrateFx({ scene: emptyScene() });
      S().addLayer("gradient");
      S().addLayer("gradient");
      expect(S().past).toHaveLength(2);
    });
  });
});
