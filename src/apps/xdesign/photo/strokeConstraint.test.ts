import { describe, expect, it } from "vitest";
import { constrain, snap45, type Axis, type XY } from "./strokeConstraint";

const close = (a: XY, b: XY) => { expect(a[0]).toBeCloseTo(b[0], 6); expect(a[1]).toBeCloseTo(b[1], 6); };

describe("Shift stroke constraint", () => {
  it("snaps gradients to 45° and locks painting strokes once the pointer leaves the lock distance", () => {
    const o: XY = [10, 10];
    close(snap45(o, [50, 13]), [50, 10]);
    close(snap45(o, [12, -40]), [10, -40]);
    const d = snap45(o, [40, 37]);
    expect(Math.abs(d[0] - d[1])).toBeLessThan(1e-9);
    close(snap45(o, o), o);
    expect(snap45(o, [NaN, 1])[0]).toBeNaN();

    const axis: { current: Axis | null } = { current: null };
    const p = (q: XY) => constrain(axis, o, q, true, 1);
    close(p([11, 11]), o);
    close(p([30, 12]), [30, 10]);
    close(p([60, 45]), [60, 10]);
    close(constrain(axis, o, [70, 50], false, 1), [70, 50]);
    expect(axis.current).toBeNull();
    close(p([9, 60]), [10, 60]);
    axis.current = null;
    const q = p([40, 43]);
    expect(Math.abs(q[0] - 10 - (q[1] - 10))).toBeLessThan(1e-9);
  });

  it("scales the lock distance with zoom", () => {
    const axis: { current: Axis | null } = { current: null };
    close(constrain(axis, [0, 0], [2, .5], true, .5), [0, 0]);
    close(constrain(axis, [0, 0], [2, .5], true, 4), [2, 0]);
  });
});
