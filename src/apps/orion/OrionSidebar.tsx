import { Files, Search, GitBranch } from "lucide-react";
import { OrionFileTree } from "@/apps/orion/FileTree";
import { OrionSearchPanel } from "@/apps/orion/SearchPanel";
import { OrionChangesPanel } from "@/apps/orion/ChangesPanel";
import { useOrionSidebar, type OrionSidebarView } from "@/apps/orion/store/sidebarStore";
import { useGit } from "@/store/gitStore";
import { usePendingEdits } from "@/store/pendingEditsStore";

const VIEWS: { id: OrionSidebarView; label: string; hotkey: string; Icon: typeof Files }[] = [
  { id: "explorer", label: "Explorer", hotkey: "⇧⌘E", Icon: Files },
  { id: "search", label: "Search", hotkey: "⇧⌘F", Icon: Search },
  { id: "scm", label: "Source Control", hotkey: "⌃⇧G", Icon: GitBranch },
];

/** Cursor's primary sidebar: an icon row switching Explorer, Search and Source Control. */
export function OrionSidebar() {
  const view = useOrionSidebar((s) => s.view);
  const setView = useOrionSidebar((s) => s.setView);
  const changed = useGit((s) => s.files.size) + usePendingEdits((s) => s.order.length);

  return (
    <div className="or-sidebar">
      <div className="or-sidebar-views" role="tablist" aria-label="Sidebar views">
        {VIEWS.map(({ id, label, hotkey, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`or-sidebar-view${view === id ? " active" : ""}`}
            title={`${label} (${hotkey})`}
            aria-label={label}
            onClick={() => setView(id)}
          >
            <Icon size={16} />
            {id === "scm" && changed > 0 && <span className="or-sidebar-badge">{changed > 99 ? "99+" : changed}</span>}
          </button>
        ))}
      </div>
      <div className="or-sidebar-body">
        {view === "explorer" && <OrionFileTree />}
        {view === "search" && <OrionSearchPanel />}
        {view === "scm" && <OrionChangesPanel />}
      </div>
    </div>
  );
}
