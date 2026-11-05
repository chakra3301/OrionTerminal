// @vitest-environment jsdom
import { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("@/features/intake/SkillIntakePanel", () => ({ SkillIntakePanel: ({ presentation }: { presentation: string }) => <section aria-label="Shared intake" data-presentation={presentation} /> }));
vi.mock("@/store/controlPanelStore", () => ({ useControlPanel: { getState: () => ({ show: m.show }) } }));
import { IncubatorApp } from "./IncubatorApp";
it("describes supported capabilities and routes explicit actions to their lifecycle managers", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<IncubatorApp />)); expect(m.show).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Shared intake"]')?.getAttribute("data-presentation")).toBe("workspace");
    expect(host.querySelectorAll(".incubator-scope li")).toHaveLength(3); expect(host.querySelector<HTMLDetailsElement>(".incubator-scope")?.open).toBe(false); expect(host.textContent).toContain("plans do not execute or grant access"); expect(host.textContent).toContain("not supported");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("nav button")];
    await act(async () => buttons[0]!.click()); expect(m.show).toHaveBeenLastCalledWith("skills");
    await act(async () => buttons[1]!.click()); expect(m.show).toHaveBeenLastCalledWith("plugins");
    const guide = host.querySelector<HTMLDetailsElement>(".incubator-scope")!;
    await act(async () => { guide.open = true; guide.querySelector("summary")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(guide.open).toBe(false); expect(document.activeElement).toBe(guide.querySelector("summary"));
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it("gives the contained app a definite flex width and keeps inactive workflows hidden", () => {
  const appCss = readFileSync("src/apps/incubator/incubator.css", "utf8");
  const intakeCss = readFileSync("src/features/intake/skillIntake.css", "utf8");
  const rootRule = appCss.match(/\.incubator-app\s*\{([^}]+)\}/)![1]!;
  expect(rootRule).toContain("container: incubator / inline-size"); expect(rootRule).toContain("flex: 1"); expect(rootRule).toContain("width: 100%"); expect(rootRule).toContain("min-width: 0");
  expect(intakeCss).toMatch(/\.skill-intake-workspace\[hidden\]\s*\{\s*display: none/);
  expect(intakeCss).toContain("@container intake");
});
