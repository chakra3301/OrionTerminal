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
  /** Panels hidden via togglePanelByRole, keyed by role so they restore intact. */
  hiddenPanels: Partial<Record<PanelRole, LayoutPanel>>;

  // queries
  findPanel: (panelId: string) => LayoutPanel | null;
  findTab: (tabId: string) => { panelId: string; tab: Tab } | null;

  // tab operations
  openTab: (
    descriptor: TabDescriptor,
    opts?: { label?: string; panelId?: string; preferRole?: PanelRole; preview?: boolean },
  ) => string;
  closeTab: (tabId: string) => void;
  /** Turn a preview tab into a regular one (double-click on the tab). */
  pinTab: (tabId: string) => void;
  /** Pin the preview tab showing this file, if any (first edit pins, like Cursor). */
  pinFile: (path: string) => void;
  setActiveTab: (panelId: string, tabId: string) => void;
  cycleActive: (panelId: string, dir: 1 | -1) => void;
  setLabel: (tabId: string, label: string) => void;
  focusPanel: (panelId: string) => void;

  // panel moves
  moveTabToPanel: (tabId: string, targetPanelId: string) => void;
  dropTabOnPanel: (tabId: string, targetPanelId: string, zone: DropZone) => void;
  /** Duplicate the focused panel's active FILE tab into a new right-hand
   * split (⌘\). File tabs only — duplicating a terminal would double-attach
   * its pty. */
  splitFocusedPanel: () => void;

  // layout
  setSplitSizes: (splitId: string, sizes: number[]) => void;
  /**
   * Hide the panel with the given role (stashing it), or restore a previously
   * hidden one. Explorer restores on the far left, claude on the far right.
   * Backs the ⌘B sidebar / ⌘J right-rail toggles.
   */
  togglePanelByRole: (role: PanelRole) => void;
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
/** The explorer is the layout's fixed anchor: never closed, hidden or moved. */
export function isAnchorPanel(n: LayoutNode | undefined): boolean {
  return !!n && n.kind === "panel" && n.role === "explorer";
}

/**
 * Sizes after some children of `node` are dropped (`kept` = surviving indices). Each
 * removed child's share goes to its nearest surviving neighbour that isn't the anchor,
 * so the panes the user didn't touch keep their size instead of all re-flowing.
 */
function absorbRemoved(node: LayoutSplit, kept: number[]): number[] {
  const sizes = kept.map((i) => node.sizes[i] ?? 0);
  node.children.forEach((_, i) => {
    if (kept.includes(i)) return;
    let target = -1;
    for (let d = 1; d < node.children.length && target < 0; d++) {
      for (const j of [i - d, i + d]) {
        const k = kept.indexOf(j);
        if (k >= 0 && !isAnchorPanel(node.children[j])) { target = k; break; }
      }
    }
    if (target < 0) target = kept.length - 1;
    if (target >= 0) sizes[target]! += node.sizes[i] ?? 0;
  });
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((v) => (v / total) * 100);
}

function pruneEmptyPanels(node: LayoutNode, keepEditor = true): LayoutNode | null {
  if (isPanel(node)) return node.tabs.length === 0 && !(keepEditor && node.role === "editor") ? null : node;
  const kids: LayoutNode[] = [];
  const kept: number[] = [];
  node.children.forEach((c, i) => {
    const r = pruneEmptyPanels(c);
    if (r) {
      kids.push(r);
      kept.push(i);
    }
  });
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0]!;
  return { ...node, sizes: absorbRemoved(node, kept), children: kids };
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

function findSplitIn(node: LayoutNode, splitId: string): LayoutSplit | null {
  if (isPanel(node)) return null;
  if (node.id === splitId) return node;
  for (const c of node.children) {
    const hit = findSplitIn(c, splitId);
    if (hit) return hit;
  }
  return null;
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

/** First panel that can host files: not the explorer, AI rail or terminal dock. */
function editorPanelCount(node: LayoutNode): number {
  if (isPanel(node)) return firstEditorLike(node) ? 1 : 0;
  return node.children.reduce((n, c) => n + editorPanelCount(c), 0);
}

function firstEditorLike(node: LayoutNode): LayoutPanel | null {
  if (isPanel(node)) {
    return node.role === "explorer" || node.role === "claude" || node.role === "terminal" ? null : node;
  }
  for (const c of node.children) {
    const hit = firstEditorLike(c);
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
  return { ...node, sizes: absorbRemoved(node, kept), children: kids };
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
    const kept: number[] = [];
    n.children.forEach((c, i) => {
      const r = recur(c);
      if (r) {
        newKids.push(r);
        kept.push(i);
      }
    });
    if (newKids.length === 0) return null;
    if (newKids.length === 1) return newKids[0]!;
    return { ...n, sizes: absorbRemoved(n, kept), children: newKids };
  }

  const next = recur(node);
  return { tree: next, tab: extracted, panelId: sourcePanelId };
}

/** True when a tab move would take the explorer's tree out of its panel, or put
 *  another tab into the explorer: the anchor holds just its tree. */
function anchorBlocksMove(root: LayoutNode, tabId: string, targetPanelId: string): boolean {
  if (findTabIn(root, tabId)?.tab.descriptor.kind === "files-tree") return true;
  return isAnchorPanel(findPanelIn(root, targetPanelId) ?? undefined);
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
  // Cursor's panel sits under the editor area only: the sidebar and the agent
  // pane keep their full height beside it.
  if (root.kind === "split" && root.direction === "horizontal") {
    const side = (c: LayoutNode | undefined, r: PanelRole) => !!c && c.kind === "panel" && c.role === r;
    const lead = side(root.children[0], "explorer") ? 1 : 0;
    const trail = root.children.length - lead > 1 && side(root.children[root.children.length - 1], "claude") ? 1 : 0;
    const mid = root.children.slice(lead, root.children.length - trail);
    if (lead + trail > 0 && mid.length > 0) {
      const midSizes = root.sizes.slice(lead, root.children.length - trail);
      const midTotal = midSizes.reduce((a, b) => a + b, 0) || 1;
      const area: LayoutNode = mid.length === 1
        ? mid[0]!
        : { kind: "split", id: ulid(), direction: "horizontal", sizes: midSizes.map((v) => (v / midTotal) * 100), children: mid };
      const docked = dockTabAtBottom(area, tab, role, fraction);
      return {
        tree: {
          ...root,
          sizes: [...root.sizes.slice(0, lead), midTotal, ...root.sizes.slice(root.children.length - trail)],
          children: [...root.children.slice(0, lead), docked.tree, ...root.children.slice(root.children.length - trail)],
        },
        newPanelId: docked.newPanelId,
      };
    }
  }
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

/**
 * Insert a full-height panel at the left or right edge of the workspace. If the
 * root is already a horizontal split the panel joins as a flat sibling (no extra
 * nesting); otherwise the whole tree is wrapped so the panel spans full height
 * beside everything else (Cursor-style sidebar / rail). Sizes always sum to 100.
 */
function insertPanelAtEdge(
  root: LayoutNode,
  panel: LayoutPanel,
  edge: "left" | "right",
  fraction: number,
): LayoutNode {
  if (root.kind === "split" && root.direction === "horizontal") {
    const total = root.sizes.reduce((a, b) => a + b, 0) || 1;
    const keep = 100 - fraction;
    const scaled = root.sizes.map((s) => (s / total) * keep);
    return edge === "left"
      ? { ...root, sizes: [fraction, ...scaled], children: [panel, ...root.children] }
      : { ...root, sizes: [...scaled, fraction], children: [...root.children, panel] };
  }
  return {
    kind: "split",
    id: ulid(),
    direction: "horizontal",
    sizes: edge === "left" ? [fraction, 100 - fraction] : [100 - fraction, fraction],
    children: edge === "left" ? [panel, root] : [root, panel],
  };
}

function defaultTabForRole(role: PanelRole): TabDescriptor {
  switch (role) {
    case "explorer":
      return { kind: "files-tree" };
    case "claude":
      return { kind: "claude" };
    case "terminal":
      return { kind: "terminal", id: ulid() };
    default:
      return { kind: "preview" };
  }
}

// ============================================================
// Initial layout factory — mirrors today's Orion look.
// ============================================================

export function defaultOrionLayout(): LayoutNode {
  // Cursor's workbench: sidebar, one editor group (empty until a file opens,
  // showing the shortcut screen), agent pane. Terminal and Preview open on demand.
  const filesPanel = newPanel([newTab({ kind: "files-tree" })], "explorer");
  const editorPanel = newPanel([], "editor");
  const claudePanel = newPanel([newTab({ kind: "claude" })], "claude");

  return {
    kind: "split",
    id: ulid(),
    direction: "horizontal",
    sizes: [16, 60, 24],
    children: [filesPanel, editorPanel, claudePanel],
  };
}

/** Comfortable size (percent) for side surfaces; null = share the rest. */
const PREFERRED_SIZE: Partial<Record<PanelRole, number>> = {
  explorer: 16,
  claude: 24,
  terminal: 30,
};

/** Double-clicking a divider restores these: side surfaces at their
 * comfortable width, everything else sharing the remainder evenly. */
export function preferredSizes(split: LayoutSplit): number[] {
  const fixed = split.children.map((c) =>
    c.kind === "panel" && c.role ? PREFERRED_SIZE[c.role] ?? null : null,
  );
  const fixedSum = fixed.reduce<number>((s, v) => s + (v ?? 0), 0);
  const flexible = fixed.filter((v) => v == null).length;
  if (flexible === 0 || fixedSum >= 90) {
    return split.children.map(() => 100 / split.children.length);
  }
  const share = (100 - fixedSum) / flexible;
  return fixed.map((v) => v ?? share);
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
  hiddenPanels: {},

  findPanel: (panelId) => findPanelIn(get().root, panelId),
  findTab: (tabId) => findTabIn(get().root, tabId),

  openTab: (descriptor, opts) => {
    const key = descriptorKey(descriptor);
    const root = get().root;

    // Already open → activate it. An explicit (non-preview) open pins it.
    const existing = findPanelByDescriptor(root, key);
    if (existing) {
      const pin = existing.tab.preview && !opts?.preview;
      const nextRoot = patchPanel(root, existing.panel.id, {
        activeTabId: existing.tab.id,
        ...(pin
          ? { tabs: existing.panel.tabs.map((t) => (t.id === existing.tab.id ? { ...t, preview: false } : t)) }
          : {}),
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

    // Files (and notes/assets) open as tabs in one editor group, like Cursor:
    // the group last used for a file, else the editor panel. Splitting is
    // explicit (⌘\ or dragging a tab to an edge). A preview open replaces the
    // group's current preview tab instead of adding another.
    if (
      descriptor.kind === "file" ||
      descriptor.kind === "note" ||
      descriptor.kind === "asset-detail"
    ) {
      if (opts?.preview) tab.preview = true;
      const lastId = get().lastFilePanelId;
      const lastPanel = lastId ? findPanelIn(root, lastId) : null;
      const requested = opts?.panelId ? findPanelIn(root, opts.panelId) : null;
      const usable = (p: LayoutPanel | null) =>
        p && !isAnchorPanel(p) && p.role !== "claude" && p.role !== "terminal" ? p : null;
      const target =
        usable(requested) ??
        usable(lastPanel) ??
        findPanelByRole(root, "editor") ??
        firstEditorLike(root);

      if (!target) {
        // No editor group left (its last tab was dragged away): recreate one
        // beside the AI rail, where the editor area normally sits.
        const rail = findPanelByRole(root, "claude");
        if (rail) {
          const { tree, newPanelId } = splitPanelWithTab(root, rail.id, tab, "left", "editor");
          set({ root: tree, focusedPanelId: newPanelId, lastFilePanelId: newPanelId });
          persistLayout(tree, newPanelId);
          return tab.id;
        }
        const fresh = newPanel([tab], "editor");
        const nextRoot = insertPanelAtEdge(root, fresh, "right", 60);
        set({ root: nextRoot, focusedPanelId: fresh.id, lastFilePanelId: fresh.id });
        persistLayout(nextRoot, fresh.id);
        return tab.id;
      }

      const replace = tab.preview ? target.tabs.find((t) => t.preview) : undefined;
      const nextRoot = replace
        ? patchPanel(root, target.id, {
            tabs: target.tabs.map((t) => (t.id === replace.id ? tab : t)),
            activeTabId: tab.id,
          })
        : insertTabIntoPanel(root, target.id, tab);
      set({ root: nextRoot, focusedPanelId: target.id, lastFilePanelId: target.id });
      persistLayout(nextRoot, target.id);
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
    const hit = findTabIn(get().root, tabId);
    if (hit?.tab.descriptor.kind === "files-tree") return; // the anchor stays
    // Like Cursor, the editor area stays put when its last tab closes; it shows
    // the empty-editor screen instead of collapsing into its neighbours.
    const host = hit ? findPanelIn(get().root, hit.panelId) : null;
    if (host?.role === "editor" && host.tabs.length === 1 && editorPanelCount(get().root) === 1) {
      const nextRoot = patchPanel(get().root, host.id, { tabs: [], activeTabId: null });
      set({ root: nextRoot, focusedPanelId: host.id, lastFilePanelId: host.id });
      persistLayout(nextRoot, host.id);
      return;
    }
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

  pinTab: (tabId) => {
    const hit = findTabIn(get().root, tabId);
    if (!hit?.tab.preview) return;
    const panel = findPanelIn(get().root, hit.panelId)!;
    const nextRoot = patchPanel(get().root, hit.panelId, {
      tabs: panel.tabs.map((t) => (t.id === tabId ? { ...t, preview: false } : t)),
    });
    set({ root: nextRoot });
    persistLayout(nextRoot, get().focusedPanelId);
  },

  pinFile: (path) => {
    const hit = findPanelByDescriptor(get().root, `file:${path}`);
    if (hit?.tab.preview) get().pinTab(hit.tab.id);
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

  splitFocusedPanel: () => {
    const { root, focusedPanelId } = get();
    if (!focusedPanelId) return;
    const panel = findPanelIn(root, focusedPanelId);
    const active = panel?.tabs.find((t) => t.id === panel.activeTabId);
    if (!active || active.descriptor.kind !== "file") return;
    const dup = newTab(active.descriptor, active.label);
    const { tree, newPanelId } = splitPanelWithTab(
      root,
      focusedPanelId,
      dup,
      "right",
    );
    set({ root: tree, focusedPanelId: newPanelId });
    persistLayout(tree, newPanelId);
  },

  moveTabToPanel: (tabId, targetPanelId) => {
    if (anchorBlocksMove(get().root, tabId, targetPanelId)) return;
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
    if (anchorBlocksMove(get().root, tabId, targetPanelId)) return;
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

  togglePanelByRole: (role) => {
    const root = get().root;
    const existing = findPanelByRole(root, role);
    if (existing && role === "explorer") {
      // The explorer can't be hidden: ⌘B just brings focus back to it.
      set({ focusedPanelId: existing.id });
      return;
    }
    if (existing) {
      const next = removePanel(root, existing.id);
      if (!next) return; // never hide the last surviving panel
      const focus =
        get().focusedPanelId === existing.id
          ? firstPanel(next)?.id ?? null
          : get().focusedPanelId;
      set({
        root: next,
        focusedPanelId: focus,
        hiddenPanels: { ...get().hiddenPanels, [role]: existing },
      });
      persistLayout(next, focus);
      return;
    }
    const stash = get().hiddenPanels[role];
    const panel =
      stash ?? newPanel([newTab(defaultTabForRole(role))], role);
    const edge = role === "explorer" ? "left" : "right";
    const fraction = role === "explorer" ? 16 : 24;
    const next = insertPanelAtEdge(root, panel, edge, fraction);
    const { [role]: _drop, ...restHidden } = get().hiddenPanels;
    void _drop;
    set({ root: next, focusedPanelId: panel.id, hiddenPanels: restHidden });
    persistLayout(next, panel.id);
  },

  closePanel: (panelId) => {
    if (isAnchorPanel(findPanelIn(get().root, panelId) ?? undefined)) return;
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
    const current = findSplitIn(root, splitId);
    if (
      !current ||
      (current.sizes.length === sizes.length &&
        current.sizes.every((s, i) => Math.abs(s - sizes[i]!) < 0.05))
    ) {
      return;
    }
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
    set({ root, focusedPanelId: focus, hiddenPanels: {} });
    persistLayout(root, focus);
  },

  hydrate: (root, focusedPanelId) => {
    if (!root) return;
    // Heal legacy layouts: drop empty panels, then back-fill panel roles
    // based on tab content so route-by-role works for layouts persisted
    // before the role field existed.
    const pruned = pruneEmptyPanels(root);
    const inferred = pruned ? assignInferredRoles(pruned) : null;
    // Layouts saved while the explorer could still be hidden get it back on the left.
    const withRoles = inferred && !findPanelByRole(inferred, "explorer")
      ? insertPanelAtEdge(inferred, newPanel([newTab({ kind: "files-tree" })], "explorer"), "left", PREFERRED_SIZE.explorer!)
      : inferred;
    const effective = withRoles ?? defaultOrionLayout();
    const focus =
      focusedPanelId && findPanelIn(effective, focusedPanelId)
        ? focusedPanelId
        : firstPanel(effective)?.id ?? null;
    set({ root: effective, focusedPanelId: focus, lastFilePanelId: null, hiddenPanels: {} });
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
