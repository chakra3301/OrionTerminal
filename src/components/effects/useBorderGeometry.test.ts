import { expect, it } from "vitest";
import { borderGeometry } from "./useBorderGeometry";
function parent(radius: string) {
  const element = document.createElement("div");
  element.style.cssText = "border: 1px solid black";
  element.style.borderTopLeftRadius = radius;
  Object.defineProperties(element, { clientWidth: { value: 300 }, clientHeight: { value: 60 } });
  return element;
}
it("aligns the effect with the existing border rather than adding an inset outline", () => {
  expect(borderGeometry(parent("18.7px"))).toEqual({ radius: 18.7, top: -1, right: -1, bottom: -1, left: -1 });
});
it("clamps optical pills to the actual box instead of treating 999px as a shader radius", () => {
  expect(borderGeometry(parent("999px")).radius).toBe(31);
  expect(borderGeometry(parent("50%")).radius).toBe(31);
});
it("accounts for each border independently", () => {
  const element = parent("0px"); element.style.borderTopWidth = "0px"; element.style.borderBottomWidth = "2px";
  expect(borderGeometry(element)).toEqual({ radius: 0, top: -0, bottom: -2, left: -1, right: -1 });
});
