import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Blocks } from "lucide-react";
import { Dock } from "./Dock";
import { useShell } from "./store/useShell";
import { appRegistry } from "@/plugins/appRegistry";
import { BUILTIN_APP_DESCRIPTORS } from "@/plugins/builtinApps";
import { useRosie } from "@/features/rosie/rosieStore";
import { useControlPanel } from "@/store/controlPanelStore";

vi.mock("@/components/effects/ThemeBorder", () => ({ ThemeBorder: () => null }));
const initial = useShell.getState();
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  appRegistry.clear();
  for (const app of BUILTIN_APP_DESCRIPTORS) appRegistry.register("test", app);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); appRegistry.clear();
  useShell.setState(initial, true); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const render = () => act(() => root.render(<Dock />));
const button = (name: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;

it("renders the approved order with accessible names, coach marks, and no native tooltips", () => {
  render();
  expect([...host.querySelectorAll("button")].map((el) => el.getAttribute("aria-label"))).toEqual([
    "Archives 47", "Orion", "XDesign", "Incubator", "R.O.S.I.E (⌘L)", "Spotlight (⌘K)", "Control Panel (⌘,)",
  ]);
  expect(host.querySelectorAll("button[title]")).toHaveLength(0);
  expect(button("Archives 47").dataset.coach).toBe("app-archives");
  expect(button("R.O.S.I.E (⌘L)").dataset.coach).toBe("rosie");
  expect(button("Spotlight (⌘K)").dataset.coach).toBe("spotlight");
});

it("keeps community apps among the apps and uses their existing Icon", () => {
  appRegistry.register("community", { ...BUILTIN_APP_DESCRIPTORS[0]!, id: "community:app", name: "Community", order: 1000, dock: { ...BUILTIN_APP_DESCRIPTORS[0]!.dock, Icon: Blocks } });
  render();
  const items = [...host.querySelectorAll("button")];
  expect(items[4]?.getAttribute("aria-label")).toBe("Community");
  expect(button("Community").querySelector("svg")).not.toBeNull();
});

it("opens apps, minimises a focused visible app, and preserves utility actions", () => {
  const openApp = vi.fn(), minimizeWindow = vi.fn(), openSpotlight = vi.fn();
  const toggle = vi.spyOn(useRosie.getState(), "togglePanel").mockImplementation(() => {});
  const control = vi.spyOn(useControlPanel.getState(), "show").mockImplementation(() => {});
  useShell.setState({ openApp, minimizeWindow, openSpotlight, focusedWindowId: "a", windows: [
    { id: "a", app: "archives", minimized: false, x: 0, y: 0, w: 100, h: 100, z: 1, maximized: false, fullscreen: false },
  ] });
  render();
  act(() => { button("Archives 47").click(); button("Orion").click(); button("Spotlight (⌘K)").click(); button("R.O.S.I.E (⌘L)").click(); button("Control Panel (⌘,)").click(); });
  expect(minimizeWindow).toHaveBeenCalledWith("a"); expect(openApp).toHaveBeenCalledWith("orion");
  expect(openSpotlight).toHaveBeenCalledOnce(); expect(toggle).toHaveBeenCalledOnce(); expect(control).toHaveBeenCalledOnce();
});

it("reveals the keyboard-focused item and hides its open dot only while labeled", () => {
  render();
  act(() => button("Orion").focus());
  expect(button("Orion").classList.contains("labeled")).toBe(true);
  expect(button("Orion").style.transform).toContain("scale(1.550)");
  expect(host.querySelector(".ot-dock-label")?.classList.contains("on")).toBe(true);
  act(() => button("Orion").blur());
  expect(button("Orion").classList.contains("labeled")).toBe(false);
});

it("shows the whole name immediately with reduced motion", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render();
  act(() => button("Orion").focus());
  expect(host.querySelector(".ot-dock-label")?.textContent).toBe("Orion");
});

it("keeps opened and maximised windows above the raised dock", () => {
  const id = useShell.getState().openApp("orion");
  const clearance = () => {
    const windowState = useShell.getState().windows.find((w) => w.id === id)!;
    return window.innerHeight - windowState.y - windowState.h;
  };
  expect(clearance()).toBe(104);
  useShell.getState().toggleMaximize(id);
  expect(clearance()).toBe(104);
});
