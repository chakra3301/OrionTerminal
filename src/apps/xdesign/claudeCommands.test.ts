import { describe, expect, it, beforeEach } from "vitest";
import { useXDesign } from "@/apps/xdesign/store";
import { runCanvasCommands } from "@/apps/xdesign/claudeCommands";

type Ops = Parameters<typeof runCanvasCommands>[0];

describe("runCanvasCommands — batch undo collapse", () => {
  beforeEach(() => {
    // Reset to a clean single-page doc so page tests don't leak across runs.
    useXDesign.setState({
      shapes: [],
      pages: [{ id: "test-page", name: "Page 1", shapes: [], past: [], future: [] }],
      activePageId: "test-page",
      past: [],
      future: [],
      coalesce: null,
      selection: new Set<string>(),
    });
  });

  it("applies a multi-op batch as a SINGLE history entry", () => {
    const outcome = runCanvasCommands([
      { action: "addFrame", x: 0, y: 0, w: 200, h: 120 },
      { action: "addText", x: 10, y: 10, text: "Hi" },
    ] as Ops);
    expect(outcome.applied).toBe(2);
    expect(outcome.newIds).toHaveLength(2);
    expect(useXDesign.getState().shapes).toHaveLength(2);
    // The whole batch is ONE undo step — not one entry per op (the bug).
    expect(useXDesign.getState().past).toHaveLength(1);
  });

  it("one undo reverts the entire batch", () => {
    runCanvasCommands([
      { action: "addRect", x: 0, y: 0, w: 50, h: 50 },
      { action: "addRect", x: 60, y: 0, w: 50, h: 50 },
      { action: "addRect", x: 120, y: 0, w: 50, h: 50 },
    ] as Ops);
    expect(useXDesign.getState().shapes).toHaveLength(3);
    useXDesign.getState().undo();
    expect(useXDesign.getState().shapes).toHaveLength(0);
  });

  it("returns the new id for add ops", () => {
    const { results } = runCanvasCommands([
      { action: "addRect", x: 0, y: 0, w: 10, h: 10 },
    ] as Ops);
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(typeof results[0]!.id).toBe("string");
  });

  it("reports ok:false for an unknown action without dropping the rest", () => {
    const { applied, results } = runCanvasCommands([
      { action: "addRect", x: 0, y: 0, w: 10, h: 10 },
      { action: "bogus" },
    ] as Ops);
    expect(applied).toBe(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
  });

  it("leaves history untouched for a no-op (select-only) batch", () => {
    useXDesign.setState({ past: [], future: [] });
    runCanvasCommands([{ action: "select", ids: [] }] as Ops);
    expect(useXDesign.getState().past).toHaveLength(0);
  });

  it("coalesces MULTIPLE batches in a turn into one undo step", () => {
    useXDesign.getState().beginHistoryCoalesce();
    // Simulate an agent making two separate apply calls in one turn.
    runCanvasCommands([{ action: "addRect", x: 0, y: 0, w: 50, h: 50 }] as Ops);
    runCanvasCommands([{ action: "addText", x: 0, y: 0, text: "Hi" }] as Ops);
    useXDesign.getState().endHistoryCoalesce();

    expect(useXDesign.getState().shapes).toHaveLength(2);
    // Both calls collapse to ONE entry (the turn baseline), not two.
    expect(useXDesign.getState().past).toHaveLength(1);
    // A single undo reverts the whole turn.
    useXDesign.getState().undo();
    expect(useXDesign.getState().shapes).toHaveLength(0);
  });

  it("reverts to per-batch undo after the turn ends", () => {
    useXDesign.getState().beginHistoryCoalesce();
    runCanvasCommands([{ action: "addRect", x: 0, y: 0, w: 50, h: 50 }] as Ops);
    useXDesign.getState().endHistoryCoalesce();
    // Outside coalescing, a second batch is its own undo step.
    runCanvasCommands([{ action: "addRect", x: 60, y: 0, w: 50, h: 50 }] as Ops);
    expect(useXDesign.getState().past).toHaveLength(2);
  });

  it("group wraps shapes in a frame and returns its id", () => {
    const add = runCanvasCommands([
      { action: "addRect", x: 0, y: 0, w: 40, h: 40 },
      { action: "addRect", x: 50, y: 0, w: 40, h: 40 },
    ] as Ops);
    const ids = add.newIds;
    const { results } = runCanvasCommands([
      { action: "group", ids },
    ] as Ops);
    expect(results[0]!.ok).toBe(true);
    expect(typeof results[0]!.id).toBe("string");
    const frame = useXDesign
      .getState()
      .shapes.find((s) => s.id === results[0]!.id);
    expect(frame?.kind).toBe("frame");
  });

  it("reparent nests a shape under a frame", () => {
    const { newIds } = runCanvasCommands([
      { action: "addFrame", x: 0, y: 0, w: 200, h: 200 },
      { action: "addRect", x: 10, y: 10, w: 40, h: 40 },
    ] as Ops);
    const [frameId, rectId] = newIds;
    runCanvasCommands([
      { action: "reparent", id: rectId, parentId: frameId },
    ] as Ops);
    const rect = useXDesign.getState().shapes.find((s) => s.id === rectId);
    expect(rect?.parentId).toBe(frameId);
  });

  it("moving a frame via update carries its children (no orphans)", () => {
    const { newIds } = runCanvasCommands([
      { action: "addFrame", x: 0, y: 0, w: 200, h: 200 },
      { action: "addRect", x: 20, y: 20, w: 40, h: 40 },
    ] as Ops);
    const [frameId, rectId] = newIds;
    runCanvasCommands([
      { action: "reparent", id: rectId, parentId: frameId },
    ] as Ops);
    // Move the frame +300 in x — the child must move with it.
    runCanvasCommands([{ action: "update", id: frameId, x: 300 }] as Ops);
    const shapes = useXDesign.getState().shapes;
    expect(shapes.find((s) => s.id === frameId)!.x).toBe(300);
    expect(shapes.find((s) => s.id === rectId)!.x).toBe(320); // 20 + 300 delta
  });

  it("createInstance places its whole subtree at the given position", () => {
    const { newIds } = runCanvasCommands([
      { action: "addFrame", x: 0, y: 0, w: 100, h: 100 },
      { action: "addRect", x: 10, y: 10, w: 20, h: 20 },
    ] as Ops);
    const [frameId, rectId] = newIds;
    runCanvasCommands([
      { action: "reparent", id: rectId, parentId: frameId },
      { action: "makeComponent", id: frameId },
    ] as Ops);
    const { results } = runCanvasCommands([
      { action: "createInstance", mainId: frameId, x: 500, y: 0 },
    ] as Ops);
    const instId = results[0]!.id!;
    const shapes = useXDesign.getState().shapes;
    const inst = shapes.find((s) => s.id === instId)!;
    expect(inst.x).toBe(500);
    // The instance's cloned child sits at the same +500 offset, not left behind.
    const child = shapes.find((s) => s.parentId === instId)!;
    expect(child.x).toBe(510); // 10 + 500 delta
  });

  it("duplicate returns new shape ids and adds them", () => {
    const { newIds } = runCanvasCommands([
      { action: "addRect", x: 0, y: 0, w: 10, h: 10 },
    ] as Ops);
    const before = useXDesign.getState().shapes.length;
    const { results } = runCanvasCommands([
      { action: "duplicate", ids: newIds },
    ] as Ops);
    expect(useXDesign.getState().shapes.length).toBe(before + 1);
    expect(results[0]!.ok).toBe(true);
    expect(typeof results[0]!.id).toBe("string");
  });

  it("addPage switches the active page and does not corrupt undo", () => {
    const { newIds } = runCanvasCommands([
      { action: "addRect", x: 0, y: 0, w: 10, h: 10 },
    ] as Ops);
    const page1 = useXDesign.getState().activePageId;
    const rectId = newIds[0];
    // New page in its own call (the recommended pattern).
    const { results } = runCanvasCommands([{ action: "addPage" }] as Ops);
    const page2 = results[0]!.id!;
    expect(useXDesign.getState().activePageId).toBe(page2);
    expect(page2).not.toBe(page1);
    // The new page is empty; page-1's rect must NOT have leaked onto it.
    expect(useXDesign.getState().shapes.length).toBe(0);
    // Switch back — page 1 still has its rect intact.
    runCanvasCommands([{ action: "switchPage", id: page1 }] as Ops);
    expect(useXDesign.getState().shapes.find((s) => s.id === rectId)).toBeTruthy();
  });

  it("undo is per-page — undoing on page 2 never touches page 1", () => {
    const page1 = useXDesign.getState().activePageId;
    runCanvasCommands([{ action: "addRect", x: 0, y: 0, w: 10, h: 10 }] as Ops);
    expect(useXDesign.getState().shapes).toHaveLength(1);
    // New page, add a shape there.
    const { results } = runCanvasCommands([{ action: "addPage" }] as Ops);
    const page2 = results[0]!.id!;
    runCanvasCommands([{ action: "addRect", x: 0, y: 0, w: 10, h: 10 }] as Ops);
    expect(useXDesign.getState().shapes).toHaveLength(1);
    // Undo on page 2 removes page-2's shape only.
    useXDesign.getState().undo();
    expect(useXDesign.getState().shapes).toHaveLength(0);
    // Page 1 is untouched — still has its rect.
    useXDesign.getState().switchPage(page1);
    expect(useXDesign.getState().shapes).toHaveLength(1);
    expect(useXDesign.getState().activePageId).toBe(page1);
    void page2;
  });

  it("a new page starts with an empty (own) undo stack", () => {
    runCanvasCommands([{ action: "addRect", x: 0, y: 0, w: 10, h: 10 }] as Ops);
    expect(useXDesign.getState().past.length).toBe(1);
    runCanvasCommands([{ action: "addPage" }] as Ops);
    // Now on the new page: its history is fresh, not inherited from page 1.
    expect(useXDesign.getState().past.length).toBe(0);
  });

  it("addVariable returns a NON-shape id without selecting it", () => {
    useXDesign.setState({ selection: new Set<string>() });
    const { results } = runCanvasCommands([
      { action: "addVariable", name: "brand", value: "#39ff88" },
    ] as Ops);
    expect(results[0]!.ok).toBe(true);
    expect(typeof results[0]!.id).toBe("string");
    // The variable id must NOT have been added to the shape selection.
    expect(useXDesign.getState().selection.has(results[0]!.id!)).toBe(false);
  });
});
