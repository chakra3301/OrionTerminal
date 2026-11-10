import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ParticleOrb, orbAccent } from "./ParticleOrb";
import { SkillEmblem } from "@/features/controlpanel/SkillEmblem";
import { drawOrb } from "@/shell/dock/orbCanvas";

vi.mock("@/shell/dock/orbCanvas", () => ({ drawOrb: vi.fn() }));
let host: HTMLDivElement, root: Root, frames: Map<number, FrameRequestCallback>, seq: number, hidden: boolean;
let intersections: ((entries: Partial<IntersectionObserverEntry>[]) => void)[];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map(); seq = 0; hidden = false; intersections = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++seq, fn); return seq; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("pointer: fine"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("IntersectionObserver", class { constructor(fn: (entries: Partial<IntersectionObserverEntry>[]) => void) { intersections.push(fn); } observe() {} disconnect() {} });
  const context = { drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(96 * 96 * 4).fill(255) }) };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => context) as unknown as HTMLCanvasElement["getContext"]);
  vi.mocked(drawOrb).mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const step = () => { const pending = [...frames.values()]; frames.clear(); act(() => pending.forEach((fn) => fn(performance.now()))); };

it("stops offscreen and hidden orbs, resumes visible orbs and cleans up on unmount", async () => {
  await act(async () => root.render(<><ParticleOrb identity="skill:a" accent="#00e0ff" /><ParticleOrb identity="skill:b" accent="#00e0ff" /></>));
  expect(frames.size).toBe(1); expect(host.querySelectorAll("svg")).toHaveLength(0);
  act(() => intersections.forEach((fn) => fn([{ isIntersecting: false }]))); expect(frames.size).toBe(0);
  act(() => intersections[0]!([{ isIntersecting: true }])); expect(frames.size).toBe(1);
  hidden = true; act(() => document.dispatchEvent(new Event("visibilitychange"))); expect(frames.size).toBe(0);
  hidden = false; act(() => document.dispatchEvent(new Event("visibilitychange"))); expect(frames.size).toBe(1);
});

it("freezes ambient movement for reduced motion but keeps fine-pointer feedback", async () => {
  await act(async () => root.render(<ParticleOrb identity="skill:a" accent="#00e0ff" reduced />));
  step(); expect(frames.size).toBe(0);
  const span = host.querySelector("span")!;
  act(() => span.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 20, clientY: 20 })));
  expect(frames.size).toBe(1); step(); expect(vi.mocked(drawOrb).mock.lastCall?.[0].m).not.toBeNull();
  act(() => span.dispatchEvent(new MouseEvent("pointerleave"))); step(); expect(frames.size).toBe(0);
  expect(vi.mocked(drawOrb).mock.calls.every(([, time, reduced]) => time === 0 && reduced)).toBe(true);
});

it("shows the generated SVG fallback when canvas rendering is unavailable", async () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
  await act(async () => root.render(<ParticleOrb identity="skill:a" accent="invalid" />));
  expect(host.querySelector("svg path")).not.toBeNull(); expect(frames.size).toBe(0);
  expect(orbAccent("invalid")).toBe("#00e0ff");
});

it("keeps a skill's glyph when its label, instructions and accent change", async () => {
  const skill = { id: "imported:stable", name: "Before", accent: "#00e0ff", instructions: "Before", tools: [], builtin: false, icon: "" };
  await act(async () => root.render(<SkillEmblem skill={skill} />));
  const spatial = vi.mocked(drawOrb).mock.lastCall?.[0].glyph?.spatial;
  await act(async () => root.render(<SkillEmblem skill={{ ...skill, name: "After", accent: "#ff3ea5", instructions: "After" }} equipped />));
  expect(vi.mocked(drawOrb).mock.lastCall?.[0].glyph?.spatial).toBe(spatial);
  expect(host.querySelector("[data-identity]")?.getAttribute("data-identity")).toBe("skill:imported:stable");
});

it("updates the inner glyph's ink when the theme changes, including while ambient motion is frozen", async () => {
  await act(async () => root.render(<ParticleOrb identity="skill:a" accent="#00e0ff" reduced />));
  step();
  await act(async () => {
    document.documentElement.style.setProperty("--t-primary", "#262820");
    document.documentElement.setAttribute("data-color-mode", "light");
  });
  expect(vi.mocked(drawOrb).mock.lastCall?.[0].glyph?.ink).toBe("#262820");
  expect(frames.size).toBe(0);
  document.documentElement.style.removeProperty("--t-primary");
  document.documentElement.removeAttribute("data-color-mode");
});
