// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ setAppState: vi.fn(async () => {}) }));
import { editorThemeName, registerLightEditorTheme } from "./editorAppearance";
import { useThemeStore } from "@/store/themeStore";
import { lightFixture, themeFixture } from "@/features/settings/__tests__/themeFixture";
it("redefines custom editor colors in place for dark/light previews and restores the builtin", () => {
  const editor = { defineTheme: vi.fn(), setTheme: vi.fn() };
  registerLightEditorTheme({ editor } as unknown as typeof import("monaco-editor"));
  useThemeStore.getState().hydrate("liquid");
  useThemeStore.getState().preview(themeFixture);
  expect(editorThemeName(themeFixture.id)).toBe("orion-custom");
  expect(editor.defineTheme).toHaveBeenCalledWith("orion-custom", expect.objectContaining({ base: "vs-dark", colors: expect.objectContaining({ "editor.background": themeFixture.colors.raised, "editor.foreground": themeFixture.colors.text }) }));
  expect(editor.setTheme).toHaveBeenLastCalledWith("orion-custom");
  useThemeStore.getState().preview(lightFixture);
  expect(editorThemeName(lightFixture.id)).toBe("orion-light");
  expect(editor.defineTheme).toHaveBeenCalledWith("orion-light", expect.objectContaining({ base: "vs", colors: expect.objectContaining({ "editor.background": lightFixture.colors.raised }) }));
  useThemeStore.getState().cancelPreview(lightFixture.id);
  expect(editor.setTheme).toHaveBeenLastCalledWith("orion-neon");
  expect(document.documentElement.style.getPropertyValue("--bg-2")).toBe("");
});
