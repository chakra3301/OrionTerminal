import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { X, Plus } from "lucide-react";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import type {
  DropZone,
  LayoutNode,
  LayoutPanel,
  LayoutSplit,
  Tab,
  TabDescriptor,
} from "@/components/workspace/types";

/** One entry in a panel's "+" opener dropdown. */
export type AddMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
};

export type ContentRegistry = {
  /**
   * Render the content for a given tab descriptor. Return null to let the
   * Workspace render its built-in empty state.
   */
  render: (tab: Tab, panelId: string) => ReactNode;
  /**
   * Optional: items for a panel's "+" opener dropdown. Receives the panel so
   * the app can tailor options by role (e.g. explorer panels return [] → no
   * "+" button; the AI panel returns only AI surfaces). Omit, or return an
   * empty array, to hide the "+" button for that panel.
   */
  addMenu?: (panel: LayoutPanel) => AddMenuItem[];
  /** Optional: icon next to the tab label. */
  icon?: (tab: Tab) => ReactNode;
  /** Optional: derive label dynamically (e.g. file basename). */
  label?: (tab: Tab) => string;
  /** Optional: is the tab dirty (e.g. unsaved file). */
  isDirty?: (tab: Tab) => boolean;
  /**
   * Optional: when true, the tab stays mounted (hidden via CSS) when not
   * active in its panel, so its component state survives tab switches. Used
   * for pty-backed tabs (terminal, claude-code) where unmounting would
   * destroy the session.
   */
  persistent?: (tab: Tab) => boolean;
};

const DRAG_MIME = "application/x-orion-tab";

export function Workspace({ registry }: { registry: ContentRegistry }) {
  const root = useWorkspace((s) => s.root);
  return (
    <div className="ot-workspace">
      <NodeView node={root} registry={registry} />
    </div>
  );
}

function NodeView({
  node,
  registry,
}: {
  node: LayoutNode;
  registry: ContentRegistry;
}) {
  if (node.kind === "panel") return <PanelLeaf panel={node} registry={registry} />;
  return <SplitNode split={node} registry={registry} />;
}

function SplitNode({
  split,
  registry,
}: {
  split: LayoutSplit;
  registry: ContentRegistry;
}) {
  const setSplitSizes = useWorkspace((s) => s.setSplitSizes);
  return (
    <PanelGroup
      direction={split.direction}
      autoSaveId={undefined}
      onLayout={(sizes) => setSplitSizes(split.id, sizes)}
    >
      {split.children.map((child, i) => {
        const last = i === split.children.length - 1;
        return (
          <Fragment key={child.kind === "panel" ? child.id : child.id}>
            <Panel
              defaultSize={split.sizes[i] ?? 100 / split.children.length}
              minSize={8}
            >
              <NodeView node={child} registry={registry} />
            </Panel>
            {!last && (
              <PanelResizeHandle
                className={
                  split.direction === "horizontal"
                    ? "ot-resize-handle vertical"
                    : "ot-resize-handle horizontal"
                }
              />
            )}
          </Fragment>
        );
      })}
    </PanelGroup>
  );
}

function Fragment({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function PanelLeaf({
  panel,
  registry,
}: {
  panel: LayoutPanel;
  registry: ContentRegistry;
}) {
  const focusedPanelId = useWorkspace((s) => s.focusedPanelId);
  const focusPanel = useWorkspace((s) => s.focusPanel);
  const dropTabOnPanel = useWorkspace((s) => s.dropTabOnPanel);
  const [hoverZone, setHoverZone] = useState<DropZone | null>(null);
  const focused = focusedPanelId === panel.id;
  const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId) ?? null;

  return (
    <div
      className={`ot-panel${focused ? " focused" : ""}`}
      onMouseDown={() => focusPanel(panel.id)}
    >
      <PanelTabStrip panel={panel} registry={registry} />
      <div
        className="ot-panel-body"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width;
          const py = (e.clientY - rect.top) / rect.height;
          // Edges within 22% pull the tab into a split.
          const EDGE = 0.22;
          let zone: DropZone = "tabs";
          if (px < EDGE) zone = "left";
          else if (px > 1 - EDGE) zone = "right";
          else if (py < EDGE) zone = "top";
          else if (py > 1 - EDGE) zone = "bottom";
          setHoverZone(zone);
        }}
        onDragLeave={() => setHoverZone(null)}
        onDrop={(e) => {
          const tabId = e.dataTransfer.getData(DRAG_MIME);
          if (!tabId) return;
          e.preventDefault();
          const zone = hoverZone ?? "tabs";
          dropTabOnPanel(tabId, panel.id, zone);
          setHoverZone(null);
        }}
      >
        {activeTab ? (
          <PanelTabsLayer panel={panel} registry={registry} activeTab={activeTab} />
        ) : (
          <EmptyPanel />
        )}
        {hoverZone && hoverZone !== "tabs" && (
          <div className={`ot-drop-zone ${hoverZone}`} aria-hidden />
        )}
        {hoverZone === "tabs" && <div className="ot-drop-zone tabs" aria-hidden />}
      </div>
    </div>
  );
}

function PanelTabsLayer({
  panel,
  registry,
  activeTab,
}: {
  panel: LayoutPanel;
  registry: ContentRegistry;
  activeTab: Tab;
}) {
  const closeTab = useWorkspace((s) => s.closeTab);
  // Render every tab that needs to stay mounted (the active one, plus any
  // other "persistent" tab in this panel — pty-backed kinds whose unmount
  // would kill the underlying session) as SIBLINGS keyed by tab id. Keyed
  // reconciliation means React preserves each component across switches —
  // toggling the .active class is just a visibility flip, not a remount. The
  // previous code split active vs inactive into different parent slots, so
  // React unmounted the outgoing tab's component (destroying its pty) before
  // remounting it as a hidden sibling with a fresh id.
  const mounted: Tab[] = [activeTab];
  if (registry.persistent) {
    for (const t of panel.tabs) {
      if (t.id !== activeTab.id && registry.persistent(t)) mounted.push(t);
    }
  }
  return (
    <div className="ot-panel-tabs-layer">
      {mounted.map((t) => {
        const isActive = t.id === activeTab.id;
        const node = registry.render(t, panel.id);
        return (
          <div
            key={t.id}
            className={`ot-panel-tab-slot${isActive ? " active" : ""}`}
            aria-hidden={!isActive}
          >
            {isActive
              ? (node ?? <EmptyPanel onClose={() => closeTab(activeTab.id)} />)
              : node}
          </div>
        );
      })}
    </div>
  );
}

function PanelTabStrip({
  panel,
  registry,
}: {
  panel: LayoutPanel;
  registry: ContentRegistry;
}) {
  const setActiveTab = useWorkspace((s) => s.setActiveTab);
  const closeTab = useWorkspace((s) => s.closeTab);
  const closeEmptyPanel = useWorkspace((s) => s.closePanel);
  const dropTabOnPanel = useWorkspace((s) => s.dropTabOnPanel);
  const [dragOverTabs, setDragOverTabs] = useState(false);
  const addItems = registry.addMenu?.(panel) ?? [];

  return (
    <div
      className={`ot-panel-tabs${dragOverTabs ? " drag-over" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverTabs(true);
      }}
      onDragLeave={() => setDragOverTabs(false)}
      onDrop={(e) => {
        const tabId = e.dataTransfer.getData(DRAG_MIME);
        if (!tabId) return;
        e.preventDefault();
        dropTabOnPanel(tabId, panel.id, "tabs");
        setDragOverTabs(false);
      }}
    >
      {panel.tabs.length === 0 && (
        <button
          type="button"
          className="ot-panel-tab empty"
          title="Close this empty panel"
          onClick={() => closeEmptyPanel(panel.id)}
        >
          <span style={{ opacity: 0.7 }}>empty · click to close</span>
        </button>
      )}
      {panel.tabs.map((tab) => (
        <TabChip
          key={tab.id}
          tab={tab}
          panelId={panel.id}
          active={tab.id === panel.activeTabId}
          icon={registry.icon?.(tab)}
          label={registry.label?.(tab) ?? tab.label}
          dirty={registry.isDirty?.(tab) ?? !!tab.dirty}
          onSelect={() => setActiveTab(panel.id, tab.id)}
          onClose={() => closeTab(tab.id)}
        />
      ))}
      <div style={{ flex: 1 }} />
      {addItems.length > 0 && <PanelAddMenu items={addItems} />}
    </div>
  );
}

/**
 * The "+" button on a panel's tab strip. Click opens a dropdown of things to
 * open in this panel (Terminal, Claude Code, etc.). The menu is portaled to
 * <body> and fixed-positioned because the tab strip is an `overflow-x: auto`
 * container that would otherwise clip a downward popover.
 */
function PanelAddMenu({ items }: { items: AddMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Right-align to the button (the CSS translateX(-100%) shifts it left).
    setPos({ top: r.bottom + 4, left: r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`ot-panel-tab-add${open ? " open" : ""}`}
        title="Open a pane"
        aria-label="Open a pane"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Plus size={11} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="ot-panel-add-menu"
            role="menu"
            style={{ top: pos.top, left: pos.left }}
          >
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                className="ot-panel-add-item"
                onClick={(e) => {
                  e.stopPropagation();
                  it.onSelect();
                  setOpen(false);
                }}
              >
                <span className="ic">{it.icon}</span>
                <span className="lb">{it.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function TabChip({
  tab,
  panelId,
  active,
  icon,
  label,
  dirty,
  onSelect,
  onClose,
}: {
  tab: Tab;
  panelId: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  dirty: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  // Suppress unused
  void panelId;
  return (
    <div
      className={`ot-panel-tab${active ? " active" : ""}${dirty ? " dirty" : ""}`}
      onClick={onSelect}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, tab.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      title={tabTooltip(tab.descriptor, label)}
    >
      {icon}
      <span className="label">{label}</span>
      {dirty ? (
        <span className="dot">●</span>
      ) : (
        <button
          type="button"
          className="x"
          aria-label="Close tab"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

function tabTooltip(d: TabDescriptor, label: string): string {
  switch (d.kind) {
    case "file":
      return d.path;
    default:
      return label;
  }
}

function EmptyPanel({ onClose }: { onClose?: () => void }) {
  return (
    <div className="ot-panel-empty">
      <div className="empty-inner">
        <div className="title">empty</div>
        <div className="hint">⌘K to open a file or pane</div>
        {onClose && (
          <button type="button" className="close-btn" onClick={onClose}>
            close panel
          </button>
        )}
      </div>
    </div>
  );
}

// Re-export tab type for callers building registries.
export type { Tab };
// Re-export drag mime for non-tab drag sources (file tree drag-to-open, etc.)
export { DRAG_MIME };
