// Regression guard for the Zustand v5 infinite-render crash: selectors that
// return a fresh reference each call (e.g. `s.list()` / `Array.from(...)` /
// `.filter(...)`) make React's useSyncExternalStore snapshot check always
// differ → "Maximum update depth exceeded". These components must select a
// stable slice and derive in the render body. We mount each and assert it
// renders without the loop error.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { AgentForge } from "./AgentForge";
import { SkillLibraryPanel } from "./SkillLibraryPanel";
import { SkillEditor } from "./SkillEditor";
import { ModelSelect } from "@/components/ModelSelect";
import type { Skill } from "@/features/agents/agentTypes";

// Tauri modules pulled in by these components (only called in handlers).
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** Mount `el` and return whether it rendered without an infinite-loop error
 *  (either a thrown "Maximum update depth" or the same logged to console). */
function rendersWithoutLoop(el: React.ReactElement): { ok: boolean; detail: string } {
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errors.push(a.map(String).join(" "));
  });
  const container = document.createElement("div");
  let threw: unknown = null;
  try {
    act(() => {
      createRoot(container).render(el);
    });
  } catch (e) {
    threw = e;
  }
  spy.mockRestore();
  const loop =
    /Maximum update depth/i.test(String(threw ?? "")) ||
    errors.some((e) => /Maximum update depth/i.test(e));
  return { ok: !loop && !threw, detail: loop ? "infinite render loop" : String(threw ?? "") };
}

const sampleSkill: Skill = {
  id: "s1",
  name: "Test Skill",
  icon: "",
  accent: "#b14cff",
  instructions: "",
  tools: [],
  builtin: false,
};

describe("Control Panel surfaces render without a Zustand v5 selector loop", () => {
  it("AgentForge mounts", () => {
    expect(rendersWithoutLoop(<AgentForge />)).toEqual({ ok: true, detail: "" });
  });
  it("SkillLibraryPanel mounts", () => {
    expect(rendersWithoutLoop(<SkillLibraryPanel />)).toEqual({ ok: true, detail: "" });
  });
  it("SkillEditor mounts", () => {
    expect(rendersWithoutLoop(<SkillEditor skill={sampleSkill} onClose={() => {}} />)).toEqual({ ok: true, detail: "" });
  });
  it("ModelSelect mounts", () => {
    expect(rendersWithoutLoop(<ModelSelect surface="orion" />)).toEqual({ ok: true, detail: "" });
  });
});
