import { beforeEach, describe, expect, it, vi } from "vitest";

// The store fire-and-forgets layout persistence through setAppState; stub it
// so tests don't need a live Tauri sqlite connection.
vi.mock("@/lib/db", () => ({ setAppState: vi.fn() }));

import { setAppState } from "@/lib/db";
import {
  useWorkspace,
  defaultOrionLayout,
  preferredSizes,
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

  it("docks under the editor area, Cursor-style, leaving the sidebar and agent full height", () => {
    const id = useWorkspace.getState().openTab({ kind: "terminal" });
    const root = asSplit(useWorkspace.getState().root);

    expect(root.direction).toBe("horizontal");
    expect(root.children.map((c) => (c.kind === "panel" ? c.role : "split"))).toEqual(["explorer", "split", "claude"]);

    const middle = asSplit(root.children[1]!);
    expect(middle.direction).toBe("vertical");
    const top = middle.children[0]!;
    expect(top.kind === "panel" && top.role).toBe("editor");
    const bottom = lastChild(middle);
    expect(bottom.kind).toBe("panel");
    if (bottom.kind === "panel") {
      expect(bottom.role).toBe("terminal");
      expect(bottom.tabs).toHaveLength(1);
      expect(bottom.tabs[0]!.id).toBe(id);
    }
    expect(middle.sizes).toEqual([70, 30]);
    expect(useWorkspace.getState().focusedPanelId).toBe(bottom.kind === "panel" ? bottom.id : null);
  });

  it("ignores panelId (the dropdown passes the clicked panel) and still docks at the bottom", () => {
    const before = asSplit(useWorkspace.getState().root);
    const editor = before.children[1]!;
    const editorId = editor.kind === "panel" ? editor.id : "";

    useWorkspace.getState().openTab({ kind: "terminal" }, { panelId: editorId });
    const root = asSplit(useWorkspace.getState().root);

    const bottom = lastChild(asSplit(root.children[1]!));
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
    expect(asSplit(root.children[1]!).children).toHaveLength(2);
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

describe("togglePanelByRole (⌘B sidebar / ⌘J right rail)", () => {
  beforeEach(() => {
    useWorkspace.getState().resetLayout(defaultOrionLayout);
  });

  it("never hides the explorer: ⌘B only focuses it", () => {
    const before = collectPanels(useWorkspace.getState().root);
    const explorer = before.find((p) => p.role === "explorer")!;
    expect(explorer).toBeTruthy();

    useWorkspace.getState().togglePanelByRole("explorer");
    const panels = collectPanels(useWorkspace.getState().root);
    expect(panels).toHaveLength(before.length);
    expect(panels.some((p) => p.id === explorer.id)).toBe(true);
    expect(useWorkspace.getState().focusedPanelId).toBe(explorer.id);
  });

  it("hides the claude rail and restores it on the right", () => {
    useWorkspace.getState().togglePanelByRole("claude");
    let panels = collectPanels(useWorkspace.getState().root);
    expect(panels.some((p) => p.role === "claude")).toBe(false);

    useWorkspace.getState().togglePanelByRole("claude");
    const root = asSplit(useWorkspace.getState().root);
    const last = lastChild(root);
    expect(last.kind === "panel" && last.role).toBe("claude");
  });

  it("preserves the exact tabs of a hidden panel when restoring", () => {
    // Stack a second AI tab into the claude rail, then hide + show it.
    const claude = collectPanels(useWorkspace.getState().root).find(
      (p) => p.role === "claude",
    )!;
    useWorkspace
      .getState()
      .openTab({ kind: "claude-code" }, { panelId: claude.id });
    const railBefore = collectPanels(useWorkspace.getState().root).find(
      (p) => p.role === "claude",
    )!;
    const tabCount = railBefore.tabs.length;
    expect(tabCount).toBeGreaterThan(1);

    useWorkspace.getState().togglePanelByRole("claude");
    useWorkspace.getState().togglePanelByRole("claude");

    const railAfter = collectPanels(useWorkspace.getState().root).find(
      (p) => p.role === "claude",
    )!;
    expect(railAfter.tabs).toHaveLength(tabCount);
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

describe("divider resizing", () => {
  beforeEach(() => {
    useWorkspace.getState().resetLayout(defaultOrionLayout);
    vi.mocked(setAppState).mockClear();
  });

  it("ignores a settled layout that matches the stored sizes", () => {
    const root = asSplit(useWorkspace.getState().root);
    useWorkspace.getState().setSplitSizes(root.id, [16.01, 59.99, 24]);
    expect(useWorkspace.getState().root).toBe(root);
    expect(setAppState).not.toHaveBeenCalled();
  });

  it("commits a real change and ignores unknown splits", () => {
    const root = asSplit(useWorkspace.getState().root);
    useWorkspace.getState().setSplitSizes("missing", [50, 50]);
    expect(useWorkspace.getState().root).toBe(root);
    useWorkspace.getState().setSplitSizes(root.id, [22, 54, 24]);
    expect(asSplit(useWorkspace.getState().root).sizes).toEqual([22, 54, 24]);
  });

  it("resets side surfaces to their comfortable width and shares the rest", () => {
    const root = asSplit(useWorkspace.getState().root);
    expect(preferredSizes(root)).toEqual([16, 60, 24]);
    useWorkspace.getState().openTab({ kind: "terminal" });
    const vertical = asSplit(asSplit(useWorkspace.getState().root).children[1]!);
    expect(preferredSizes(vertical)).toEqual([70, 30]);
  });
});

describe("the explorer anchor", () => {
  beforeEach(() => {
    useWorkspace.getState().resetLayout(defaultOrionLayout);
  });

  const explorerOf = () => collectPanels(useWorkspace.getState().root).find((p) => p.role === "explorer")!;

  it("can't be closed, as a tab or as a panel", () => {
    const explorer = explorerOf();
    useWorkspace.getState().closeTab(explorer.tabs[0]!.id);
    useWorkspace.getState().closePanel(explorer.id);
    expect(explorerOf().id).toBe(explorer.id);
    expect(explorerOf().tabs).toHaveLength(1);
  });

  it("keeps its tree and takes no other tabs", () => {
    const explorer = explorerOf();
    useWorkspace.getState().openTab({ kind: "file", path: "/p/a.ts" }, { label: "a.ts" });
    const editor = collectPanels(useWorkspace.getState().root).find((p) => p.role === "editor")!;
    useWorkspace.getState().dropTabOnPanel(explorer.tabs[0]!.id, editor.id, "right");
    useWorkspace.getState().moveTabToPanel(editor.tabs[0]!.id, explorer.id);
    expect(explorerOf().tabs.map((t) => t.descriptor.kind)).toEqual(["files-tree"]);
    expect(collectPanels(useWorkspace.getState().root).find((p) => p.id === editor.id)!.tabs).toHaveLength(editor.tabs.length);
  });

  it("gives a closed pane's share to its neighbour, leaving the explorer as it was", () => {
    const claude = collectPanels(useWorkspace.getState().root).find((p) => p.role === "claude")!;
    useWorkspace.getState().closeTab(claude.tabs[0]!.id);
    const root = asSplit(useWorkspace.getState().root);
    expect(root.children.map((c) => (c.kind === "panel" ? c.role : "split"))).toEqual(["explorer", "editor"]);
    expect(root.sizes[0]).toBeCloseTo(16, 5);
    expect(root.sizes[1]).toBeCloseTo(84, 5);
  });

  it("is restored on the left of a saved layout that lost it", () => {
    const legacy: LayoutNode = {
      kind: "split",
      id: "h",
      direction: "horizontal",
      sizes: [70, 30],
      children: [
        { kind: "panel", id: "p-ed", role: "editor", activeTabId: "t-prev", tabs: [{ id: "t-prev", descriptor: { kind: "preview" }, label: "Preview" }] },
        { kind: "panel", id: "p-cl", role: "claude", activeTabId: "t-cl", tabs: [{ id: "t-cl", descriptor: { kind: "claude" }, label: "Orix47" }] },
      ],
    };
    useWorkspace.getState().hydrate(legacy, null);
    const first = asSplit(useWorkspace.getState().root).children[0]!;
    expect(first.kind === "panel" && first.role).toBe("explorer");
  });
});

describe("Cursor-style editor group", () => {
  beforeEach(() => {
    useWorkspace.getState().resetLayout(defaultOrionLayout);
  });

  const editorOf = () => collectPanels(useWorkspace.getState().root).find((p) => p.role === "editor")!;

  it("starts with an empty editor group between the sidebar and the agent", () => {
    const root = asSplit(useWorkspace.getState().root);
    expect(root.children.map((c) => (c.kind === "panel" ? c.role : "split"))).toEqual(["explorer", "editor", "claude"]);
    expect(editorOf().tabs).toHaveLength(0);
  });

  it("opens files as tabs in one group instead of new panes", () => {
    const ws = useWorkspace.getState();
    ws.openTab({ kind: "file", path: "/p/a.ts" }, { label: "a.ts" });
    ws.openTab({ kind: "file", path: "/p/b.ts" }, { label: "b.ts" });
    expect(collectPanels(useWorkspace.getState().root)).toHaveLength(3);
    expect(editorOf().tabs.map((t) => t.label)).toEqual(["a.ts", "b.ts"]);
    expect(editorOf().activeTabId).toBe(editorOf().tabs[1]!.id);
  });

  it("replaces the preview tab on the next single-click open", () => {
    const ws = useWorkspace.getState();
    ws.openTab({ kind: "file", path: "/p/a.ts" }, { label: "a.ts", preview: true });
    ws.openTab({ kind: "file", path: "/p/b.ts" }, { label: "b.ts", preview: true });
    expect(editorOf().tabs.map((t) => [t.label, !!t.preview])).toEqual([["b.ts", true]]);
  });

  it("keeps a pinned tab and pins a preview opened explicitly", () => {
    const ws = useWorkspace.getState();
    ws.openTab({ kind: "file", path: "/p/a.ts" }, { label: "a.ts" });
    ws.openTab({ kind: "file", path: "/p/b.ts" }, { label: "b.ts", preview: true });
    ws.openTab({ kind: "file", path: "/p/b.ts" }, { label: "b.ts" });
    ws.openTab({ kind: "file", path: "/p/c.ts" }, { label: "c.ts", preview: true });
    expect(editorOf().tabs.map((t) => [t.label, !!t.preview])).toEqual([["a.ts", false], ["b.ts", false], ["c.ts", true]]);
  });

  it("pins a preview tab when its file is edited or the tab is double-clicked", () => {
    const ws = useWorkspace.getState();
    ws.openTab({ kind: "file", path: "/p/a.ts" }, { label: "a.ts", preview: true });
    useWorkspace.getState().pinFile("/p/a.ts");
    expect(editorOf().tabs[0]!.preview).toBe(false);
    ws.openTab({ kind: "file", path: "/p/b.ts" }, { label: "b.ts", preview: true });
    useWorkspace.getState().pinTab(editorOf().tabs[1]!.id);
    expect(editorOf().tabs.map((t) => !!t.preview)).toEqual([false, false]);
  });

  it("keeps the editor group in place when its last tab closes", () => {
    const id = useWorkspace.getState().openTab({ kind: "file", path: "/p/a.ts" }, { label: "a.ts" });
    useWorkspace.getState().closeTab(id);
    const root = asSplit(useWorkspace.getState().root);
    expect(root.children.map((c) => (c.kind === "panel" ? c.role : "split"))).toEqual(["explorer", "editor", "claude"]);
    expect(editorOf().tabs).toHaveLength(0);
  });

  it("collapses a split editor group when its last tab closes", () => {
    useWorkspace.getState().openTab({ kind: "file", path: "/p/a.ts" }, { label: "a.ts" });
    useWorkspace.getState().splitFocusedPanel();
    const dup = useWorkspace.getState().findPanel(useWorkspace.getState().focusedPanelId!)!;
    useWorkspace.getState().closeTab(dup.tabs[0]!.id);
    expect(collectPanels(useWorkspace.getState().root)).toHaveLength(3);
  });
});
