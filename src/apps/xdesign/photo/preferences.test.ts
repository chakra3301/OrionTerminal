import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, currentPreferences, pasteboardFill, previewPreferences, sanitizePreferences, savePreferences, unitsPerPixel, usePreferences } from "./preferences";

afterEach(() => { vi.restoreAllMocks(); localStorage.removeItem(PREFERENCES_KEY); usePreferences.setState({ ...DEFAULT_PREFERENCES, notice: null }); });

it("keeps each valid saved field and falls back field by field", () => {
  expect(sanitizePreferences({ rulerUnit: "furlongs", screenResolution: 144, grid: { color: "#ABCDEF", every: -1, unit: "percent", subdivisions: 2.6 }, slices: { numbers: false } })).toEqual({
    ...DEFAULT_PREFERENCES, screenResolution: 144,
    grid: { ...DEFAULT_PREFERENCES.grid, color: "#abcdef", subdivisions: 3 },
    slices: { ...DEFAULT_PREFERENCES.slices, numbers: false },
  });
  expect(sanitizePreferences("nonsense")).toEqual(DEFAULT_PREFERENCES);
});

it("previews without saving, saves under a schema version and reads the save back on the next launch", async () => {
  const next = { ...DEFAULT_PREFERENCES, rulerUnit: "inches" as const, guides: { color: "#ff6b6b", style: "dashed" as const } };
  previewPreferences(next);
  expect(currentPreferences()).toEqual(next);
  expect(localStorage.getItem(PREFERENCES_KEY)).toBeNull();
  expect(savePreferences(next)).toBeNull();
  expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!)).toEqual({ schemaVersion: 1, preferences: next });
  vi.resetModules();
  const fresh = await import("./preferences");
  expect(fresh.usePreferences.getState()).toEqual({ ...next, notice: null });
});

it("says when the save can't be read or written instead of failing silently", async () => {
  localStorage.setItem(PREFERENCES_KEY, "{");
  vi.resetModules();
  const fresh = await import("./preferences");
  expect(fresh.usePreferences.getState()).toEqual({ ...DEFAULT_PREFERENCES, notice: "Saved preferences could not be read; the defaults are in use." });

  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  const next = { ...DEFAULT_PREFERENCES, screenResolution: 96 };
  expect(savePreferences(next)).toBe("Preferences could not be saved; they last until XDesign closes.");
  expect(usePreferences.getState()).toMatchObject({ screenResolution: 96, notice: "Preferences could not be saved; they last until XDesign closes." });
});

it("keeps a pasteboard colour for each screen mode, as Photoshop does", () => {
  expect(sanitizePreferences({ pasteboard: [{ color: "black", custom: "#ABCDEF" }, { color: "custom", custom: "nope" }, "x"] }).pasteboard).toEqual([
    { color: "black", custom: "#abcdef" }, { color: "default", custom: null }, { color: "default", custom: null },
  ]);
  expect(DEFAULT_PREFERENCES.pasteboard.map(pasteboardFill)).toEqual([null, null, null]);
  expect(pasteboardFill({ color: "lightGray", custom: "#123456" })).toBe("#b8b8b8");
  expect(pasteboardFill({ color: "custom", custom: "#123456" })).toBe("#123456");
});

it("converts document pixels to each ruler unit", () => {
  expect(unitsPerPixel("pixels", 300, "postscript")).toBe(1);
  expect(unitsPerPixel("inches", 300, "postscript")).toBe(1 / 300);
  expect(unitsPerPixel("millimeters", 254, "postscript")).toBeCloseTo(0.1);
  expect(unitsPerPixel("picas", 72, "postscript")).toBeCloseTo(1 / 12);
  expect(unitsPerPixel("points", 72, "traditional")).toBeCloseTo(1.00375);
  expect(unitsPerPixel("percent", 72, "postscript", 400)).toBe(0.25);
});
