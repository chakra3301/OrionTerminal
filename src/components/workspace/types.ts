export type AssetFilter = {
  kinds?: string[];
  tags?: string[];
  query?: string;
};

export type TabDescriptor =
  | { kind: "file"; path: string }
  | { kind: "note"; noteId: string }
  | { kind: "asset-grid"; filter?: AssetFilter }
  | { kind: "asset-detail"; assetId: string }
  | { kind: "files-tree" }
  | { kind: "preview" }
  | { kind: "claude" }
  | { kind: "claude-code" }
  | { kind: "terminal" };

export type Tab = {
  id: string;
  descriptor: TabDescriptor;
  label: string;
  dirty?: boolean;
  scrollState?: unknown;
};

export type PanelRole = "explorer" | "editor" | "claude" | "terminal";

export type LayoutPanel = {
  kind: "panel";
  id: string;
  tabs: Tab[];
  activeTabId: string | null;
  /**
   * Routing hint. `openTab` with a `preferRole` first looks for a panel
   * matching this role. Roles persist when panels are moved/resized; they
   * don't constrain what tabs a panel can hold.
   */
  role?: PanelRole;
};

export type LayoutSplit = {
  kind: "split";
  id: string;
  direction: "horizontal" | "vertical";
  /** Size of each child as a percent (0..100). Must sum to 100. */
  sizes: number[];
  children: LayoutNode[];
};

export type LayoutNode = LayoutPanel | LayoutSplit;

export function descriptorKey(d: TabDescriptor): string {
  switch (d.kind) {
    case "file":
      return `file:${d.path}`;
    case "note":
      return `note:${d.noteId}`;
    case "asset-detail":
      return `asset-detail:${d.assetId}`;
    case "asset-grid":
      return `asset-grid:${stableJson(d.filter ?? null)}`;
    case "files-tree":
      return "files-tree";
    case "preview":
      return "preview";
    case "claude":
      return "claude";
    case "claude-code":
      return "claude-code";
    case "terminal":
      return "terminal";
  }
}

function stableJson(o: unknown): string {
  return JSON.stringify(sortKeys(o));
}

function sortKeys(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(sortKeys);
  if (o && typeof o === "object") {
    const obj = o as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return o;
}

export function defaultLabel(d: TabDescriptor): string {
  switch (d.kind) {
    case "file": {
      const parts = d.path.split(/[\\/]/);
      return parts[parts.length - 1] ?? d.path;
    }
    case "note":
      return "Untitled note";
    case "asset-grid":
      return "Assets";
    case "asset-detail":
      return "Asset";
    case "files-tree":
      return "Explorer";
    case "preview":
      return "Preview";
    case "claude":
      return "Orix47";
    case "claude-code":
      return "Claude Code";
    case "terminal":
      return "Terminal";
  }
}

export type DropZone = "tabs" | "left" | "right" | "top" | "bottom";
