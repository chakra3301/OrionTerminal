// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ setAppState: vi.fn(async () => {}) }));
vi.mock("@/store/toastStore", () => ({ toast: { error: vi.fn() } }));
import { setAppState } from "@/lib/db";
import { allThemes, isLightTheme, useThemeStore } from "./themeStore";
import { lightFixture, themeFixture } from "@/features/settings/__tests__/themeFixture";
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(async () => {
  await flush(); vi.mocked(setAppState).mockReset().mockResolvedValue(undefined);
  useThemeStore.getState().hydrate("liquid");
  useThemeStore.getState().hydrateCustom(null);
});
it("hydrates the registry before restoring its active theme without writes", () => {
  const s = useThemeStore.getState();
  s.hydrateCustom({ version: 1, themes: [lightFixture] }); s.hydrate(lightFixture.id);
  expect(isLightTheme(lightFixture.id)).toBe(true);
  expect(document.documentElement.dataset.colorMode).toBe("light");
  expect(document.documentElement.style.getPropertyValue("--bg-2")).toBe(lightFixture.colors.raised);
  expect(allThemes().at(-1)?.label).toBe("Paper");
  expect(setAppState).not.toHaveBeenCalled();
});
it("previews and restores without saving, removes tokens, and does not undo a later selection", async () => {
  const s = useThemeStore.getState();
  s.preview(themeFixture);
  expect(document.documentElement.dataset.customSurface).toBe("solid");
  expect(document.documentElement.style.getPropertyValue("--r-lg")).toBe("12px");
  s.cancelPreview(themeFixture.id);
  expect(useThemeStore.getState().theme).toBe("liquid");
  expect(document.documentElement.style.getPropertyValue("--r-lg")).toBe("");
  expect(document.documentElement.dataset.customSurface).toBeUndefined();
  expect(setAppState).not.toHaveBeenCalled();
  s.preview(themeFixture); s.set("minimal"); s.cancelPreview(themeFixture.id);
  expect(useThemeStore.getState().theme).toBe("minimal");
  await flush();
});
it("publishes only acknowledged saves and rejects overlapping registry writes", async () => {
  let release!: () => void;
  vi.mocked(setAppState).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = useThemeStore.getState().saveCustom(themeFixture);
  expect(useThemeStore.getState().customSaving).toBe(true);
  expect(useThemeStore.getState().customThemes).toEqual([]);
  await expect(useThemeStore.getState().saveCustom(lightFixture)).rejects.toThrow(/in progress/);
  await vi.waitFor(() => expect(setAppState).toHaveBeenCalledTimes(1)); release(); await pending;
  expect(useThemeStore.getState().customThemes).toEqual([themeFixture]);
  expect(useThemeStore.getState().customSaving).toBe(false);
});
it("keeps failed generated drafts available for retry without publishing them", async () => {
  const s = useThemeStore.getState(); s.preview(themeFixture);
  vi.mocked(setAppState).mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(s.saveCustom(themeFixture)).rejects.toThrow("disk unavailable");
  expect(useThemeStore.getState().customThemes).toEqual([]);
  expect(useThemeStore.getState().previewTheme).toEqual(themeFixture);
  await s.saveCustom(themeFixture);
  expect(useThemeStore.getState().customThemes).toEqual([themeFixture]);
});
it("blocks writes after unreadable/newer/invalid/duplicate registry hydration", async () => {
  for (const value of [undefined, { version: 2, themes: [] }, { version: 1, themes: [themeFixture, themeFixture] }, { version: 1, themes: [{ ...themeFixture, radii: [999] }] }]) {
    const s = useThemeStore.getState(); s.hydrateCustom(value);
    expect(useThemeStore.getState().customLoadError).toContain("not been overwritten");
    await expect(s.saveCustom(lightFixture)).rejects.toThrow(/couldn't be loaded/);
  }
  expect(setAppState).not.toHaveBeenCalled();
});
it("preserves unknown stored fields and excludes source Markdown from new saves", async () => {
  const s = useThemeStore.getState();
  s.hydrateCustom({ version: 1, future: "keep", themes: [{ ...themeFixture, futureField: 7 }] });
  await s.saveCustom(lightFixture);
  expect(setAppState).toHaveBeenCalledWith("custom_themes", { version: 1, future: "keep", themes: [{ ...themeFixture, futureField: 7 }, lightFixture] });
});
it("keeps active themes on failed deletion and falls back only after successful deletion", async () => {
  const s = useThemeStore.getState(); s.hydrateCustom({ version: 1, themes: [themeFixture] }); s.hydrate(themeFixture.id);
  vi.mocked(setAppState).mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(s.removeCustom(themeFixture.id)).rejects.toThrow();
  expect(useThemeStore.getState().theme).toBe(themeFixture.id);
  expect(useThemeStore.getState().customThemes).toHaveLength(1);
  await s.removeCustom(themeFixture.id); await flush();
  expect(useThemeStore.getState().theme).toBe("liquid");
  expect(useThemeStore.getState().customThemes).toEqual([]);
  expect(document.documentElement.style.getPropertyValue("--bg-0")).toBe("");
});
