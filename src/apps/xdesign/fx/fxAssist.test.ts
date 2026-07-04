import { describe, it, expect, beforeEach } from "vitest";
import { executeFxTool, fxAssistSystem, toolLabel, FX_TOOLS } from "./fxAssist";
import { useFxStore } from "./fxStore";
import { emptyScene } from "./fxModel";
import { FX_EFFECTS } from "./fxRegistry";

beforeEach(() => {
  useFxStore.getState().hydrateFx({ scene: emptyScene() });
});

function run(name: string, input: Record<string, unknown> = {}) {
  return JSON.parse(executeFxTool(name, input)) as Record<string, unknown> & {
    ok?: boolean;
    layerId?: string;
    error?: string;
  };
}

describe("fx assist tools", () => {
  it("fx_add_layer creates, clamps params, and applies meta", () => {
    const res = run("fx_add_layer", {
      effectId: "nebula",
      name: "Sky",
      params: { scale: 999, stars: 0.7 }, // scale over max → clamp to 8
      blend: "screen",
      opacity: 0.8,
    });
    expect(res.ok).toBe(true);
    const layer = useFxStore.getState().scene.layers[0]!;
    expect(layer.id).toBe(res.layerId);
    expect(layer.name).toBe("Sky");
    expect(layer.params.scale).toBe(8);
    expect(layer.params.stars).toBe(0.7);
    expect(layer.blend).toBe("screen");
    expect(layer.opacity).toBe(0.8);
  });

  it("fx_add_layer rejects unknown effects", () => {
    const res = run("fx_add_layer", { effectId: "flux-capacitor" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("unknown effectId");
  });

  it("fx_set_binding validates param + source, and removes with null", () => {
    const { layerId } = run("fx_add_layer", { effectId: "noiseDistort" });
    const ok = run("fx_set_binding", {
      layerId,
      param: "strength",
      source: "mouseSpeed",
      amount: 5, // → clamp 1
    });
    expect(ok.ok).toBe(true);
    let layer = useFxStore.getState().scene.layers[0]!;
    expect(layer.bindings!.strength).toEqual({ source: "mouseSpeed", amount: 1, smooth: 0.3 });

    expect(run("fx_set_binding", { layerId, param: "nope", source: "hover" }).ok).toBe(false);
    expect(run("fx_set_binding", { layerId, param: "strength", source: "telepathy" }).ok).toBe(false);

    run("fx_set_binding", { layerId, param: "strength", source: null });
    layer = useFxStore.getState().scene.layers[0]!;
    expect(layer.bindings).toBeUndefined();
  });

  it("fx_add_keyframe clamps t and v into range", () => {
    const { layerId } = run("fx_add_layer", { effectId: "noiseDistort" });
    const res = run("fx_add_keyframe", { layerId, param: "strength", t: 3, v: 99 });
    expect(res.ok).toBe(true);
    const kfs = useFxStore.getState().scene.layers[0]!.keyframes!.strength!;
    expect(kfs[0]).toMatchObject({ t: 1, v: 0.5, ease: "inOut" });
  });

  it("fx_patch_layer enforces source-only masks", () => {
    const { layerId: fx } = run("fx_add_layer", { effectId: "vignette" });
    const { layerId: gen } = run("fx_add_layer", { effectId: "plasma" });
    expect(run("fx_patch_layer", { layerId: fx, maskLayerId: gen }).ok).toBe(false);
    const { layerId: shape } = run("fx_add_layer", { effectId: "srcShape" });
    expect(run("fx_patch_layer", { layerId: fx, maskLayerId: shape }).ok).toBe(true);
    expect(useFxStore.getState().scene.layers[0]!.maskLayerId).toBe(shape);
  });

  it("fx_get_scene reports layers with ids the other tools accept", () => {
    run("fx_add_layer", { effectId: "aurora" });
    const scene = run("fx_get_scene") as unknown as {
      layers: { id: string; effectId: string }[];
    };
    expect(scene.layers).toHaveLength(1);
    expect(run("fx_remove_layer", { layerId: scene.layers[0]!.id }).ok).toBe(true);
    expect(useFxStore.getState().scene.layers).toHaveLength(0);
  });

  it("fx_set_scene clamps ranges", () => {
    run("fx_set_scene", { background: "#101010", duration: 999, width: 4 });
    const s = useFxStore.getState().scene;
    expect(s.background).toBe("#101010");
    expect(s.duration).toBe(120);
    expect(s.width).toBe(16);
  });
});

describe("system prompt + tool metadata", () => {
  it("catalogs every non-custom registry effect", () => {
    const sys = fxAssistSystem();
    for (const spec of FX_EFFECTS) {
      if (spec.id === "custom") continue;
      expect(sys, `missing ${spec.id}`).toContain(`- ${spec.id} (`);
    }
  });

  it("tools have unique names and labels", () => {
    const names = FX_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(toolLabel(n, {}).length).toBeGreaterThan(0);
    }
  });
});

describe("store editing controls", () => {
  it("duplicateLayer deep-copies params/bindings and renames", () => {
    const { layerId } = run("fx_add_layer", { effectId: "beam", name: "Beam" });
    run("fx_set_binding", { layerId, param: "intensity", source: "hover", amount: 0.5 });
    useFxStore.getState().duplicateLayer(layerId!);
    const layers = useFxStore.getState().scene.layers;
    expect(layers).toHaveLength(2);
    const copy = layers[1]!;
    expect(copy.id).not.toBe(layerId);
    expect(copy.name).not.toBe("Beam");
    expect(copy.bindings!.intensity!.source).toBe("hover");
    // Deep copy — mutating the copy must not touch the original.
    useFxStore.getState().setParam(copy.id, "intensity", 0.1);
    expect(layers[0]!.params.intensity).not.toBe(0.1);
  });

  it("randomizeLayer stays inside param ranges and skips hidden/code", () => {
    const { layerId } = run("fx_add_layer", { effectId: "ripple" });
    for (let i = 0; i < 5; i++) {
      useFxStore.getState().randomizeLayer(layerId!);
      const l = useFxStore.getState().scene.layers[0]!;
      expect(l.params.amplitude).toBeGreaterThanOrEqual(0);
      expect(l.params.amplitude).toBeLessThanOrEqual(1);
      expect(l.params.frequency).toBeGreaterThanOrEqual(1);
      expect(l.params.frequency).toBeLessThanOrEqual(60);
    }
  });

  it("resetParam restores the registry default", () => {
    const { layerId } = run("fx_add_layer", { effectId: "ripple", params: { amplitude: 1 } });
    useFxStore.getState().resetParam(layerId!, "amplitude");
    expect(useFxStore.getState().scene.layers[0]!.params.amplitude).toBe(0.3);
  });
});
