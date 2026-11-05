import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuideDialogs, ViewAids } from "./viewAids";
import { DEFAULT_FLAGS, useViewAids } from "./viewGuides";

let root: Root, container: HTMLDivElement, stage: HTMLDivElement, image: HTMLDivElement;
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
const stageRef = createRef<HTMLDivElement>(), imageRef = createRef<HTMLDivElement>();
const guides = () => useViewAids.getState().documents.doc ?? [];

const mount = async (moveTool = false, zoom = 1) => act(async () => root.render(<ViewAids stage={stageRef} image={imageRef} docId="doc" width={800} height={600} zoom={zoom} moveTool={moveTool}/>));
const fire = (target: Element, type: string, init: MouseEventInit = {}) => act(async () => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...init })); });
const topRuler = () => container.querySelector(".xd-view-ruler.is-top")!;
const leftRuler = () => container.querySelector(".xd-view-ruler.is-left")!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useViewAids.setState({ flags: { ...DEFAULT_FLAGS, snap: false }, documents: {}, dialog: null, next: 1 });
  stage = document.createElement("div"); image = document.createElement("div");
  document.body.append(stage, image);
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(rect(100, 50, 600, 400));
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(128, 78, 800, 600));
  Object.defineProperty(stage, "clientWidth", { value: 600 }); Object.defineProperty(stage, "clientHeight", { value: 400 });
  (stageRef as { current: HTMLDivElement | null }).current = stage; (imageRef as { current: HTMLDivElement | null }).current = image;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); stage.remove(); image.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("rulers", () => {
  it("show only while Rulers is on", async () => {
    await mount();
    expect(topRuler()).toBeNull();
    await act(async () => useViewAids.getState().setFlags({ rulers: true }));
    expect(topRuler()).not.toBeNull(); expect(leftRuler()).not.toBeNull();
    await act(async () => useViewAids.getState().setFlags({ rulers: false }));
    expect(topRuler()).toBeNull();
  });
  it("creates a horizontal guide by dragging from the top ruler and moves it with the pointer", async () => {
    useViewAids.getState().setFlags({ rulers: true });
    await mount();
    await fire(topRuler(), "pointerdown", { clientX: 300, clientY: 140 });
    expect(guides()).toEqual([{ id: 1, axis: "h", pos: 62 }]);
    await fire(topRuler(), "pointermove", { clientX: 300, clientY: 178 });
    expect(guides()[0]!.pos).toBe(100);
    await fire(topRuler(), "pointerup", { clientX: 300, clientY: 178 });
    expect(guides()).toHaveLength(1);
  });
  it("uses the left ruler for vertical guides and Alt flips the orientation", async () => {
    useViewAids.getState().setFlags({ rulers: true });
    await mount();
    await fire(leftRuler(), "pointerdown", { clientX: 228, clientY: 200 });
    await fire(leftRuler(), "pointerup", { clientX: 228, clientY: 200 });
    await fire(topRuler(), "pointerdown", { clientX: 328, clientY: 200, altKey: true });
    await fire(topRuler(), "pointerup", { clientX: 328, clientY: 200 });
    expect(guides().map(({ axis, pos }) => [axis, pos])).toEqual([["v", 100], ["v", 200]]);
  });
  it("deletes a guide released back on its ruler, and none are created while locked", async () => {
    useViewAids.getState().setFlags({ rulers: true });
    await mount();
    await fire(topRuler(), "pointerdown", { clientX: 300, clientY: 178 });
    await fire(topRuler(), "pointermove", { clientX: 300, clientY: 60 });
    await fire(topRuler(), "pointerup", { clientX: 300, clientY: 60 });
    expect(guides()).toEqual([]);
    await act(async () => useViewAids.getState().setFlags({ lockGuides: true }));
    await fire(topRuler(), "pointerdown", { clientX: 300, clientY: 178 });
    expect(guides()).toEqual([]);
  });
  it("follows zoom: a guide dragged at 200% lands at half the screen distance", async () => {
    useViewAids.getState().setFlags({ rulers: true });
    await mount(false, 2);
    await fire(topRuler(), "pointerdown", { clientX: 300, clientY: 278 });
    expect(guides()[0]!.pos).toBe(100);
  });
  it("snaps a dragged guide to the document bounds when Snap is on", async () => {
    useViewAids.getState().setFlags({ rulers: true, snap: true });
    await mount();
    await fire(topRuler(), "pointerdown", { clientX: 300, clientY: 82 });
    expect(guides()[0]!.pos).toBe(0);
  });
});

describe("moving guides", () => {
  const seed = () => { useViewAids.getState().newGuide("doc", "v", 100); };
  const hit = () => container.querySelector(".xd-view-guide-hit");
  it("needs the Move tool or the Command key, and respects Lock Guides", async () => {
    seed(); await mount();
    expect(hit()).toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { metaKey: true })); });
    expect(hit()).not.toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keyup", { metaKey: false })); });
    expect(hit()).toBeNull();
    await mount(true);
    expect(hit()).not.toBeNull();
    await act(async () => useViewAids.getState().setFlags({ lockGuides: true }));
    expect(hit()).toBeNull();
  });
  it("drags with the Move tool, and drops onto the ruler to delete", async () => {
    useViewAids.getState().setFlags({ rulers: true });
    seed(); await mount(true);
    await fire(hit()!, "pointerdown", { clientX: 228, clientY: 300 });
    await fire(hit()!, "pointermove", { clientX: 328, clientY: 300 });
    expect(guides()[0]!.pos).toBe(200);
    await fire(hit()!, "pointermove", { clientX: 105, clientY: 300 });
    await fire(hit()!, "pointerup", { clientX: 105, clientY: 300 });
    expect(guides()).toEqual([]);
  });
  it("hides guides and the hit strips when Extras or Guides is off", async () => {
    seed(); await mount(true);
    await act(async () => useViewAids.getState().setFlags({ extras: false }));
    expect(hit()).toBeNull();
    await act(async () => useViewAids.getState().setFlags({ extras: true, guides: false }));
    expect(hit()).toBeNull();
  });
});

describe("guide dialogs", () => {
  const field = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const type = (label: string, value: string) => act(async () => { const el = field(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
  const submit = () => act(async () => { container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });
  const open = async (dialog: "new" | "layout") => { await act(async () => root.render(<GuideDialogs docId="doc" width={800} height={600}/>)); await act(async () => useViewAids.getState().setDialog(dialog)); };

  it("New Guide adds a guide with the chosen orientation and position", async () => {
    await open("new");
    expect(container.querySelector('[role="dialog"][aria-label="New Guide"]')).not.toBeNull();
    expect(field("Vertical").checked).toBe(true);
    await act(async () => field("Horizontal").click());
    await type("Position", "150");
    await submit();
    expect(guides()).toEqual([{ id: 1, axis: "h", pos: 150 }]);
    expect(useViewAids.getState().dialog).toBeNull();
  });
  it("New Guide refuses a position outside the document", async () => {
    await open("new");
    await type("Position", "900");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
  it("New Guide Layout adds column, row and margin guides and can clear the old ones", async () => {
    useViewAids.getState().newGuide("doc", "h", 7);
    await open("layout");
    await type("Columns number", "2"); await type("Columns gutter", "20");
    await type("Margin left", "10"); await type("Margin right", "10");
    await act(async () => field("Clear Existing Guides").click());
    await submit();
    expect(guides().map(g => [g.axis, g.pos])).toEqual([["v", 10], ["v", 790], ["v", 10], ["v", 390], ["v", 410], ["v", 790]].filter((_, i, all) => all.findIndex(o => o[1] === all[i]![1]) === i));
  });
});
