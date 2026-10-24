import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneNode } from "@open-pencil/scene-graph";
import { AppearancePanel } from "./AppearancePanel";
import { paintCenter, rotatePaint } from "./fillGeometry";
import { usePencilWorkspace } from "./runtime";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
const matrix = { m00: 1.7, m01: .4, m02: -.2, m10: .6, m11: .8, m12: .3 }, color = { r: .2, g: .4, b: .7, a: 1 };
let editor: Editor, node: SceneNode, root: Root, container: HTMLDivElement;
const render = () => act(async () => root.render(<AppearancePanel node={node}/>));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); editor = createEditor(); usePencilWorkspace.setState({ editor });
  node = editor.graph.createNode("RECTANGLE", editor.state.currentPageId, { width: 160, height: 100, fills: [{ type: "GRADIENT_LINEAR", color, gradientStops: [{ position: 0, color }, { position: 1, color: { ...color, r: 1 } }], gradientTransform: matrix, opacity: .8, visible: true }], effects: [{ type: "DROP_SHADOW", color, offset: { x: 2, y: 4 }, radius: 8, spread: 2, visible: true }] });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
});
afterEach(() => { act(() => root.unmount()); container.remove(); editor.dispose(); usePencilWorkspace.setState({ editor: null }); vi.unstubAllGlobals(); });
const numeric = async (label: string, value: string) => { await act(async () => { const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; input.value = value; input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); await render(); };
const select = async (label: string, value: string) => { await act(async () => { const input = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); }); await render(); };
const click = async (label: string) => { await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()); await render(); };

describe("design paint geometry controls", () => {
  it("rotates a gradient while preserving imported scale, skew, stops and real undo", async () => {
    const original = structuredClone(node.fills[0]!);
    await numeric("Gradient 1 angle", "75"); expect(node.fills[0]!.gradientTransform).toEqual(rotatePaint(matrix, 75)); expect(node.fills[0]!.gradientStops).toEqual(original.gradientStops); expect(node.fills[0]!.opacity).toBe(.8);
    editor.undoAction(); await render(); expect(node.fills[0]).toEqual(original);
    await numeric("Gradient 1 width %", "220"); expect(Math.hypot(node.fills[0]!.gradientTransform!.m00, node.fills[0]!.gradientTransform!.m10)).toBeCloseTo(2.2);
    expect(paintCenter(node.fills[0]!.gradientTransform!)).toEqual(paintCenter(matrix).map(value => expect.closeTo(value, 12)));
  });
  it("edits crop and tile transforms without changing image identity or other paint metadata", async () => {
    editor.graph.updateNode(node.id, { fills: [{ type: "IMAGE", color, opacity: .4, visible: true, imageHash: "photo", imageScaleMode: "CROP", imageTransform: matrix, blendMode: "MULTIPLY" }] }); await render();
    await numeric("Image 1 center X %", "40"); expect(paintCenter(node.fills[0]!.imageTransform!)[0]).toBeCloseTo(.4);
    await click("Image 1 flip horizontal"); expect(node.fills[0]).toMatchObject({ imageHash: "photo", opacity: .4, blendMode: "MULTIPLY", imageScaleMode: "CROP" });
    const crop = structuredClone(node.fills[0]!.imageTransform!); await select("Image 1 fit", "TILE"); expect(node.fills[0]!.imageTransform).toEqual(crop);
    await click("Image 1 reset geometry"); expect(node.fills[0]!.imageTransform).toBeUndefined(); expect(node.fills[0]!.imageHash).toBe("photo"); editor.undoAction(); await render(); expect(node.fills[0]!.imageTransform).toEqual(crop);
  });
  it("edits individual fill/effect blending and shadow cutout with independent undo", async () => {
    const layerBlend=node.blendMode;
    await select("Fill 1 blend", "SCREEN"); expect(node.fills[0]!.blendMode).toBe("SCREEN"); expect(node.blendMode).toBe(layerBlend);
    await select("Effect 1 blend", "MULTIPLY"); expect(node.effects[0]!.blendMode).toBe("MULTIPLY");
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Effect 1 show behind layer"]')!.click()); await render(); expect(node.effects[0]!.showShadowBehindNode).toBe(false);
    editor.undoAction(); await render(); expect(node.effects[0]!.showShadowBehindNode).toBeUndefined(); expect(node.effects[0]!.blendMode).toBe("MULTIPLY");
    editor.undoAction(); await render(); expect(node.effects[0]!.blendMode).toBeUndefined(); expect(node.fills[0]!.blendMode).toBe("SCREEN");
    editor.graph.updateNode(node.id,{effects:[{...node.effects[0]!,type:"LAYER_BLUR",blendMode:"SCREEN"}]});await render();
    expect(container.querySelector('[aria-label="Effect 1 blend"]')).toBeNull();expect(node.effects[0]!.blendMode).toBe("SCREEN");
  });
  it("preserves imported specialized paints and requires an explicit reset for collapsed transforms", async () => {
    editor.graph.updateNode(node.id, { fills: [{ type: "NOISE", color, opacity: 1, visible: true, noiseType: "DUOTONE", density: .4, noiseSize: { x: 5, y: 6 } }] }); await render();
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Fill 1 type"]')!.value).toBe("NOISE"); await select("Fill 1 blend", "MULTIPLY"); expect(node.fills[0]).toMatchObject({ noiseType: "DUOTONE", density: .4, noiseSize: { x: 5, y: 6 } });
    editor.graph.updateNode(node.id, { fills: [{ type: "GRADIENT_RADIAL", color, opacity: 1, visible: true, gradientTransform: { ...matrix, m00: 0, m10: 0 }, gradientStops: [{ position: 0, color }, { position: 1, color }] }] }); await render();
    expect(container.textContent).toContain("collapsed axis"); expect(container.querySelector('[aria-label="Gradient 1 angle"]')).toBeNull(); await click("Gradient 1 reset geometry"); expect(node.fills[0]!.gradientTransform).toEqual({ m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 });
  });
});
