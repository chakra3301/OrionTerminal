import { describe, expect, it } from "vitest";
import type { PhotoAction } from "./controls";
import { addBlurPin, blurGeometryMode, insertBlurPathPoint, readBlurGeometry, removeBlurPathPoint, removeBlurPin, setBlurGeometryValue, updateBlurGeometry } from "./blurGeometry";

const action = (structured?: PhotoAction["structured"], id = "filter.test") => ({ id, label: "test", structured } as PhotoAction);

describe("blur geometry", () => {
  it("maps only the supported gallery actions and reads scalar defaults without mutating input", () => {
    expect(blurGeometryMode(action("field"))).toBe("field");
    expect(blurGeometryMode(action(undefined, "filter.blurGallery.tiltShift"))).toBe("tilt");
    expect(blurGeometryMode(action(undefined, "filter.other.custom"))).toBeUndefined();
    const values = { centerX: .25, centerY: .75, blur: 22, marker: { retained: true } };
    const rows = readBlurGeometry("field", values)!;
    expect(rows).toEqual([{ ...values, x: .25, y: .75 }]);
    rows[0]!.marker = {};
    expect(values.marker).toEqual({ retained: true });
  });

  it("moves a field pin in normalized image coordinates while preserving other pin fields", () => {
    const values = { pins: [{ x: .2, y: .4, blur: 7, custom: "keep" }, { x: .8, y: .6, blur: 31 }] };
    const patch = updateBlurGeometry("field", values, { item: 0, kind: "center" }, [.9, .1], 800, 400)!;
    expect(patch).toEqual({ pins: [{ x: .9, y: .1, blur: 7, custom: "keep" }, values.pins[1]] });
    expect(values.pins[0]).toEqual({ x: .2, y: .4, blur: 7, custom: "keep" });
    expect(updateBlurGeometry("field", { centerX: .2, centerY: .4, blur: 7 }, { item: 0, kind: "center" }, [.7, .8], 800, 400)).toEqual({ centerX: .7, centerY: .8 });
    expect(readBlurGeometry("field", { pins: undefined, centerX: .3 })?.[0]).toMatchObject({ x: .3 });
    expect(updateBlurGeometry("field", { pins: undefined, centerX: .3 }, { item: 0, kind: "center" }, [.4, .6], 800, 400)).toEqual({ centerX: .4, centerY: .6 });
  });

  it("measures rotated ellipse handles in native pixel space on a rectangular canvas", () => {
    const values = { pins: [{ x: .5, y: .5, radiusX: .3, radiusY: .2, angle: 90, blur: 15 }] };
    const xRadius = updateBlurGeometry("iris", values, { item: 0, kind: "radiusX" }, [.5, .75], 800, 400)!;
    const yRadius = updateBlurGeometry("iris", values, { item: 0, kind: "radiusY" }, [.75, .5], 800, 400)!;
    expect(xRadius.pins).toEqual([{ ...values.pins[0], radiusX: .25 }]);
    expect(yRadius.pins).toEqual([{ ...values.pins[0], radiusY: .5 }]);
    const angle = updateBlurGeometry("spin", { pins: [{ x: .5, y: .5, radiusX: .3, radiusY: .3, angle: 0, blurAngle: 45 }] }, { item: 0, kind: "angle" }, [.5, .75], 800, 400)!;
    expect((angle.pins as { angle: number }[])[0]!.angle).toBe(90);
    const selectedBounds = updateBlurGeometry("iris", { pins: [{ x: .5, y: .5, radiusX: .2, radiusY: .2, angle: 0 }] }, { item: 0, kind: "radiusX" }, [1.5, .5], 80, 40)!;
    expect((selectedBounds.pins as { radiusX: number }[])[0]!.radiusX).toBe(1);
  });

  it("places iris feather at the native rounded-ellipse distance", () => {
    const values = { pins: [{ x: .5, y: .5, radiusX: .5, radiusY: .25, angle: 0, roundness: 0, feather: .4, blur: 12, note: "preserve" }] };
    const patch = updateBlurGeometry("iris", values, { item: 0, kind: "feather" }, [.625, .5], 800, 400)!;
    expect(patch.pins).toEqual([{ ...values.pins[0], feather: .5 }]);
    expect(setBlurGeometryValue("iris", values, 0, "feather", 4)!.pins).toEqual([{ ...values.pins[0], feather: .99 }]);
  });

  it("updates path vertices without flattening paths or losing imported metadata", () => {
    const values = { paths: [{ points: [[.1, .2], [.5, .5], [.9, .8]], speed: 10, taper: 20, custom: "a" }, { points: [[.3, .2], [.6, .7]], speed: 30, taper: 2, custom: "b" }] };
    const patch = updateBlurGeometry("paths", values, { item: 0, kind: "point", point: 1 }, [.55, .45], 200, 100)!;
    expect(patch).toEqual({ paths: [{ ...values.paths[0], points: [[.1, .2], [.55, .45], [.9, .8]] }, values.paths[1]] });
    expect(setBlurGeometryValue("paths", values, 1, "strength", 80)).toEqual({ paths: [values.paths[0], { ...values.paths[1], speed: 80 }] });
    const partial = { paths: [{ points: [[.1, .2], [.9, .8]], x: "metadata" }, { points: [[.2, .1], [.8, .9]], marker: 3 }] };
    expect(setBlurGeometryValue("paths", partial, 0, "strength", 40)).toEqual({ paths: [{ ...partial.paths[0], speed: 40 }, partial.paths[1]] });
    expect(updateBlurGeometry("paths", partial, { item: 0, kind: "point", point: 1 }, [-.2, 1.4], 200, 100)).toEqual({ paths: [{ ...partial.paths[0], points: [[.1, .2], [0, 1]] }, partial.paths[1]] });
    const scalar = updateBlurGeometry("paths", { startX: .2, startY: .3, endX: .8, endY: .7, speed: 15 }, { item: 0, kind: "point", point: 1 }, [.6, .4], 200, 100)!;
    expect(scalar).toEqual({ endX: .6, endY: .4 });
    expect(readBlurGeometry("paths", { paths: [{ points: [[.1, .2], [.9, .8]] }] })?.[0]).toMatchObject({ speed: 50, taper: 0 });
  });

  it("uses tilt shift's native normal projection for angle, focus, and transition", () => {
    const values = { centerX: .5, centerY: .5, angle: 0, blur: 40, focus: .1, transition: .2, custom: 9 };
    expect(updateBlurGeometry("tilt", values, { item: 0, kind: "angle" }, [.75, .5], 800, 400)).toEqual({ angle: 0 });
    expect(updateBlurGeometry("tilt", values, { item: 0, kind: "focus" }, [.5, .75], 800, 400)).toEqual({ focus: .25 });
    expect(updateBlurGeometry("tilt", values, { item: 0, kind: "transition" }, [.5, .75], 800, 400)).toEqual({ transition: .15 });
    expect(setBlurGeometryValue("tilt", values, 0, "strength", 900)).toEqual({ blur: 500 });
  });

  it("refuses malformed and oversized imported geometry instead of truncating it", () => {
    expect(readBlurGeometry("field", { pins: "bad" })).toBeUndefined();
    expect(readBlurGeometry("field", { pins: [] })).toBeUndefined();
    expect(readBlurGeometry("iris", { pins: [{ x: .5, y: .5, radiusX: -1 }] })).toBeUndefined();
    expect(readBlurGeometry("paths", { paths: [{ points: [[0, 0]] }] })).toBeUndefined();
    expect(readBlurGeometry("paths", { paths: [] })).toBeUndefined();
    expect(readBlurGeometry("spin", { pins: undefined, centerY: "bad" })).toBeUndefined();
    expect(readBlurGeometry("paths", { paths: Array(257).fill({ points: [[0, 0], [1, 1]] }) })).toBeUndefined();
    expect(updateBlurGeometry("spin", { pins: [{ x: .5, y: .5 }] }, { item: 0, kind: "center" }, [0, 0], 0, 100)).toBeUndefined();
    expect(setBlurGeometryValue("field", { pins: [{ x: .5, y: .5 }] }, 3, "strength", 10)).toBeUndefined();
    expect(readBlurGeometry("field", { centerX: "bad" })).toBeUndefined();
  });

  it("adds pins from scalar defaults or a selected list pin without changing the source", () => {
    const scalar = { centerX: .2, centerY: .6, blur: 24, unused: "not a native pin field" };
    expect(addBlurPin("field", scalar, 0, [1.2, -.2])).toEqual({ patch: { pins: [{ x: .2, y: .6, blur: 24 }, { x: 1, y: 0, blur: 24 }] }, selected: 1 });
    expect(scalar).toEqual({ centerX: .2, centerY: .6, blur: 24, unused: "not a native pin field" });
    const listed = { pins: [{ x: .1, y: .2, blur: 5, extra: { keep: 1 } }, { x: .6, y: .7, blur: 9, tag: "selected" }] };
    expect(addBlurPin("field", listed, 1, [.3, .4])).toEqual({ patch: { pins: [...listed.pins, { ...listed.pins[1], x: .3, y: .4 }] }, selected: 2 });
    expect(listed.pins).toHaveLength(2);
    expect(addBlurPin("field", { pins: Array(256).fill({ x: .5, y: .5 }) }, 0, [.5, .5])).toBeUndefined();
    expect(addBlurPin("field", scalar, 0, [Number.NaN, .5])).toBeUndefined();
  });

  it("removes only from valid multi-pin lists and refuses native scalar fallback cases", () => {
    const values = { pins: [{ x: .1, y: .2, blur: 2, meta: "first" }, { x: .5, y: .5, blur: 5 }, { x: .9, y: .8, blur: 8 }] };
    expect(removeBlurPin("field", values, 1)).toEqual({ patch: { pins: [values.pins[0], values.pins[2]] }, selected: 1 });
    expect(removeBlurPin("field", { pins: [{ x: .5, y: .5 }] }, 0)).toBeUndefined();
    expect(removeBlurPin("field", { centerX: .5 }, 0)).toBeUndefined();
    expect(removeBlurPin("field", { pins: [] }, 0)).toBeUndefined();
  });

  it("inserts a path point on the physically closest segment and converts scalar paths losslessly", () => {
    const values = { paths: [{ points: [[0, 0], [.4, 0], [.4, 1]], speed: 12, taper: 3, meta: "keep" }, { points: [[.1, .1], [.9, .9]], speed: 30, custom: true }] };
    const inserted = insertBlurPathPoint(values, 0, [.3, .2], 400, 100)!;
    expect(inserted.point).toBe(1); // Pixel distance favors the horizontal segment; normalized distance would favor the vertical segment.
    expect(inserted.patch).toEqual({ paths: [{ ...values.paths[0], points: [[0, 0], [.3, .2], [.4, 0], [.4, 1]] }, values.paths[1]] });
    const scalar = { startX: .2, startY: .4, endX: .8, endY: .6, speed: 20, taper: 8, sourceMeta: "preserve" };
    expect(insertBlurPathPoint(scalar, 0, [.5, .5], 200, 100)).toEqual({ patch: { paths: [{ ...scalar, points: [[.2, .4], [.5, .5], [.8, .6]] }] }, point: 1 });
    expect(insertBlurPathPoint(scalar, 0, [Infinity, .5], 200, 100)).toBeUndefined();
    expect(insertBlurPathPoint(scalar, 0, [.5, .5], 0, 100)).toBeUndefined();
    expect(insertBlurPathPoint({ paths: [{ points: Array(256).fill([.5, .5]) }] }, 0, [.6, .6], 100, 100)).toBeUndefined();
  });

  it("removes path vertices only while two or more remain and preserves other path data", () => {
    const values = { paths: [{ points: [[.1, .2], [.5, .5], [.9, .8]], speed: 6, taper: 4, meta: 9 }, { points: [[.2, .2], [.8, .8]], custom: "untouched" }] };
    expect(removeBlurPathPoint(values, 0, 1)).toEqual({ paths: [{ ...values.paths[0], points: [[.1, .2], [.9, .8]] }, values.paths[1]] });
    expect(removeBlurPathPoint(values, 0, 3)).toBeUndefined();
    expect(removeBlurPathPoint({ paths: [{ points: [[.1, .1], [.9, .9]] }] }, 0, 0)).toBeUndefined();
    expect(removeBlurPathPoint({ startX: .2, endX: .8 }, 0, 0)).toBeUndefined();
  });
});
