import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PAINT_TOOL_PREFERENCES_KEY, usePaintToolPreferences } from "./paintToolPreferences";

let container: HTMLDivElement, root: Root, preferences: ReturnType<typeof usePaintToolPreferences>;
function Harness() { preferences = usePaintToolPreferences(); return <span>{preferences.notice}</span>; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.removeItem(PAINT_TOOL_PREFERENCES_KEY); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = () => act(async () => root.render(<Harness/>));
const remount = async () => { await act(async () => root.unmount()); root = createRoot(container); await mount(); };

it("saves valid settings by tool and restores them on reopening without retaining document sources", async () => {
  await mount(); expect(localStorage.getItem(PAINT_TOOL_PREFERENCES_KEY)).toBeNull();
  await act(async () => preferences.setOptions({ "paint.pencil": { mode: "multiply", flow: 35, autoErase: true }, "paint.historyBrush": { mode: "LinearDodge", flow: 65, historySource: "stale-document-source" }, "paint.bucket": { contents: "pattern", pattern: "old-library-id", scale: 150 }, unrelated: { flow: 30 } }));
  await remount(); expect(preferences.options).toEqual({ "paint.pencil": { mode: "Multiply", flow: 35, autoErase: true }, "paint.historyBrush": { mode: "Linear Dodge (Add)", flow: 65 }, "paint.bucket": { contents: "pattern", scale: 150 } }); expect(preferences.notice).toBeNull();
});
it.each(["invalid JSON", JSON.stringify({ schemaVersion: 2, options: { "paint.stroke": { flow: 50 } } }), JSON.stringify({ schemaVersion: 1, options: [] }), " ".repeat(51 * 1024)])("preserves unreadable or newer saved data while permitting session edits", async raw => {
  localStorage.setItem(PAINT_TOOL_PREFERENCES_KEY, raw); await mount(); expect(preferences.options).toEqual({}); expect(container.textContent).toContain("could not be read");
  await act(async () => preferences.setOptions({ "paint.stroke": { flow: 40 } })); expect(preferences.options["paint.stroke"]).toEqual({ flow: 40 }); expect(localStorage.getItem(PAINT_TOOL_PREFERENCES_KEY)).toBe(raw);
});
it("keeps session edits and reports write failure when profile storage is full", async () => {
  await mount(); const saved = JSON.stringify({ schemaVersion: 1, options: {} }); localStorage.setItem(PAINT_TOOL_PREFERENCES_KEY, saved);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  await act(async () => preferences.setOptions({ "paint.stroke": { flow: 30 } })); expect(preferences.options["paint.stroke"]).toEqual({ flow: 30 }); expect(container.textContent).toContain("could not be saved"); expect(localStorage.getItem(PAINT_TOOL_PREFERENCES_KEY)).toBe(saved);
});
it("reports inaccessible profile storage without disabling tools", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  await mount(); await act(async () => preferences.setOptions(previous => ({ ...previous, "select.magicWand": { sampleAllLayers: true } }))); expect(preferences.options["select.magicWand"]).toEqual({ sampleAllLayers: true }); expect(preferences.notice).toContain("this session");
});
it("restores selection/crop controls while excluding draft vertices and modifiers",async()=>{
  await mount();await act(async()=>preferences.setOptions({ellipseSelection:{style:"fixedRatio",ratioWidth:3,ratioHeight:2,feather:2.5,antiAlias:false,fromCenter:true,points:[[1,2],[3,4]] as never},polygonLasso:{feather:3,antiAlias:true,shiftKey:true},"select.quick":{size:18,sampleAllLayers:true,enhanceEdge:true,opacity:.5},crop:{style:"fixedRatio",ratioWidth:16,ratioHeight:9,deleteCroppedPixels:true},"select.object":{sampleAllLayers:true,feather:3}}));await remount();
  expect(preferences.options).toEqual({ellipseSelection:{style:"fixedRatio",ratioWidth:3,ratioHeight:2,feather:2.5,antiAlias:false,fromCenter:true},polygonLasso:{feather:3,antiAlias:true},"select.quick":{size:18,sampleAllLayers:true,enhanceEdge:true},crop:{style:"fixedRatio",ratioWidth:16,ratioHeight:9,deleteCroppedPixels:true},"select.object":{sampleAllLayers:true}});
});

it("persists independent clone/healing transforms with legacy preferences and excludes sampled sources",async()=>{
  localStorage.setItem(PAINT_TOOL_PREFERENCES_KEY,JSON.stringify({schemaVersion:1,options:{"paint.cloneStamp":{aligned:false,flow:65},"paint.healingBrush":{sampleLayer:"all"}}}));
  await mount();expect(preferences.options).toEqual({"paint.cloneStamp":{aligned:false,flow:65},"paint.healingBrush":{sampleLayer:"all"}});
  await act(async()=>preferences.setOptions(previous=>({...previous,"paint.cloneStamp":{...previous["paint.cloneStamp"],transformSource:true,sourceWidth:80,sourceHeight:135,rotation:387.5,flipH:true,flipV:false,source:[4,5] as never},"paint.healingBrush":{...previous["paint.healingBrush"],transformSource:false,sourceWidth:150,sourceHeight:90,rotation:-45,flipH:false,flipV:true,offset:[1,2] as never}})));
  await remount();expect(preferences.options).toEqual({"paint.cloneStamp":{aligned:false,flow:65,transformSource:true,sourceWidth:80,sourceHeight:135,rotation:27.5,flipH:true,flipV:false},"paint.healingBrush":{sampleLayer:"all",transformSource:false,sourceWidth:150,sourceHeight:90,rotation:-45,flipH:false,flipV:true}});
});
