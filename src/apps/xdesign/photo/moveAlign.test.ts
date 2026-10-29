import { beforeEach, describe, expect, it } from "vitest";
import { MOVE_ALIGN_TO_KEY, alignParams, loadAlignTo, saveAlignTo } from "./moveAlign";

beforeEach(() => localStorage.removeItem(MOVE_ALIGN_TO_KEY));

describe("Move bar Align To", () => {
  it("aligns to the pixel selection when there is one, else leaves the engine's layers-or-canvas choice, and to the canvas on request", () => {
    expect(alignParams("selection", false)).toEqual({});
    expect(alignParams("selection", true)).toEqual({ to: "selection" });
    expect(alignParams("canvas", true)).toEqual({ to: "canvas" });
    expect(alignParams("canvas", false)).toEqual({ to: "canvas" });
  });
  it("keeps the choice across relaunches and reads stale or foreign values as Selection", () => {
    expect(loadAlignTo()).toBe("selection");
    saveAlignTo("canvas"); expect(loadAlignTo()).toBe("canvas");
    localStorage.setItem(MOVE_ALIGN_TO_KEY, "layers"); expect(loadAlignTo()).toBe("selection");
    localStorage.setItem(MOVE_ALIGN_TO_KEY, "{bad"); expect(loadAlignTo()).toBe("selection");
  });
});
