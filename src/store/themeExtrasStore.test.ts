import { beforeEach, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ setAppState: save }));
import { useThemeExtras, DEFAULT_THEME_EXTRAS } from "./themeExtrasStore";
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
beforeEach(() => { save.mockReset().mockResolvedValue(undefined); useThemeExtras.getState().hydrate(null); });
it("keeps separate finishes for each theme and immediately updates the live state", async () => {
  useThemeExtras.getState().update("liquid", { border: "metal", metalPreset: "gold" });
  useThemeExtras.getState().update("minimal", { border: "beam" });
  expect(useThemeExtras.getState().themes.liquid?.metalPreset).toBe("gold");
  expect(useThemeExtras.getState().themes.minimal?.border).toBe("beam");
  await flush();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[1].themes.liquid.metalPreset).toBe("gold");
});
it("preserves unknown fields, future themes and unedited legacy values", async () => {
  useThemeExtras.getState().hydrate({ version: 1, futureFlag: "keep", themes: { liquid: { ...DEFAULT_THEME_EXTRAS, futureStyle: 7, beamSize: "future-shape" }, futureTheme: { border: "different" } } });
  useThemeExtras.getState().update("liquid", { strength: .85 }); await flush();
  expect(save.mock.calls[0]?.[1]).toMatchObject({ futureFlag: "keep", themes: { liquid: { strength: .85, futureStyle: 7, beamSize: "future-shape" }, futureTheme: { border: "different" } } });
});
it("keeps retired finishes in storage without exposing or transferring them to retained themes", async () => {
  const retired = { neon: { border: "metal" }, modern: { border: "beam" }, glacier: { border: "metal", metalPreset: "gold" } };
  useThemeExtras.getState().hydrate({ version: 1, themes: { ...retired, liquid: { border: "beam" } } });
  expect(Object.keys(useThemeExtras.getState().themes)).toEqual(["liquid"]);
  expect(useThemeExtras.getState().themes.liquid?.border).toBe("beam");
  useThemeExtras.getState().update("ivory-keep", { strength: .6 }); await flush();
  expect(save.mock.calls[0]?.[1].themes).toMatchObject(retired);
});
it("never overwrites an unreadable or newer settings document", async () => {
  for (const bad of [undefined, { version: 2, themes: {} }, { version: 1, themes: { liquid: "bad" } }]) {
    useThemeExtras.getState().hydrate(bad);
    useThemeExtras.getState().update("liquid", { border: "metal" });
    useThemeExtras.getState().reset("liquid");
  }
  await flush(); expect(save).not.toHaveBeenCalled(); expect(useThemeExtras.getState().saveError).toContain("not been overwritten");
});
it("resets only known fields of the chosen theme", async () => {
  useThemeExtras.getState().hydrate({ version: 1, themes: { liquid: { ...DEFAULT_THEME_EXTRAS, border: "metal", note: "keep" }, minimal: { border: "beam" } } });
  useThemeExtras.getState().reset("liquid"); await flush();
  expect(useThemeExtras.getState().themes.liquid).toBeUndefined();
  expect(save.mock.calls[0]?.[1].themes).toEqual({ liquid: { note: "keep" }, minimal: { border: "beam" } });
});
it("serializes writes and ignores stale failure acknowledgements", async () => {
  let reject!: (error: Error) => void;
  save.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  useThemeExtras.getState().update("liquid", { border: "metal" });
  useThemeExtras.getState().update("liquid", { border: "beam" });
  await flush(); expect(save).toHaveBeenCalledTimes(1);
  reject(new Error("synthetic write failure")); await flush();
  expect(save).toHaveBeenCalledTimes(2); expect(useThemeExtras.getState().saveError).toBeNull();
  expect(save.mock.calls[1]?.[1].themes.liquid.border).toBe("beam");
});
it("shows failed saves without freezing controls and retries on the next change", async () => {
  save.mockRejectedValueOnce(new Error("synthetic disk failure"));
  useThemeExtras.getState().update("liquid", { border: "metal" }); await flush();
  expect(useThemeExtras.getState().saveError).toContain("weren't saved");
  useThemeExtras.getState().update("liquid", { metalPreset: "silver" }); await flush();
  expect(useThemeExtras.getState().themes.liquid?.metalPreset).toBe("silver"); expect(useThemeExtras.getState().saveError).toBeNull();
});
