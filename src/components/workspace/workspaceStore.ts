import { create } from "zustand";
import { ulid } from "ulid";
import { setAppState } from "@/lib/db";
import {
  descriptorKey,
  defaultLabel,
  type DropZone,
  type LayoutNode,
  type LayoutPanel,
  type LayoutSplit,
  type PanelRole,
  type Tab,
  type TabDescriptor,
} from "@/components/workspace/types";

const PERSIST_KEY = "workspace.layout";
const PERSIST_FOCUSED = "workspace.focusedPanel";

type WorkspaceState = {
  root: LayoutNode;
  focusedPanelId: string | null;
  /**
   * The id of the panel that most recently received a file tab. Each new
   * file opens to the right of this panel, fanning out across the editor
   * area. Reset when the panel is closed or contains no file tabs.
   */
  lastFilePanelId: string | null;

  // queries
  findPanel: (panelId: string) => LayoutPanel | null;
  findTab: (tabId: string) => { panelId: string; tab: Tab } | null;

  // tab operations
  openTab: (
    descriptor: TabDescriptor,
    opts?: { label?: string; panelId?: string; preferRole?: PanelRole },
  ) => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (panelId: string, tabId: string) => void;
  cycleActive: (panelId: string, dir: 1 | -1) => void;
  setLabel: (tabId: string, label: string) => void;
  focusPanel: (panelId: string) => void;

  // panel moves
  moveTabToPanel: (tabId: string, targetPanelId: string) => void;
  dropTabOnPanel: (tabId: string, targetPanelId: string, zone: DropZone) => void;

  // layout
  setSplitSizes: (splitId: string, sizes: number[]) => void;
  closePanel: (panelId: string) => void;
  resetLayout: (factory: () => LayoutNode) => void;
  hydrate: (root: LayoutNode | null, focusedPanelId: string | null) => void;
};

function isPanel(n: LayoutNode): n is LayoutPanel {
  return n.kind === "panel";
}

function newPanel(tabs: Tab[] = [], role?: PanelRole): LayoutPanel {
  return {
    kind: "panel",
    id: ulid(),
    tabs,
    activeTabId: tabs[0]?.id ?? null,
    ...(role ? { role } : {}),
  };
}

function defaultRoleForDescriptor(d: TabDescriptor): PanelRole | undefined {
  switch (d.kind) {
    case "file":
    case "note":
    case "asset-detail":
    case "asset-grid":
    case "preview":
      return "editor";
    case "files-tree":
      return "explorer";
    case "claude":
      return "claude";
    case "claude-code":
      // Claude Code is a full TUI — it belongs in the editor area, NOT the
      // bottom terminal dock. (If it shared the terminal's role it would get
      // pulled into the slim full-width dock whenever one exists.)
      return "editor";
    case "terminal":
      return "terminal";
  }
}

/**
 * For panels persisted without a `role` (pre-role layouts), infer one from
 * the descriptor kinds of the tabs they contain. files-tree → explorer,
 * claude → claude. Editor content is checked BEFORE a bare terminal tab so a
 * legacy editor panel that merely happens to hold a terminal tab (the old
 * terminal-opens-as-a-tab behavior) stays an editor — only a panel whose tabs
 * are terminal/console-only infers the "terminal" role.
 */
function inferPanelRole(panel: LayoutPanel): PanelRole | undefined {
  if (panel.role) return panel.role;
  const kinds = new Set(panel.tabs.map((t) => t.descriptor.kind));
  if (kinds.has("files-tree")) return "explorer";
  if (kinds.has("claude")) return "claude";
  if (
    kinds.has("file") ||
    kinds.has("preview") ||
    kinds.has("note") ||
    kinds.has("asset-grid") ||
    kinds.has("asset-detail")
  ) {
    return "editor";
  }
  if (kinds.has("terminal")) return "terminal";
  return undefined;
}

function assignInferredRoles(node: LayoutNode): LayoutNode {
  if (isPanel(node)) {
    const role = inferPanelRole(node);
    return role ? { ...node, role } : node;
  }
  return { ...node, children: node.children.map(assignInferredRoles) };
}

function findPanelByRole(node: LayoutNode, role: PanelRole): LayoutPanel | null {
  if (isPanel(node)) return node.role === role ? node : null;
  for (const c of node.children) {
    const hit = findPanelByRole(c, role);
    if (hit) return hit;
  }
  return null;
}

/**
 * Strip panels with zero tabs from the tree (collapses parent splits that
 * end up with a single child). Called after hydrate to heal legacy layouts
 * that started with an empty editor panel.
 */
function pruneEmptyPanels(node: LayoutNode): LayoutNode | null {
  if (isPanel(node)) return node.tabs.length === 0 ? null : node;
  const kept: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const r = pruneEmptyPanels(c);
    if (r) {
      kept.push(r);
      sizes.push(node.sizes[i] ?? 50);
    }
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]!;
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return { ...node, sizes: sizes.map((s) => (s / total) * 100), children: kept };
}

function newTab(descriptor: TabDescriptor, label?: string): Tab {
  return {
    id: ulid(),
    descriptor,
    label: label ?? defaultLabel(descriptor),
  };
}

// ============================================================
// Tree traversal helpers — every mutation returns a fresh tree.
// ============================================================

function mapTree(node: LayoutNode, fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  const transformed = fn(node);
  if (transformed.kind === "split") {
    return {
      ...transformed,
      children: transformed.children.map((c) => mapTree(c, fn)),
    };
  }
  return transformed;
}

function findPanelIn(node: LayoutNode, panelId: string): LayoutPanel | null {
  if (isPanel(node)) return node.id === panelId ? node : null;
  for (const c of node.children) {
    const hit = findPanelIn(c, panelId);
    if (hit) return hit;
  }
  return null;
}

function findTabIn(
  node: LayoutNode,
  tabId: string,
): { panelId: string; tab: Tab } | null {
  if (isPanel(node)) {
    const tab = node.tabs.find((t) => t.id === tabId);
    return tab ? { panelId: node.id, tab } : null;
  }
  for (const c of node.children) {
    const hit = findTabIn(c, tabId);
    if (hit) return hit;
  }
  return null;
}

function findPanelByDescriptor(
  node: LayoutNode,
  key: string,
): { panel: LayoutPanel; tab: Tab } | null {
  if (isPanel(node)) {
    const tab = node.tabs.find((t) => descriptorKey(t.descriptor) === key);
    return tab ? { panel: node, tab } : null;
  }
  for (const c of node.children) {
    const hit = findPanelByDescriptor(c, key);
    if (hit) return hit;
  }
  return null;
}

function firstPanel(node: LayoutNode): LayoutPanel | null {
  if (isPanel(node)) return node;
  for (const c of node.children) {
    const hit = firstPanel(c);
    if (hit) return hit;
  }
  return null;
}

/** Replace a panel's contents (immutable). */
function patchPanel(
  root: LayoutNode,
  panelId: string,
  patch: Partial<LayoutPanel>,
): LayoutNode {
  return mapTree(root, (n) => {
    if (isPanel(n) && n.id === panelId) return { ...n, ...patch };
    return n;
  });
}

/**
 * Remove a panel from the tree by id. If the panel's parent split now has
 * only one child, collapse the split into its surviving child.
 * Returns null if the entire tree would be empty.
 */
function removePanel(node: LayoutNode, panelId: string): LayoutNode | null {
  if (isPanel(node)) return node.id === panelId ? null : node;
  const kids: LayoutNode[] = [];
  const kept: number[] = [];
  node.children.forEach((c, i) => {
    const r = removePanel(c, panelId);
    if (r) {
      kids.push(r);
      kept.push(i);
    }
  });
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0]!;
  const sizes = kept.map((i) => node.sizes[i] ?? 50);
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  const normalized = sizes.map((s) => (s / total) * 100);
  return { ...node, sizes: normalized, children: kids };
}

/**
 * Splice a tab out of whatever panel it currently lives in. Returns the new
 * tree (or null if the tree becomes empty) and the extracted tab.
 */
function extractTab(
  node: LayoutNode,
  tabId: string,
): { tree: LayoutNode | null; tab: Tab | null; panelId: string | null } {
  let extracted: Tab | null = null;
  let sourcePanelId: string | null = null;

  function recur(n: LayoutNode): LayoutNode | null {
    if (isPanel(n)) {
      const idx = n.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0) return n;
      extracted = n.tabs[idx]!;
      sourcePanelId = n.id;
      const nextTabs = n.tabs.filter((t) => t.id !== tabId);
      const nextActive =
        n.activeTabId === tabId
          ? (nextTabs[Math.min(idx, nextTabs.length - 1)]?.id ?? null)
          : n.activeTabId;
      if (nextTabs.length === 0) return null; // panel becomes empty → caller decides
      return { ...n, tabs: nextTabs, activeTabId: nextActive };
    }
    const newKids: LayoutNode[] = [];
    const newSizes: number[] = [];
    n.children.forEach((c, i) => {
      const r = recur(c);
      if (r) {
        newKids.push(r);
        newSizes.push(n.sizes[i] ?? 50);
      }
    });
    if (newKids.length === 0) return null;
    if (newKids.length === 1) return newKids[0]!;
    const total = newSizes.reduce((a, b) => a + b, 0) || 1;
    return { ...n, sizes: newSizes.map((s) => (s / total) * 100), children: newKids };
  }

  const next = recur(node);
  return { tree: next, tab: extracted, panelId: sourcePanelId };
}

/** Insert a tab into an existing panel at the end and activate it. */
function insertTabIntoPanel(
  root: LayoutNode,
  panelId: string,
  tab: Tab,
): LayoutNode {
  return patchPanel(root, panelId, {
    tabs: [
      ...(findPanelIn(root, panelId)?.tabs ?? []),
      tab,
    ],
    activeTabId: tab.id,
  });
}

/**
 * Split the targetPanel by creating a new split that adjoins it with a new
 * sibling panel containing `tab`. If the target's parent is already a split
 * in the matching direction, the new panel is inserted as a flat sibling
 * (no extra nesting) so multi-file fan-out stays visually clean.
 *
 * Returns the new tree plus the id of the freshly-created panel.
 */
function splitPanelWithTab(
  root: LayoutNode,
  targetPanelId: string,
  tab: Tab,
  zone: Exclude<DropZone, "tabs">,
  role?: PanelRole,
): { tree: LayoutNode; newPanelId: string } {
  const direction: "horizontal" | "vertical" =
    zone === "left" || zone === "right" ? "horizontal" : "vertical";
  const newPanelId = ulid();
  const newPanelNode: LayoutPanel = {
    kind: "panel",
    id: newPanelId,
    tabs: [tab],
    activeTabId: tab.id,
    ...(role ? { role } : {}),
  };
  const insertBefore = zone === "left" || zone === "top";

  function recur(n: LayoutNode): LayoutNode {
    if (n.kind === "split") {
      // Flat-insert: if this split is in the matching direction and one of
      // its direct children is the target panel, add the new panel as a
      // sibling here without introducing another split layer.
      if (n.direction === direction) {
        const idx = n.children.findIndex(
          (c) => isPanel(c) && c.id === targetPanelId,
        );
        if (idx >= 0) {
          const insertAt = insertBefore ? idx : idx + 1;
          const anchorSize = n.sizes[idx] ?? 100 / n.children.length;
          const newSizes = [...n.sizes];
          newSizes[idx] = anchorSize / 2;
          newSizes.splice(insertAt, 0, anchorSize / 2);
          const newChildren = [...n.children];
          newChildren.splice(insertAt, 0, newPanelNode);
          return { ...n, sizes: newSizes, children: newChildren };
        }
      }
      return { ...n, children: n.children.map(recur) };
    }
    if (isPanel(n) && n.id === targetPanelId) {
      const children: LayoutNode[] = insertBefore
        ? [newPanelNode, n]
        : [n, newPanelNode];
      const split: LayoutSplit = {
        kind: "split",
        id: ulid(),
        direction,
        sizes: [50, 50],
        children,
      };
      return split;
    }
    return n;
  }
  return { tree: recur(root), newPanelId };
}

/**
 * Dock a tab at the bottom of the WHOLE workspace (Cursor-style integrated
 * terminal): a full-width panel below everything else. If the root is already
 * a vertical split, the new panel is appended as a flat sibling at the bottom
 * (no extra nesting); otherwise the entire tree is wrapped in a new vertical
 * split with the existing layout on top. Returns the new tree plus the id of
 * the freshly-created panel.
 */
function dockTabAtBottom(
  root: LayoutNode,
  tab: Tab,
  role: PanelRole,
  fraction = 30,
): { tree: LayoutNode; newPanelId: string } {
  const newPanelId = ulid();
  const panel: LayoutPanel = {
    kind: "panel",
    id: newPanelId,
    tabs: [tab],
    activeTabId: tab.id,
    role,
  };
  if (root.kind === "split" && root.direction === "vertical") {
    const total = root.sizes.reduce((a, b) => a + b, 0) || 1;
    const keep = 100 - fraction;
    const scaled = root.sizes.map((s) => (s / total) * keep);
    return {
      tree: {
        ...root,
        sizes: [...scaled, fraction],
        children: [...root.children, panel],
      },
      newPanelId,
    };
  }
  return {
    tree: {
      kind: "split",
      id: ulid(),
      direction: "vertical",
      sizes: [100 - fraction, fraction],
      children: [root, panel],
    },
    newPanelId,
  };
}

// ============================================================
// Initial layout factory — mirrors today's Orion look.
// ============================================================

export function defaultOrionLayout(): LayoutNode {
  // Three-column layout. The middle "editor" panel hosts file tabs and the
  // preview tab side-by-side — files open here by default via the `editor`
  // role. Terminal isn't part of the default layout; ⌘` opens it on demand.
  const filesPanel = newPanel([newTab({ kind: "files-tree" })], "explorer");
  const editorPanel = newPanel([newTab({ kind: "preview" })], "editor");
  const claudePanel = newPanel([newTab({ kind: "claude" })], "claude");

  return {
    kind: "split",
    id: ulid(),
    direction: "horizontal",
    sizes: [16, 60, 24],
    children: [filesPanel, editorPanel, claudePanel],
  };
}

function persistLayout(root: LayoutNode, focusedPanelId: string | null) {
  void setAppState(PERSIST_KEY, root);
  void setAppState(PERSIST_FOCUSED, focusedPanelId);
}

// ============================================================
// Store
// ============================================================

const initialRoot = defaultOrionLayout();
const initialFocus = firstPanel(initialRoot)?.id ?? null;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: initialRoot,
  focusedPanelId: initialFocus,
  lastFilePanelId: null,

  findPanel: (panelId) => findPanelIn(get().root, panelId),
  findTab: (tabId) => findTabIn(get().root, tabId),

  openTab: (descriptor, opts) => {
    const key = descriptorKey(descriptor);
    const root = get().root;

    // Already open → activate it.
    const existing = findPanelByDescriptor(root, key);
    if (existing) {
      const nextRoot = patchPanel(root, existing.panel.id, {
        activeTabId: existing.tab.id,
      });
      const nextLastFile =
        descriptor.kind === "file"
          ? existing.panel.id
          : get().lastFilePanelId;
      set({
        root: nextRoot,
        focusedPanelId: existing.panel.id,
        lastFilePanelId: nextLastFile,
      });
      persistLayout(nextRoot, existing.panel.id);
      return existing.tab.id;
    }

    const tab = newTab(descriptor, opts?.label);
    const roleHint = opts?.preferRole ?? defaultRoleForDescriptor(descriptor);

    // Terminal docks at the bottom of the whole workspace (Cursor-style),
    // full width — never as a tab in the clicked panel. (`opts.panelId` from
    // the panel "+" dropdown is intentionally ignored for terminals.) A second
    // terminal tabs into the existing dock rather than stacking another strip.
    if (descriptor.kind === "terminal") {
      const dock = findPanelByRole(root, "terminal");
      if (dock) {
        const nextRoot = insertTabIntoPanel(root, dock.id, tab);
        set({ root: nextRoot, focusedPanelId: dock.id });
        persistLayout(nextRoot, dock.id);
        return tab.id;
      }
      const { tree: nextRoot, newPanelId } = dockTabAtBottom(
        root,
        tab,
        "terminal",
      );
      set({ root: nextRoot, focusedPanelId: newPanelId });
      persistLayout(nextRoot, newPanelId);
      return tab.id;
    }

    // Files (and notes/assets) each get their own panel, fanning out to the
    // right of the most recent file panel (or the editor anchor).
    if (
      descriptor.kind === "file" ||
      descriptor.kind === "note" ||
      descriptor.kind === "asset-detail"
    ) {
      const lastId = get().lastFilePanelId;
      const lastPanel = lastId ? findPanelIn(root, lastId) : null;
      const editorPanel = findPanelByRole(root, "editor");
      const anchor =
        opts?.panelId
          ? findPanelIn(root, opts.panelId)
          : lastPanel ?? editorPanel ?? firstPanel(root);

      if (!anchor) {
        const fresh = newPanel([tab], "editor");
        set({
          root: fresh,
          focusedPanelId: fresh.id,
          lastFilePanelId: fresh.id,
        });
        persistLayout(fresh, fresh.id);
        return tab.id;
      }

      const { tree: nextRoot, newPanelId } = splitPanelWithTab(
        root,
        anchor.id,
        tab,
        "right",
      );
      set({
        root: nextRoot,
        focusedPanelId: newPanelId,
        lastFilePanelId: newPanelId,
      });
      persistLayout(nextRoot, newPanelId);
      return tab.id;
    }

    // Singleton-style tabs (preview / claude / files-tree / terminal): land
    // in their role panel if one exists, otherwise the focused panel.
    const rolePanel = roleHint ? findPanelByRole(root, roleHint) : null;
    const targetPanelId =
      opts?.panelId ??
      rolePanel?.id ??
      get().focusedPanelId ??
      firstPanel(root)?.id ??
      null;

    if (!targetPanelId) {
      const fresh = newPanel([tab], roleHint);
      set({ root: fresh, focusedPanelId: fresh.id });
      persistLayout(fresh, fresh.id);
      return tab.id;
    }

    const nextRoot = insertTabIntoPanel(root, targetPanelId, tab);
    set({ root: nextRoot, focusedPanelId: targetPanelId });
    persistLayout(nextRoot, targetPanelId);
    return tab.id;
  },

  closeTab: (tabId) => {
    const { tree } = extractTab(get().root, tabId);
    if (!tree) {
      const fresh = defaultOrionLayout();
      const focus = firstPanel(fresh)?.id ?? null;
      set({ root: fresh, focusedPanelId: focus, lastFilePanelId: null });
      persistLayout(fresh, focus);
      return;
    }
    const focused = get().focusedPanelId;
    const focusedPanel = focused ? findPanelIn(tree, focused) : null;
    const nextFocus = focusedPanel ? focused : (firstPanel(tree)?.id ?? null);
    const lastId = get().lastFilePanelId;
    const lastStillValid = lastId
      ? findPanelIn(tree, lastId) !== null
      : false;
    set({
      root: tree,
      focusedPanelId: nextFocus,
      lastFilePanelId: lastStillValid ? lastId : null,
    });
    persistLayout(tree, nextFocus);
  },

  setActiveTab: (panelId, tabId) => {
    const nextRoot = patchPanel(get().root, panelId, { activeTabId: tabId });
    set({ root: nextRoot, focusedPanelId: panelId });
    persistLayout(nextRoot, panelId);
  },

  cycleActive: (panelId, dir) => {
    const p = findPanelIn(get().root, panelId);
    if (!p || p.tabs.length === 0) return;
    const idx = p.tabs.findIndex((t) => t.id === p.activeTabId);
    const nextIdx = (idx + dir + p.tabs.length) % p.tabs.length;
    const next = p.tabs[nextIdx]!;
    get().setActiveTab(panelId, next.id);
  },

  setLabel: (tabId, label) => {
    const root = get().root;
    const nextRoot = mapTree(root, (n) => {
      if (!isPanel(n)) return n;
      const idx = n.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0) return n;
      const nextTabs = n.tabs.slice();
      nextTabs[idx] = { ...nextTabs[idx]!, label };
      return { ...n, tabs: nextTabs };
    });
    set({ root: nextRoot });
    persistLayout(nextRoot, get().focusedPanelId);
  },

  focusPanel: (panelId) => {
    set({ focusedPanelId: panelId });
    void setAppState(PERSIST_FOCUSED, panelId);
  },

  moveTabToPanel: (tabId, targetPanelId) => {
    const { tree, tab } = extractTab(get().root, tabId);
    if (!tab) return;
    // If the extraction left no panels, create a fresh tree with the moved tab.
    if (!tree) {
      const fresh = newPanel([tab]);
      set({ root: fresh, focusedPanelId: fresh.id });
      persistLayout(fresh, fresh.id);
      return;
    }
    // Target panel may have disappeared during extraction (if it was the only
    // panel in a split that collapsed). Fall back to the first panel.
    const target = findPanelIn(tree, targetPanelId);
    const targetId = target ? targetPanelId : firstPanel(tree)!.id;
    const nextRoot = insertTabIntoPanel(tree, targetId, tab);
    set({ root: nextRoot, focusedPanelId: targetId });
    persistLayout(nextRoot, targetId);
  },

  dropTabOnPanel: (tabId, targetPanelId, zone) => {
    if (zone === "tabs") {
      get().moveTabToPanel(tabId, targetPanelId);
      return;
    }
    const { tree, tab } = extractTab(get().root, tabId);
    if (!tab) return;
    if (!tree) {
      const fresh = newPanel([tab]);
      set({ root: fresh, focusedPanelId: fresh.id });
      persistLayout(fresh, fresh.id);
      return;
    }
    const target = findPanelIn(tree, targetPanelId);
    if (!target) {
      // Target gone → just dock into first available panel.
      const fp = firstPanel(tree)!;
      const nextRoot = insertTabIntoPanel(tree, fp.id, tab);
      set({ root: nextRoot, focusedPanelId: fp.id });
      persistLayout(nextRoot, fp.id);
      return;
    }
    const { tree: nextRoot, newPanelId } = splitPanelWithTab(
      tree,
      targetPanelId,
      tab,
      zone,
    );
    set({ root: nextRoot, focusedPanelId: newPanelId });
    persistLayout(nextRoot, newPanelId);
  },

  closePanel: (panelId) => {
    const next = removePanel(get().root, panelId);
    if (!next) {
      const fresh = defaultOrionLayout();
      const focus = firstPanel(fresh)?.id ?? null;
      set({ root: fresh, focusedPanelId: focus });
      persistLayout(fresh, focus);
      return;
    }
    const focus = get().focusedPanelId === panelId
      ? firstPanel(next)?.id ?? null
      : get().focusedPanelId;
    set({ root: next, focusedPanelId: focus });
    persistLayout(next, focus);
  },

  setSplitSizes: (splitId, sizes) => {
    const root = get().root;
    const nextRoot = mapTree(root, (n) => {
      if (n.kind === "split" && n.id === splitId) return { ...n, sizes };
      return n;
    });
    set({ root: nextRoot });
    persistLayout(nextRoot, get().focusedPanelId);
  },

  resetLayout: (factory) => {
    const root = factory();
    const focus = firstPanel(root)?.id ?? null;
    set({ root, focusedPanelId: focus });
    persistLayout(root, focus);
  },

  hydrate: (root, focusedPanelId) => {
    if (!root) return;
    // Heal legacy layouts: drop empty panels, then back-fill panel roles
    // based on tab content so route-by-role works for layouts persisted
    // before the role field existed.
    const pruned = pruneEmptyPanels(root);
    const withRoles = pruned ? assignInferredRoles(pruned) : null;
    const effective = withRoles ?? defaultOrionLayout();
    const focus =
      focusedPanelId && findPanelIn(effective, focusedPanelId)
        ? focusedPanelId
        : firstPanel(effective)?.id ?? null;
    set({ root: effective, focusedPanelId: focus, lastFilePanelId: null });
    if (!withRoles || withRoles !== root) persistLayout(effective, focus);
  },
}));

// ============================================================
// Query helpers — read-only walks over the layout tree.
// ============================================================

export function allTabs(root: LayoutNode): Tab[] {
  if (isPanel(root)) return root.tabs;
  return root.children.flatMap(allTabs);
}

export function activeTabInPanel(root: LayoutNode, panelId: string): Tab | null {
  const p = findPanelIn(root, panelId);
  if (!p) return null;
  return p.tabs.find((t) => t.id === p.activeTabId) ?? null;
}

export function activeTabInFocusedPanel(
  root: LayoutNode,
  focusedPanelId: string | null,
): Tab | null {
  if (!focusedPanelId) return null;
  return activeTabInPanel(root, focusedPanelId);
}

export function activeFilePathInFocused(
  root: LayoutNode,
  focusedPanelId: string | null,
): string | null {
  const t = activeTabInFocusedPanel(root, focusedPanelId);
  return t && t.descriptor.kind === "file" ? t.descriptor.path : null;
}

export function findTabByDescriptorKey(root: LayoutNode, key: string): Tab | null {
  return findPanelByDescriptor(root, key)?.tab ?? null;
}

export function findFileTab(root: LayoutNode, path: string): Tab | null {
  return findTabByDescriptorKey(root, `file:${path}`);
}

// Re-export for callers.
export { findPanelIn, findTabIn, removePanel };
