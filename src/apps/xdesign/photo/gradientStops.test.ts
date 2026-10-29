import { describe, expect, it } from "vitest";
import { bakeGradient, bakeRemembered } from "./gradientMethod";
import { addedMidpoints, editorDiamonds, lineLocation, linePoint, midpointLocation, movedMidpoints, removedMidpoints, segmentFraction, shownWidget, stopCommand, stopEdit, stopTarget, stopWidget, withMidpoint } from "./gradientStops";
import type { GradientFill } from "./types";

const fill = (patch: Partial<GradientFill> = {}): GradientFill => ({ style: "linear", angle: 0, scale: 100, offset: [0, 0], reverse: false, dither: false, align: true, from: [100, 100], to: [300, 100], stops: [[0, "#000000"], [1, "#ffffff"]], transparency: [], midpoints: [], ...patch });
const three = fill({ stops: [[1, "#0000ff"], [0, "#ff0000"], [.5, "#00ff00"]], midpoints: [.5, .25, .8] });

describe("live gradient stops on the canvas", () => {
  it("sorts the fill's colour stops as the engine indexes them, each with the midpoint of the segment after it", () => {
    expect(stopWidget(three)).toEqual({ from: [100, 100], to: [300, 100], reverse: false, method: null, stops: [
      { location: 0, color: "#ff0000", midpoint: .25 }, { location: .5, color: "#00ff00", midpoint: .8 }, { location: 1, color: "#0000ff", midpoint: .5 }] });
    expect(stopWidget(fill()).stops.map(stop => stop.midpoint)).toEqual([.5, .5]);
    const plain: [number, string][] = [[0, "#112233"], [.4, "#ff8800"], [1, "#ffffff"]];
    expect(stopWidget(fill({ stops: bakeRemembered(plain, "perceptual")! }))).toMatchObject({ method: "perceptual", stops: plain.map(([location, color]) => ({ location, color, midpoint: .5 })) });
  });

  it("places locations along the line from start to end, flipped when reversed", () => {
    const widget = stopWidget(fill()), reversed = stopWidget(fill({ reverse: true }));
    expect(linePoint(widget, .25)).toEqual([150, 100]);
    expect(linePoint(reversed, .25)).toEqual([250, 100]);
    expect(lineLocation(widget, [150, 110])).toEqual({ location: .25, away: 10 });
    expect(lineLocation(reversed, [150, 90])).toEqual({ location: .75, away: 10 });
    expect(lineLocation(widget, [400, 100])).toEqual({ location: 1, away: 0 });
    expect(lineLocation(stopWidget(fill({ to: [100, 100] })), [100, 100])).toBeNull();
  });

  it("hits a stop before its midpoint diamond and either before the line, and nothing off the line or past its ends", () => {
    const widget = stopWidget(three);
    expect(stopTarget(widget, [203, 104], 6)).toEqual({ kind: "stop", index: 1 });
    expect(stopTarget(widget, [99, 100], 6)).toEqual({ kind: "stop", index: 0 });
    expect(stopTarget(widget, [125, 102], 6)).toEqual({ kind: "midpoint", index: 0 });
    expect(stopTarget(widget, [280, 100], 6)).toEqual({ kind: "midpoint", index: 1 });
    expect(stopTarget(widget, [160, 105], 6)).toEqual({ kind: "line", location: .3 });
    expect(stopTarget(widget, [160, 107], 6)).toBeNull();
    expect(stopTarget(widget, [320, 100], 6)).toBeNull();
    expect(stopTarget(stopWidget(fill({ stops: bakeRemembered([[0, "#000000"], [1, "#ffffff"]], "linear")! })), [200, 100], 6)).toEqual({ kind: "line", location: .5 });
  });

  it("adds on a click on the line, moves a dragged stop, removes one dragged off the line, and moves a dragged midpoint", () => {
    const widget = stopWidget(three);
    expect(stopEdit(widget, { kind: "line", location: .3 }, [160, 100], [162, 101], 6)).toEqual({ action: "add", location: .3 });
    expect(stopEdit(widget, { kind: "line", location: .3 }, [160, 100], [190, 100], 6)).toBeNull();
    expect(stopEdit(widget, { kind: "stop", index: 1 }, [200, 100], [203, 102], 6)).toBeNull();
    expect(stopEdit(widget, { kind: "stop", index: 1 }, [200, 100], [250.123, 110], 6)).toEqual({ action: "move", index: 1, location: .751 });
    expect(stopEdit(widget, { kind: "stop", index: 1 }, [200, 100], [400, 100], 6)).toEqual({ action: "move", index: 1, location: 1 });
    expect(stopEdit(widget, { kind: "stop", index: 0 }, [100, 100], [40, 100], 6)).toBeNull();
    expect(stopEdit(widget, { kind: "stop", index: 0 }, [100, 100], [130, 100], 6)).toEqual({ action: "move", index: 0, location: .15 });
    expect(stopEdit(widget, { kind: "stop", index: 1 }, [200, 100], [200, 125], 6)).toEqual({ action: "delete", index: 1 });
    expect(stopEdit(stopWidget(fill()), { kind: "stop", index: 1 }, [300, 100], [290, 140], 6)).toEqual({ action: "move", index: 1, location: .95 });
    expect(stopEdit(widget, { kind: "midpoint", index: 0 }, [125, 100], [175, 100], 6)).toEqual({ action: "midpoint", index: 0, location: .75 });
    expect(stopEdit(widget, { kind: "midpoint", index: 1 }, [280, 100], [400, 100], 6)).toEqual({ action: "midpoint", index: 1, location: .95 });
    expect(stopEdit(widget, { kind: "midpoint", index: 0 }, [125, 100], [126, 100], 6)).toBeNull();
  });

  it("shows a drag before it commits: the stop or diamond where it is going, a stop on its way off the line as leaving", () => {
    const widget = stopWidget(three);
    expect(shownWidget(widget, null)).toEqual({ ...widget, leaving: null });
    expect(shownWidget(widget, { action: "move", index: 1, location: .7 }).stops.map(stop => stop.location)).toEqual([0, .7, 1]);
    expect(shownWidget(widget, { action: "midpoint", index: 0, location: .6 }).stops.map(stop => stop.midpoint)).toEqual([.6, .8, .5]);
    expect(shownWidget(widget, { action: "delete", index: 2 })).toEqual({ ...widget, leaving: 2 });
    expect(shownWidget(widget, { action: "add", location: .3 })).toEqual({ ...widget, leaving: null });
  });

  it("sends a fill's own stops as one gradient.fill.stop and a baked Method's stops as one re-baked gradient.fill.set", () => {
    const own = fill({ stops: [[0, "#00000080"], [1, "#ffffff"]] });
    expect(stopCommand(own, { action: "add", location: .3 }, 7)).toEqual({ id: "gradient.fill.stop", params: { layer: 7, kind: "color", action: "add", location: .3 } });
    expect(stopCommand(own, { action: "color", index: 0, color: "#123456" }, 7)).toEqual({ id: "gradient.fill.stop", params: { layer: 7, kind: "color", action: "color", index: 0, color: "#12345680" } });
    expect(stopCommand(own, { action: "midpoint", index: 0, location: .2 }, 7)).toEqual({ id: "gradient.fill.stop", params: { layer: 7, kind: "color", action: "midpoint", index: 0, location: .2 } });
    const plain: [number, string][] = [[0, "#000000"], [.5, "#ff0000"], [1, "#ffffff"]], baked = fill({ stops: bakeRemembered(plain, "linear")! });
    expect(stopCommand(baked, { action: "move", index: 1, location: .25 }, 7)).toEqual({ id: "gradient.fill.set", params: { layer: 7, stops: bakeGradient([[0, "#000000"], [.25, "#ff0000"], [1, "#ffffff"]], "linear") } });
    expect(stopCommand(baked, { action: "delete", index: 1 }, 7)).toEqual({ id: "gradient.fill.set", params: { layer: 7, stops: bakeGradient([[0, "#000000"], [1, "#ffffff"]], "linear") } });
    expect(stopCommand(baked, { action: "color", index: 2, color: "#00ff00" }, 7)).toEqual({ id: "gradient.fill.set", params: { layer: 7, stops: bakeGradient([[0, "#000000"], [.5, "#ff0000"], [1, "#00ff00"]], "linear") } });
    expect(stopCommand(baked, { action: "add", location: 1 }, 7)).toEqual({ id: "gradient.fill.set", params: { layer: 7, stops: bakeGradient([[0, "#000000"], [.5, "#ff0000"], [1, "#ffffff"], [1, "#ffffff"]], "linear") } });
    expect(stopCommand(baked, { action: "midpoint", index: 0, location: .3 }, 7)).toBeNull();
  });
});

describe("Gradient Editor colour midpoints", () => {
  const at = [0, .5, 1];
  it("keeps one midpoint per segment as the engine does, none stored when all sit at 50%", () => {
    expect(midpointLocation(at, [.25, .8], 0)).toBe(.125);
    expect(midpointLocation(at, [], 1)).toBe(.75);
    expect(withMidpoint(3, [], 1, .3)).toEqual([.5, .3]);
    expect(withMidpoint(3, [.5, .3], 1, .5)).toEqual([]);
    expect(withMidpoint(3, [], 0, .99)).toEqual([.95, .5]);
    expect(withMidpoint(3, [], 0, .01234)).toEqual([.05, .5]);
    expect(segmentFraction(at, 1, .6)).toBe(.2);
    expect(segmentFraction(at, 0, .9)).toBe(.95);
  });

  it("carries each midpoint with the stop before it when a stop moves, resets the split segment on add, and drops it with its stop", () => {
    expect(movedMidpoints(at, [.25, .8], 2, .75)).toEqual([.25, .8]);
    expect(movedMidpoints(at, [.25, .8], 0, .75)).toEqual([.8, .25]);
    expect(addedMidpoints(at, [.25, .8], .7)).toEqual([.25, .5, .5]);
    expect(addedMidpoints(at, [.25, .8], 0)).toEqual([.5, .5, .8]);
    expect(addedMidpoints([0, 1], [], .5)).toEqual([]);
    expect(removedMidpoints(3, [.25, .8], 0)).toEqual([.8]);
    expect(removedMidpoints(3, [.25, .8], 2)).toEqual([.25]);
    expect(removedMidpoints(3, [.25, .5], 0)).toEqual([]);
  });

  it("shows the diamonds either side of the selected colour stop and the selected diamond, on segments of some length", () => {
    expect(editorDiamonds(at, 1, null)).toEqual([0, 1]);
    expect(editorDiamonds(at, 0, null)).toEqual([0]);
    expect(editorDiamonds(at, 2, 1)).toEqual([1]);
    expect(editorDiamonds([0, 0, 1], 1, null)).toEqual([1]);
    expect(editorDiamonds(at, null, null)).toEqual([]);
  });
});
