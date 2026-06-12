import { beforeEach, describe, expect, it, vi } from "vitest";

// The store fire-and-forgets layout persistence through setAppState; stub it
// so tests don't need a live Tauri sqlite connection.
vi.mock("@/lib/db", () => ({ setAppState: vi.fn() }));

import {
  useWorkspace,
  defaultOrionLayout,
} from "@/components/workspace/workspaceStore";
import type {
  LayoutNode,
  LayoutPanel,
  LayoutSplit,
} from "@/components/workspace/types";

function asSplit(n: LayoutNode): LayoutSplit {
  if (n.kind !== "split") throw new Error("expected a split node");
  return n;
}

function lastChild(n: LayoutNode): LayoutNode {
  const s = asSplit(n);
  return s.children[s.children.length - 1]!;
}

function collectPanels(n: LayoutNode): LayoutPanel[] {
  if (n.kind === "panel") return [n];
  return n.children.flatMap(collectPanels);
}

describe("terminal docks at the bottom (Cursor-style)", () => {
  beforeEach(() => {
    useWorkspace.getState().resetLayout(defaultOrionLayout);
  });

  it("wraps the workspace in a vertical split with the terminal full-width at the bottom", () => {
    const id = useWorkspace.getState().openTab({ kind: "terminal" });
    const root = asSplit(useWorkspace.getState().root);

    expect(root.direction).toBe("vertical");
    expect(root.children).toHaveLength(2);

    // Bottom child is the terminal panel, full width (a direct child of the
    // top-level vertical split spans the whole workspace width).
    const bottom = lastChild(root);
    expect(bottom.kind).toBe("panel");
    if (bottom.kind === "panel") {
      expect(bottom.role).toBe("terminal");
      expect(bottom.tabs).toHaveLength(1);
      expect(bottom.tabs[0]!.id).toBe(id);
      expect(bottom.tabs[0]!.descriptor.kind).toBe("terminal");
    }

    // Top child is the original 3-column horizontal split, untouched.
    const top = root.children[0]!;
    expect(top.kind).toBe("split");
    if (top.kind === "split") {
      expect(top.direction).toBe("horizontal");
      expect(top.children).toHaveLength(3);
    }

    // The terminal panel is focused after opening.
    expect(useWorkspace.getState().focusedPanelId).toBe(bottom.kind === "panel" ? bottom.id : null);
  });

  it("ignores panelId (the dropdown passes the clicked panel) and still docks at the bottom", () => {
    const before = asSplit(useWorkspace.getState().root);
    const editor = before.children[1]!;
    const editorId = editor.kind === "panel" ? editor.id : "";

    useWorkspace.getState().openTab({ kind: "terminal" }, { panelId: editorId });
    const root = asSplit(useWorkspace.getState().root);

    expect(root.direction).toBe("vertical");
    const bottom = lastChild(root);
    expect(bottom.kind === "panel" && bottom.role).toBe("terminal");

    // The editor panel did NOT receive the terminal tab.
    const editorPanel = collectPanels(root).find((p) => p.id === editorId);
    expect(editorPanel).toBeTruthy();
    expect(
      editorPanel!.tabs.some((t) => t.descriptor.kind === "terminal"),
    ).toBe(false);
  });

  it("re-opening activates the existing terminal instead of stacking a second dock", () => {
    const id1 = useWorkspace.getState().openTab({ kind: "terminal" });
    const id2 = useWorkspace.getState().openTab({ kind: "terminal" });
    expect(id2).toBe(id1);

    const root = asSplit(useWorkspace.getState().root);
    expect(root.direction).toBe("vertical");
    expect(root.children).toHaveLength(2);
    const terminals = collectPanels(root).filter((p) =>
      p.tabs.some((t) => t.descriptor.kind === "terminal"),
    );
    expect(terminals).toHaveLength(1);
  });

  it("collapses back to the original layout when the terminal tab is closed", () => {
    const id = useWorkspace.getState().openTab({ kind: "terminal" });
    useWorkspace.getState().closeTab(id);

    const root = asSplit(useWorkspace.getState().root);
    expect(root.direction).toBe("horizontal");
    expect(root.children).toHaveLength(3);
    expect(
      collectPanels(root).some((p) =>
        p.tabs.some((t) => t.descriptor.kind === "terminal"),
      ),
    ).toBe(false);
  });

  it("appends to an already-vertical root as a flat sibling (no extra nesting), sizes summing to 100", () => {
    // Hand-build a vertical root with NO terminal so dockTabAtBottom takes the
    // flat-append branch rather than wrapping.
    const verticalRoot: LayoutNode = {
      kind: "split",
      id: "v-root",
      direction: "vertical",
      sizes: [60, 40],
      children: [
        {
          kind: "panel",
          id: "ed1",
          role: "editor",
          activeTabId: "tp",
          tabs: [{ id: "tp", descriptor: { kind: "preview" }, label: "Preview" }],
        },
        {
          kind: "panel",
          id: "ed2",
          role: "editor",
          activeTabId: "tf",
          tabs: [
            { id: "tf", descriptor: { kind: "file", path: "/a.ts" }, label: "a.ts" },
          ],
        },
      ],
    };
    useWorkspace.setState({
      root: verticalRoot,
      focusedPanelId: "ed1",
      lastFilePanelId: null,
    });

    useWorkspace.getState().openTab({ kind: "terminal" });
    const root = asSplit(useWorkspace.getState().root);

    // Same split id — appended in place, not wrapped in a fresh vertical split.
    expect(root.id).toBe("v-root");
    expect(root.direction).toBe("vertical");
    expect(root.children).toHaveLength(3);

    const bottom = lastChild(root);
    expect(bottom.kind === "panel" && bottom.role).toBe("terminal");

    // sizes still sum to 100, terminal gets the docked fraction, existing rows
    // keep their 60:40 ratio (scaled into the remaining 70).
    expect(Math.round(root.sizes.reduce((a, b) => a + b, 0))).toBe(100);
    expect(root.sizes[root.sizes.length - 1]).toBe(30);
    expect(root.sizes[0]! / root.sizes[1]!).toBeCloseTo(60 / 40, 5);
  });
});

describe("Claude Code stays out of the bottom terminal dock", () => {
  beforeEach(() => {
    useWorkspace.getState().resetLayout(defaultOrionLayout);
  });

  it("opens in the editor area on a fresh layout (no bottom dock created)", () => {
    const ccId = useWorkspace.getState().openTab({ kind: "claude-code" });
    const root = asSplit(useWorkspace.getState().root);

    expect(root.direction).toBe("horizontal");
    expect(root.children).toHaveLength(3);
    const host = collectPanels(root).find((p) =>
      p.tabs.some((t) => t.id === ccId),
    );
    expect(host!.role).toBe("editor");
  });

  it("does NOT route into the bottom dock even when a terminal is already docked", () => {
    // Opening the terminal focuses the dock; claude-code must still land in the
    // editor area via its role, not fall into the focused dock.
    useWorkspace.getState().openTab({ kind: "terminal" });
    const ccId = useWorkspace.getState().openTab({ kind: "claude-code" });
    const root = asSplit(useWorkspace.getState().root);

    const host = collectPanels(root).find((p) =>
      p.tabs.some((t) => t.id === ccId),
    );
    expect(host!.role).toBe("editor");

    const dock = collectPanels(root).find((p) => p.role === "terminal");
    expect(dock!.tabs).toHaveLength(1);
    expect(dock!.tabs[0]!.descriptor.kind).toBe("terminal");
  });
});

describe("hydrate role inference for legacy layouts", () => {
  it("keeps a legacy editor panel that holds a stray terminal tab as an editor", () => {
    const legacy: LayoutNode = {
      kind: "split",
      id: "h",
      direction: "horizontal",
      sizes: [16, 60, 24],
      children: [
        {
          kind: "panel",
          id: "p-exp",
          activeTabId: "t-tree",
          tabs: [
            { id: "t-tree", descriptor: { kind: "files-tree" }, label: "Explorer" },
          ],
        },
        {
          kind: "panel",
          id: "p-ed",
          activeTabId: "t-prev",
          tabs: [
            { id: "t-prev", descriptor: { kind: "preview" }, label: "Preview" },
            { id: "t-file", descriptor: { kind: "file", path: "/a.ts" }, label: "a.ts" },
            { id: "t-term", descriptor: { kind: "terminal" }, label: "Terminal" },
          ],
        },
        {
          kind: "panel",
          id: "p-cl",
          activeTabId: "t-cl",
          tabs: [{ id: "t-cl", descriptor: { kind: "claude" }, label: "Orix47" }],
        },
      ],
    };

    useWorkspace.getState().hydrate(legacy, null);
    const root = asSplit(useWorkspace.getState().root);

    expect(collectPanels(root).find((p) => p.id === "p-ed")!.role).toBe("editor");
    expect(collectPanels(root).find((p) => p.id === "p-exp")!.role).toBe(
      "explorer",
    );
    expect(collectPanels(root).find((p) => p.id === "p-cl")!.role).toBe("claude");
  });
});

describe("splitFocusedPanel (⌘\\ split editor right)", () => {
  beforeEach(() => {
    useWorkspace.getState().resetLayout(defaultOrionLayout);
  });

  it("duplicates the active file tab into a new right-hand panel", () => {
    const ws = useWorkspace.getState();
    ws.openTab({ kind: "file", path: "/p/a.ts" }, { label: "a.ts", preferRole: "editor" });
    const before = collectPanels(useWorkspace.getState().root).length;

    useWorkspace.getState().splitFocusedPanel();

    const after = collectPanels(useWorkspace.getState().root);
    expect(after.length).toBe(before + 1);
    const focused = useWorkspace.getState().focusedPanelId;
    const newPanel = after.find((p) => p.id === focused)!;
    expect(newPanel.tabs).toHaveLength(1);
    expect(newPanel.tabs[0]?.descriptor).toEqual({ kind: "file", path: "/p/a.ts" });
    // Duplicate tab, not a moved one — the original stays put.
    const filePanels = after.filter((p) =>
      p.tabs.some((t) => t.descriptor.kind === "file" && t.descriptor.path === "/p/a.ts"),
    );
    expect(filePanels.length).toBe(2);
  });

  it("does nothing when the active tab is not a file", () => {
    useWorkspace.getState().openTab({ kind: "terminal" });
    const before = collectPanels(useWorkspace.getState().root).length;
    useWorkspace.getState().splitFocusedPanel();
    expect(collectPanels(useWorkspace.getState().root).length).toBe(before);
  });
});
