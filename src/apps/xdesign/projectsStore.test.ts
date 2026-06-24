import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const mem = new Map<string, unknown>();
  return {
    __mem: mem,
    getAppState: vi.fn(async (key: string) => (mem.has(key) ? mem.get(key) : null)),
    setAppState: vi.fn(async (key: string, value: unknown) => {
      if (value === null) mem.delete(key);
      else mem.set(key, value);
    }),
  };
});

import * as db from "@/lib/db";
import { useXDProjects, emptyDoc } from "./projectsStore";
import { useXDesign } from "./store";

const mem = (db as unknown as { __mem: Map<string, unknown> }).__mem;

beforeEach(() => {
  mem.clear();
  useXDProjects.setState({ registry: [], openTabs: [], activeId: null, ready: false });
  useXDesign.getState().hydrate(emptyDoc());
});

describe("xdesign projectsStore", () => {
  it("starts on Home with no projects", async () => {
    await useXDProjects.getState().init();
    const s = useXDProjects.getState();
    expect(s.ready).toBe(true);
    expect(s.activeId).toBeNull();
    expect(s.registry).toEqual([]);
  });

  it("migrates a legacy xdesign.doc into an Untitled project", async () => {
    mem.set("xdesign.doc", {
      pages: [{ id: "p1", name: "Page 1", shapes: [{ id: "s1" }] }],
      activePageId: "p1",
    });
    await useXDProjects.getState().init();
    const s = useXDProjects.getState();
    expect(s.registry).toHaveLength(1);
    expect(s.registry[0]!.name).toBe("Untitled");
    expect(s.activeId).toBeNull(); // still lands on Home
    const doc = mem.get(`xdesign.project.${s.registry[0]!.id}`) as { activePageId: string };
    expect(doc.activePageId).toBe("p1");
  });

  it("new project opens it as the active tab", async () => {
    await useXDProjects.getState().init();
    const id = await useXDProjects.getState().newProject("My Design");
    const s = useXDProjects.getState();
    expect(s.activeId).toBe(id);
    expect(s.openTabs).toEqual([id]);
    expect(s.registry[0]!.name).toBe("My Design");
  });

  it("auto-names unique Untitled projects", async () => {
    await useXDProjects.getState().init();
    await useXDProjects.getState().newProject();
    await useXDProjects.getState().newProject();
    const names = useXDProjects.getState().registry.map((m) => m.name).sort();
    expect(names).toEqual(["Untitled", "Untitled 2"]);
  });

  it("closing the last tab returns to Home", async () => {
    await useXDProjects.getState().init();
    const id = await useXDProjects.getState().newProject();
    await useXDProjects.getState().closeTab(id);
    const s = useXDProjects.getState();
    expect(s.activeId).toBeNull();
    expect(s.openTabs).toEqual([]);
  });

  it("closing a non-last active tab switches to the neighbour", async () => {
    await useXDProjects.getState().init();
    const a = await useXDProjects.getState().newProject("A");
    const b = await useXDProjects.getState().newProject("B");
    expect(useXDProjects.getState().activeId).toBe(b);
    await useXDProjects.getState().closeTab(b);
    const s = useXDProjects.getState();
    expect(s.openTabs).toEqual([a]);
    expect(s.activeId).toBe(a);
  });

  it("persists edits into the active project slot on switch", async () => {
    await useXDProjects.getState().init();
    const a = await useXDProjects.getState().newProject("A");
    useXDesign.getState().addShape({
      kind: "rect", x: 0, y: 0, w: 10, h: 10, radius: 0,
      fill: "#fff", stroke: "transparent", strokeWidth: 0,
    });
    const b = await useXDProjects.getState().newProject("B");
    // Opening B should have flushed A's shape to A's slot.
    const docA = mem.get(`xdesign.project.${a}`) as { pages: { shapes: unknown[] }[] };
    expect(docA.pages[0]!.shapes).toHaveLength(1);
    // And B starts empty.
    void b;
    expect(useXDesign.getState().shapes).toHaveLength(0);
  });

  it("reopening a closed project restores its shapes", async () => {
    await useXDProjects.getState().init();
    const a = await useXDProjects.getState().newProject("A");
    useXDesign.getState().addShape({
      kind: "rect", x: 0, y: 0, w: 10, h: 10, radius: 0,
      fill: "#fff", stroke: "transparent", strokeWidth: 0,
    });
    await useXDProjects.getState().goHome();
    expect(useXDProjects.getState().activeId).toBeNull();
    await useXDProjects.getState().openProject(a);
    expect(useXDesign.getState().shapes).toHaveLength(1);
  });

  it("deletes a project and removes its doc slot", async () => {
    await useXDProjects.getState().init();
    const a = await useXDProjects.getState().newProject("A");
    await useXDProjects.getState().deleteProject(a);
    const s = useXDProjects.getState();
    expect(s.registry).toEqual([]);
    expect(mem.has(`xdesign.project.${a}`)).toBe(false);
    expect(s.activeId).toBeNull();
  });
});
