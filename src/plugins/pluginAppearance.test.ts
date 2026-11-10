import { describe, it, expect, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { parsePluginAppearance, pluginSkin, type PluginAppearance } from "./pluginAppearance";
import { appearanceClientScript } from "./pluginAppearanceClient";
import { preparePluginDocuments } from "./pluginDocument";
import { pluginAppearanceStyles } from "./pluginAppearanceStyles";
vi.mock("./pluginAppearance.css?raw", async () => ({ default: (await import("node:fs")).readFileSync("src/plugins/pluginAppearance.css", "utf8") }));
export const sample: PluginAppearance = { version: 1, revision: 1, mode: "orion", colorScheme: "dark", material: "glass", reduceMotion: false, reduceTransparency: false,
  colors: { background: "#03060a", panel: "#060a0f", raised: "#0a1015", text: "#e6f4ec", secondary: "#9ab0a8", muted: "#5a706a", line: "rgb(100 120 110 / .2)", hover: "color(srgb .1 .2 .3 / .1)", accent: "#e6ff3a", onAccent: "#03060a", error: "#ff3ea5" },
  radii: { small: 5.1, medium: 8.5, large: 13.6 } };

describe("bounded read-only appearance data", () => {
  it("clones palettes without sharing mutable host state", () => { const parsed = parsePluginAppearance(sample)!; parsed.colors.text = "#ffffff"; expect(sample.colors.text).toBe("#e6f4ec"); });
  it.each(["url(https://invalid.test)", "red;display:none", "var(--secret)", "color(srgb 1 1 1);", "</style>", "#abcde"])("rejects CSS/source payload %s", color => { expect(parsePluginAppearance({ ...sample, colors: { ...sample.colors, text: color } })).toBeNull(); });
  it.each([{ ...sample, revision: -1 }, { ...sample, version: 2 }, { ...sample, mode: "unsafe" }, { ...sample, grants: [] }, { ...sample, radii: { ...sample.radii, large: Infinity } }, { ...sample, colors: { ...sample.colors, extra: "#fff" } }])("rejects unsupported schema", value => expect(parsePluginAppearance(value)).toBeNull());
  it("rejects descriptors before evaluating getters", () => { const getter = vi.fn(); const v = { ...sample }; Object.defineProperty(v, "colors", { get: getter }); expect(parsePluginAppearance(v)).toBeNull(); expect(getter).not.toHaveBeenCalled(); });
  it("only opts in declared UI packages, never background or inferred game names", () => {
    expect(pluginSkin('<body data-orion-appearance="v1" data-orion-skin="2048">', "ui")).toBe("2048");
    expect(pluginSkin('<body data-orion-appearance="v1">', "ui")).toBe("standard");
    expect(pluginSkin('<body data-orion-appearance="v1" data-orion-skin="2048">', "background")).toBeNull();
    expect(pluginSkin('<main>2048</main>', "ui")).toBeNull();
    expect(pluginSkin('<body data-orion-appearance="v1" data-orion-skin="unknown">', "ui")).toBeNull();
  });
});
describe("opaque appearance client", () => {
  it("accepts bound live updates only, restores original mode, never touches game markup", () => {
    const root = document.createElement("html"); root.innerHTML = '<body><div id="game">unchanged</div></body>';
    const parent = {}, other = {}; let listener!: (e: { source: unknown; data: unknown }) => void;
    const env: Record<string, unknown> = { document: { documentElement: root }, parent, channel: "orion-plugin-rpc", version: 1, sessionId: "session", addEventListener: (_: string, cb: typeof listener) => { listener = cb; } };
    runInNewContext(appearanceClientScript(sample) + ";globalThis.api = appearance;", env);
    const send = (source: unknown, revision: number, mode = "orion", sessionId = "session") => listener({ source, data: { channel: "orion-plugin-rpc", version: 1, sessionId, type: "appearance", appearance: { ...sample, mode, revision, colorScheme: "light" } } });
    send(other, 2); send(parent, 2, "orion", "old"); expect(root.style.colorScheme).toBe("dark");
    send(parent, 2); expect(root.style.colorScheme).toBe("light"); send(parent, 1); expect(root.style.colorScheme).toBe("light");
    send(parent, 3, "original"); expect(root.dataset.orionStyle).toBe("original"); expect(root.style.colorScheme).toBe(""); expect(root.querySelector("#game")!.textContent).toBe("unchanged");
    const api = env.api as { get: () => PluginAppearance }; api.get().colors.text = "#fff"; expect(api.get().colors.text).toBe(sample.colors.text);
  });
  it("keeps legacy documents untouched and embeds local data fonts only for explicit adapters", () => {
    const plain = preparePluginDocuments('<style>body{background:beige}</style><main>Original</main>', "ui", "", "s"); expect(plain.content).not.toContain("Orion Space Grotesk");
    const styled = preparePluginDocuments('<body data-orion-appearance="v1" data-orion-skin="2048"><style>body{background:beige}</style><main>Original</main></body>', "ui", "", "s");
    const doc = new DOMParser().parseFromString(styled.content, "text/html"); expect(doc.documentElement.dataset.orionSkin).toBe("2048");
    expect(doc.querySelector("style:not(#orion-appearance-style)")!.textContent).toBe("body{background:beige}"); expect(styled.content).toContain(".game-container"); expect(styled.content).toContain("data:font/woff2;base64,"); expect(styled.content).not.toContain("fonts.googleapis");
    expect(pluginAppearanceStyles()).toContain("tile-position-4-4"); expect(pluginAppearanceStyles()).toContain(".grid-container { position: absolute; inset: var(--orion-board-pad); width: auto"); expect(pluginAppearanceStyles()).toContain("color-scheme: inherit;"); expect(pluginAppearanceStyles()).toContain('html[data-orion-style="orion"]::-webkit-scrollbar-track'); expect(pluginAppearanceStyles()).toContain('html[data-orion-style="orion"] ::-webkit-scrollbar-thumb'); expect(pluginAppearanceStyles()).not.toContain('html[data-orion-style="original"]::-webkit-scrollbar'); expect(pluginAppearanceStyles()).toContain(".grid-row)::after { display: none;"); expect(styled.content).toContain("connect-src 'none'");
  });
});
