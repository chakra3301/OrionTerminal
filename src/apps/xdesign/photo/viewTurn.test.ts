import { beforeEach, describe, expect, it } from "vitest";
import { NO_TURN, normalAngle, returnTurn, surfaceClient, surfaceFraction, surfaceOffset, turnTransform, turnedSize, unturn, useViewTurn, visibleArea } from "./viewTurn";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** An image surface laid out at width × height whose turned box on screen is `box`, with an overlay covering it. */
function surface(width: number, height: number, box: DOMRect, turn?: { angle?: number; flip?: boolean }) {
  const image = document.createElement("div"), overlay = document.createElement("canvas");
  image.className = "xd-photo-image"; image.append(overlay);
  if (turn?.angle) image.dataset.viewAngle = String(turn.angle);
  if (turn?.flip) image.dataset.viewFlip = "";
  Object.defineProperties(image, { offsetWidth: { value: width }, offsetHeight: { value: height } });
  image.getBoundingClientRect = overlay.getBoundingClientRect = () => box;
  return { image, overlay };
}

beforeEach(() => useViewTurn.setState({ turns: {} }));

describe("view turn", () => {
  it("keeps angles in Photoshop's -180..180 whole degrees", () => {
    expect([190, -180, 360, 45.4, -190].map(normalAngle)).toEqual([-170, 180, 0, 45, 170]);
  });
  it("turns each document on its own and only for the view", () => {
    useViewTurn.getState().turn("a", { angle: 370 });
    useViewTurn.getState().turn("a", { flip: true });
    expect(useViewTurn.getState().turns).toEqual({ a: { angle: 10, flip: true } });
    expect(useViewTurn.getState().turns.b ?? NO_TURN).toEqual(NO_TURN);
  });
  it("rotates then mirrors, and sizes the scroll area to the turned box", () => {
    expect(turnTransform(NO_TURN)).toBe("");
    expect(turnTransform({ angle: 90, flip: true })).toBe("rotate(90deg) scaleX(-1)");
    expect(turnedSize(100, 50, 0)).toEqual([100, 50]);
    expect(turnedSize(100, 50, 90).map(Math.round)).toEqual([50, 100]);
  });
  it("undoes the turn exactly", () => {
    const turn = { angle: 33, flip: true }, [x, y] = returnTurn(...unturn(12, -7, turn), turn);
    expect(x).toBeCloseTo(12); expect(y).toBeCloseTo(-7);
  });
  it("maps the pointer as before while the view is square", () => {
    const { overlay } = surface(200, 100, rect(10, 20, 200, 100));
    expect(surfaceFraction(overlay, 60, 45)).toEqual([.25, .25]);
    expect(surfaceOffset(overlay, 60, 45)).toEqual([50, 25]);
    expect(surfaceClient(overlay, 50, 25)).toEqual([60, 45]);
  });
  it("maps the pointer onto a rotated or flipped image", () => {
    // 200 × 100 turned 90° clockwise fills a 100 × 200 box; its top left corner is then at the box's top right.
    const rotated = surface(200, 100, rect(0, 0, 100, 200), { angle: 90 }).overlay;
    const [fx, fy] = surfaceFraction(rotated, 100, 0);
    expect(fx).toBeCloseTo(0); expect(fy).toBeCloseTo(0);
    const [cx, cy] = surfaceClient(rotated, 200, 100);
    expect(cx).toBeCloseTo(0); expect(cy).toBeCloseTo(200);
    const flipped = surface(200, 100, rect(0, 0, 200, 100), { flip: true }).overlay;
    expect(surfaceFraction(flipped, 50, 25).map(value => +value.toFixed(6))).toEqual([.75, .25]);
  });
  it("finds the document area the view shows, turned or not", () => {
    const scroller = document.createElement("div");
    Object.defineProperties(scroller, { clientWidth: { value: 100 }, clientHeight: { value: 50 } });
    scroller.getBoundingClientRect = () => rect(0, 0, 100, 50);
    expect(visibleArea(scroller, surface(400, 200, rect(-40, -20, 400, 200)).image, 2, 200, 100)).toEqual({ x: 20, y: 10, width: 50, height: 25 });
    const area = visibleArea(scroller, surface(400, 200, rect(-50, -175, 200, 400), { angle: 90 }).image, 2, 200, 100);
    expect([area.x, area.y, area.width, area.height].map(value => +value.toFixed(6))).toEqual([87.5, 25, 25, 50]);
  });
});
