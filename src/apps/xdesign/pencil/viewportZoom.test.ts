import { createEditor } from "@open-pencil/core/editor";
import { describe, expect, it } from "vitest";
import { zoomAroundCenter, zoomToFitPage, zoomToFitSelection } from "./viewportZoom";

const size = { width: 800, height: 600 };
const make = () => createEditor({ getViewportSize: () => size });
const screen = (editor: ReturnType<typeof make>, x: number, y: number) => [x * editor.state.zoom + editor.state.panX, y * editor.state.zoom + editor.state.panY];

describe("design viewport zoom", () => {
  it("fits a small page above 100% and centres it", () => {
    const editor = make(); editor.graph.createNode("RECTANGLE", editor.state.currentPageId, { x: 100, y: 100, width: 10, height: 10 });
    zoomToFitPage(editor, size);
    expect(editor.state.zoom).toBeGreaterThan(1);
    expect(screen(editor, 105, 105).map(v => Math.round(v))).toEqual([400, 300]);
    editor.dispose();
  });
  it("fits the selection above 100% and centres it", () => {
    const editor = make(), page = editor.state.currentPageId;
    editor.graph.createNode("RECTANGLE", page, { x: 0, y: 0, width: 2000, height: 2000 });
    const small = editor.graph.createNode("RECTANGLE", page, { x: 500, y: 700, width: 20, height: 10 });
    editor.select([small.id]); zoomToFitSelection(editor, size);
    expect(editor.state.zoom).toBeGreaterThan(1);
    expect(screen(editor, 510, 705).map(v => Math.round(v))).toEqual([400, 300]);
    editor.dispose();
  });
  it("keeps the canvas point under the viewport centre fixed", () => {
    const editor = make(); Object.assign(editor.state, { panX: -300, panY: -200, zoom: 1 });
    zoomAroundCenter(editor, 2, size);
    expect(editor.state.zoom).toBe(2);
    expect(screen(editor, 700, 500)).toEqual([400, 300]);
    editor.dispose();
  });
});
