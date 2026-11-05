// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import postcss from "postcss";
vi.mock("@/lib/db", () => ({ setAppState: vi.fn(async () => {}) }));
vi.mock("@/store/toastStore", () => ({ toast: { error: vi.fn() } }));
import { setAppState } from "@/lib/db";
import { toast } from "@/store/toastStore";
import { LIGHT_THEMES, THEMES, isLightTheme, useThemeStore } from "./themeStore";
import { readFileSync } from "node:fs";
const css = readFileSync("src/styles/lightThemes.css", "utf8");

beforeEach(() => {
  vi.mocked(setAppState).mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.error).mockClear();
  useThemeStore.getState().hydrate("liquid");
});
it("offers only Ivory Keep, Liquid, Minimal and BMW M", () => {
  expect(THEMES.filter(t => !isLightTheme(t.id)).map(t => t.id)).toEqual(["liquid", "minimal", "bmw-m"]);
  expect(LIGHT_THEMES.map(t => t.id)).toEqual(["ivory-keep"]);
  expect(new Set(THEMES.map(t => t.id)).size).toBe(4);
  for (const { id } of LIGHT_THEMES) {
    useThemeStore.getState().hydrate(id);
    expect(document.documentElement.dataset.theme).toBe(id);
    expect(document.documentElement.dataset.colorMode).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  }
  useThemeStore.getState().hydrate("bmw-m");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(setAppState).not.toHaveBeenCalled();
});
it("maps retired themes to the retained light or dark default without writing", () => {
  for (const old of ["light", "porcelain", "botanical", "rosewater", "glacier"]) {
    useThemeStore.getState().hydrate(old);
    expect(useThemeStore.getState().theme).toBe("ivory-keep");
    expect(document.documentElement.dataset.colorMode).toBe("light");
  }
  for (const old of ["neon", "modern", "dark", "future-theme", null, undefined]) {
    useThemeStore.getState().hydrate(old);
    expect(useThemeStore.getState().theme).toBe("liquid");
    expect(document.documentElement.dataset.colorMode).toBe("dark");
  }
  expect(setAppState).not.toHaveBeenCalled();
});
it("cycles only through retained themes", async () => {
  const visited = [];
  for (let i = 0; i < THEMES.length; i++) {
    useThemeStore.getState().toggle();
    visited.push(useThemeStore.getState().theme);
  }
  expect(visited).toEqual(["minimal", "bmw-m", "ivory-keep", "liquid"]);
  await vi.waitFor(() => expect(setAppState).toHaveBeenCalledTimes(4));
});
it("applies DOM appearance before subscribers update live editors", () => {
  const stop = useThemeStore.subscribe(state => {
    expect(document.documentElement.dataset.theme).toBe(state.theme);
  });
  try { useThemeStore.getState().hydrate("ivory-keep"); } finally { stop(); }
});
it("serializes rapid choices and surfaces write failures", async () => {
  let release!: () => void;
  vi.mocked(setAppState).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  useThemeStore.getState().set("ivory-keep");
  useThemeStore.getState().set("liquid");
  await vi.waitFor(() => expect(setAppState).toHaveBeenCalledTimes(1));
  release();
  await vi.waitFor(() => expect(setAppState).toHaveBeenLastCalledWith("theme", "liquid"));
  vi.mocked(setAppState).mockRejectedValueOnce(new Error("storage unavailable"));
  useThemeStore.getState().set("minimal");
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(useThemeStore.getState().theme).toBe("minimal");
});

it("does not gate glass backgrounds on optional preference media queries", () => {
  const sheet = postcss.parse(css);
  sheet.walkAtRules("media", rule => {
    expect(rule.params).not.toMatch(/^not.*prefers-reduced-transparency/);
    rule.walkDecls("background", declaration => {
      expect(declaration.value).not.toContain("--light-glass-");
    });
  });
  const reduced: Record<string, string> = {};
  sheet.walkAtRules("media", rule => {
    if (rule.params !== "(prefers-reduced-transparency: reduce)") return;
    rule.walkDecls(declaration => { reduced[declaration.prop] = declaration.value; });
  });
  expect(reduced["--light-glass-surface"]).toBe("var(--bg-1)");
  expect(reduced["--light-glass-body"]).toBe("var(--bg-1)");
  expect(reduced["--light-glass-backdrop"]).toBe("none");
  expect(css).toContain(':root[data-color-mode="light"]:not(.ot-reduce-glass)');
});

function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
}
it.each(LIGHT_THEMES)("$label has readable body, secondary and semantic ink across chrome surfaces", ({ id }) => {
  const block = css.split(`:root[data-theme="${id}"] {`)[1]!.split("}")[0]!;
  const colors = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map(m => [m[1], m[2]]));
  for (const surface of ["bg-0", "bg-1", "bg-2", "bg-3"]) {
    for (const token of ["t-primary", "t-secondary", "t-tertiary", "neon-green", "neon-cyan", "neon-magenta", "neon-yellow", "neon-violet"]) {
      const contrast = (luminance(colors[surface]!) + .05) / (luminance(colors[token]!) + .05);
      expect(contrast, `${id} ${token}/${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it.each(LIGHT_THEMES)("$label glass has a dark-backdrop reading floor without an opaque fill", ({ id }) => {
  const block = css.split(`:root[data-theme="${id}"] {`)[1]!.split("}")[0]!;
  const colors = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map(m => [m[1], m[2]]));
  const alpha = Number(css.match(/--light-glass-surface:.*?(\d+)%/)![1]) / 100;
  expect(alpha).toBeLessThan(.4);
  const curve = css.match(/--light-glass-backdrop:.*?brightness\(([\d.]+)\) contrast\(([\d.]+)\) brightness\(([\d.]+)\)/)!;
  const blackPoint = (1 - Number(curve[2])) / 2 * Number(curve[3]);
  const whitePoint = ((Number(curve[1]) - .5) * Number(curve[2]) + .5) * Number(curve[3]);
  expect(whitePoint).toBeLessThan(1);
  const floor = "#" + [1, 3, 5].map(i => {
    const tint = parseInt(colors["light-material"]!.slice(i, i + 2), 16);
    return Math.floor(tint * alpha + blackPoint * 255 * (1 - alpha)).toString(16).padStart(2, "0");
  }).join("");
  for (const ink of ["t-primary", "t-secondary", "t-tertiary", "neon-green", "neon-cyan", "neon-yellow", "neon-magenta", "neon-violet"]) {
    expect((luminance(floor) + .05) / (luminance(colors[ink]!) + .05), `${id}/${ink}`).toBeGreaterThanOrEqual(4.5);
  }
});
