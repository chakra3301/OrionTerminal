import { describe, it, expect } from "vitest";
import { sceneToJson, sceneFromJson, buildEmbedHtml } from "./fxExport";
import { emptyScene } from "./fxModel";
import { emptyFxDoc } from "./fxStore";

describe("scene JSON round trip", () => {
  it("survives export → import", () => {
    const scene = emptyFxDoc().scene;
    scene.width = 640;
    scene.layers[0]!.params.angle = 123;
    const back = sceneFromJson(sceneToJson(scene));
    expect(back).not.toBeNull();
    expect(back!.width).toBe(640);
    expect(back!.layers).toHaveLength(1);
    expect(back!.layers[0]!.params.angle).toBe(123);
  });

  it("rejects garbage, wrong kinds, and missing scenes", () => {
    expect(sceneFromJson("not json")).toBeNull();
    expect(sceneFromJson("{}")).toBeNull();
    expect(sceneFromJson(JSON.stringify({ kind: "other", scene: {} }))).toBeNull();
    expect(
      sceneFromJson(JSON.stringify({ kind: "orion-fx-scene", version: 1 })),
    ).toBeNull();
  });

  it("sanitizes on import (unknown effects dropped)", () => {
    const scene = emptyScene();
    scene.layers.push({
      id: "x",
      effectId: "ghost-effect",
      name: "Ghost",
      opacity: 1,
      params: {},
    });
    const back = sceneFromJson(sceneToJson(scene));
    expect(back!.layers).toHaveLength(0);
  });
});

describe("buildEmbedHtml", () => {
  it("bundles shaders + data + player for every used effect", () => {
    const scene = emptyFxDoc().scene; // gradient layer
    scene.layers.push({
      id: "n1",
      effectId: "noiseDistort",
      name: "Noise",
      opacity: 1,
      params: {},
    });
    const html = buildEmbedHtml(scene, {});
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('window.__FX_DATA__');
    expect(html).toContain('"gradient"');
    expect(html).toContain('"noiseDistort"');
    expect(html).toContain("#version 300 es"); // prebuilt shaders inline
    expect(html).toContain('getContext("webgl2"'); // player present
    expect(html).toContain('<canvas id="fx">');
  });

  it("escapes </script> inside embedded data", () => {
    const scene = emptyFxDoc().scene;
    scene.layers[0]!.name = "</script><script>alert(1)</script>";
    const html = buildEmbedHtml(scene, {});
    expect(html).not.toMatch(/<\/script><script>alert/);
  });

  it("inlines source data URLs", () => {
    const scene = emptyFxDoc().scene;
    const html = buildEmbedHtml(scene, { L9: "data:image/png;base64,AAAA" });
    expect(html).toContain("data:image/png;base64,AAAA");
  });
});
