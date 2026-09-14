import { expect, it, vi } from "vitest";
import * as THREE from "three";
const build = vi.hoisted(() => vi.fn());
vi.mock("./factoryBuilder", () => ({ buildSculptModel: build }));
import { emptyModelDoc, useModelStore } from "./modelStore";

it("does not publish a failed model hydration over the existing live spec/reference/root", () => {
  build.mockReturnValueOnce(new THREE.Group());
  useModelStore.getState().hydrateModel(emptyModelDoc("Keep"));
  const previous = useModelStore.getState();
  build.mockImplementationOnce(() => { throw new Error("invalid geometry"); });
  expect(() => useModelStore.getState().hydrateModel(emptyModelDoc("Broken"))).toThrow(/invalid geometry/);
  expect(useModelStore.getState()).toBe(previous);
});
