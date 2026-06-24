import type { MenuItem } from "@/components/ContextMenu";
import { registry } from "@/commands/registry";
import { useShell, type AppId } from "@/shell/store/useShell";
import { useArchives } from "@/apps/archives/useArchives";
import { useProjectStore } from "@/store/projectStore";
import { useXDesign } from "@/apps/xdesign/store";
import {
  useXDProjects,
  flushActive as flushActiveXDProject,
} from "@/apps/xdesign/projectsStore";
import { toast } from "@/store/toastStore";
import { useHermes } from "@/store/hermesStore";

// Menubar dropdown definitions. Every item maps to a REAL action — a registry
// command, a window/shell action, an app-store action, or a document edit
// command — so no menu entry is a dead end.

function fmtHotkey(h?: string): string | undefined {
  if (!h) return undefined;
  const map: Record<string, string> = {
    mod: "⌘",
    shift: "⇧",
    alt: "⌥",
    ctrl: "⌃",
    right: "→",
    left: "←",
    up: "↑",
    down: "↓",
    "`": "`",
  };
  return h
    .split("+")
    .map((p) => map[p] ?? (p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1)))
    .join("");
}

/** Menu item backed by a registry command — label + shortcut auto-derived. */
function cmd(id: string, labelOverride?: string): MenuItem {
  const c = registry.get(id);
  return {
    label: labelOverride ?? c?.label ?? id,
    hint: fmtHotkey(c?.hotkey),
    disabled: !c || (c.when ? !c.when() : false),
    onClick: () => void registry.run(id),
  };
}

const sep: MenuItem = { type: "separator" };

/** Generic clipboard/history actions via the focused element. */
function edit(label: string, command: string, hint?: string): MenuItem {
  return { label, hint, onClick: () => document.execCommand(command) };
}

const EDIT_BLOCK: MenuItem[] = [
  edit("Undo", "undo", "⌘Z"),
  edit("Redo", "redo", "⌘⇧Z"),
  sep,
  edit("Cut", "cut", "⌘X"),
  edit("Copy", "copy", "⌘C"),
  edit("Paste", "paste", "⌘V"),
  edit("Select All", "selectAll", "⌘A"),
];

// View items shared everywhere — always safe to run from any context.
const GLOBAL_VIEW: MenuItem[] = [
  cmd("palette.open", "Spotlight"),
  cmd("palette.openCommands", "Command Palette"),
  sep,
  cmd("view.toggleTheme", "Toggle Theme"),
  cmd("keybindings.show", "Keyboard Shortcuts"),
];

/** Window menu: act on the focused window + jump to any open one. */
function windowMenu(): MenuItem[] {
  const s = useShell.getState();
  const focused = s.windows.find((w) => w.id === s.focusedWindowId);
  const items: MenuItem[] = [
    {
      label: "Minimize",
      hint: "⌘M",
      disabled: !focused,
      onClick: () => focused && s.minimizeWindow(focused.id),
    },
    {
      label: focused?.maximized ? "Restore" : "Zoom",
      disabled: !focused,
      onClick: () => focused && s.toggleMaximize(focused.id),
    },
    {
      label: "Close Window",
      disabled: !focused,
      onClick: () => focused && s.closeWindow(focused.id),
    },
    cmd("rosie.toggle", "Toggle R.O.S.I.E"),
  ];
  const open = s.windows.filter((w) => !w.minimized);
  if (open.length) {
    items.push(sep);
    for (const w of open) {
      items.push({
        label: APP_TITLE[w.app] ?? w.app,
        checked: w.id === s.focusedWindowId,
        onClick: () => s.focusWindow(w.id),
      });
    }
  }
  return items;
}

const APP_TITLE: Record<string, string> = {
  archives: "Archives 47",
  orion: "Orion",
  xdesign: "XDesign",
  hermes: "Hermes",
};

// ── App-specific store actions ──────────────────────────────────────────────

function xdesignEdit(): MenuItem[] {
  const x = useXDesign.getState();
  const selIds = () => [...useXDesign.getState().selection];
  const hasSel = x.selection.size > 0;
  return [
    { label: "Undo", hint: "⌘Z", onClick: () => useXDesign.getState().undo() },
    { label: "Redo", hint: "⌘⇧Z", onClick: () => useXDesign.getState().redo() },
    sep,
    { label: "Copy", hint: "⌘C", disabled: !hasSel, onClick: () => useXDesign.getState().copy(selIds()) },
    { label: "Paste", hint: "⌘V", onClick: () => useXDesign.getState().paste() },
    { label: "Duplicate", hint: "⌘D", disabled: !hasSel, onClick: () => useXDesign.getState().duplicate(selIds()) },
    { label: "Delete", disabled: !hasSel, danger: true, onClick: () => useXDesign.getState().deleteShapes(selIds()) },
    sep,
    {
      label: "Select All",
      hint: "⌘A",
      onClick: () => {
        const st = useXDesign.getState();
        st.selectMany(st.shapes.map((sh) => sh.id));
      },
    },
    { label: "Deselect", onClick: () => useXDesign.getState().clearSelection() },
  ];
}

function xdesignObject(): MenuItem[] {
  const sel = () => [...useXDesign.getState().selection];
  const hasMulti = useXDesign.getState().selection.size > 1;
  const hasSel = useXDesign.getState().selection.size > 0;
  return [
    { label: "Group", hint: "⌘G", disabled: !hasMulti, onClick: () => useXDesign.getState().groupAsFrame(sel()) },
    { label: "Ungroup", hint: "⌘⇧G", disabled: !hasSel, onClick: () => useXDesign.getState().ungroup(sel()) },
    sep,
    { label: "Duplicate", hint: "⌘D", disabled: !hasSel, onClick: () => useXDesign.getState().duplicate(sel()) },
    { label: "Delete", disabled: !hasSel, danger: true, onClick: () => useXDesign.getState().deleteShapes(sel()) },
  ];
}

// ── Public API ──────────────────────────────────────────────────────────────

/** The application menu hung under the bold app-name label. */
export function appMenu(): MenuItem[] {
  return [
    cmd("controlpanel.open", "Control Panel…"),
    cmd("settings.open", "Settings…"),
    cmd("keybindings.show", "Keyboard Shortcuts"),
    sep,
    cmd("rosie.toggle", "Toggle R.O.S.I.E"),
    cmd("palette.open", "Spotlight"),
  ];
}

/** Build the dropdown for a given focused app (null = Desktop) + menu name. */
export function buildMenu(app: AppId | null, name: string): MenuItem[] {
  // Desktop (no focused app).
  if (!app) {
    switch (name) {
      case "File":
        return [
          cmd("note.new", "New Note"),
          cmd("note.newJournal", "New Journal Entry"),
          cmd("note.newProject", "New Project"),
          cmd("mood.newBoard", "New Mood Board"),
          sep,
          cmd("file.openProject", "Open Project…"),
          sep,
          cmd("settings.open", "Settings…"),
        ];
      case "Edit":
        return EDIT_BLOCK;
      case "View":
        return GLOBAL_VIEW;
      case "Window":
        return windowMenu();
    }
  }

  if (app === "orion") {
    switch (name) {
      case "File":
        return [
          cmd("file.openFile", "Open File…"),
          cmd("file.openProject", "Open Project…"),
          {
            label: "Go to Start",
            onClick: () => void useProjectStore.getState().goHome(),
          },
          sep,
          cmd("file.save", "Save"),
          cmd("file.saveAll", "Save All"),
          sep,
          cmd("file.closeTab", "Close Tab"),
        ];
      case "Edit":
        return [...EDIT_BLOCK, sep, cmd("claude.inlineEdit", "Inline Edit (Claude)")];
      case "Selection":
        return [
          edit("Select All", "selectAll", "⌘A"),
          cmd("file.nextTab", "Next Tab"),
          cmd("file.prevTab", "Previous Tab"),
        ];
      case "View":
        return [
          cmd("panel.toggleSidebar", "Toggle Sidebar"),
          cmd("panel.toggleRightRail", "Toggle Right Rail"),
          sep,
          cmd("view.openFilesTree", "Files Tree"),
          cmd("view.openPreview", "Preview"),
          cmd("view.openClaude", "Claude"),
          sep,
          cmd("view.resetLayout", "Reset Layout"),
          cmd("view.toggleTheme", "Toggle Theme"),
        ];
      case "Run":
        return [
          cmd("view.openPreview", "Open Preview"),
          cmd("view.openClaudeCode", "Open Claude Code"),
          cmd("view.openHermes", "Open Hermes"),
          cmd("view.openPi", "Open Pi"),
        ];
      case "Terminal":
        return [
          cmd("view.openTerminal", "New Terminal"),
          cmd("terminal.toggle", "Toggle Terminal"),
          cmd("terminal.clear", "Clear Terminal"),
        ];
    }
  }

  if (app === "archives") {
    switch (name) {
      case "File":
        return [
          cmd("note.new", "New Note"),
          cmd("note.newJournal", "New Journal Entry"),
          cmd("note.newProject", "New Project"),
          cmd("mood.newBoard", "New Mood Board"),
          sep,
          cmd("settings.open", "Settings…"),
        ];
      case "Edit":
        return [...EDIT_BLOCK, sep, cmd("note.delete", "Delete Note")];
      case "View": {
        const a = useArchives.getState();
        const v = (view: string, label: string): MenuItem => ({
          label,
          checked: a.view === view,
          onClick: () => useArchives.getState().setView(view as never),
        });
        return [
          v("today", "Today"),
          v("notes", "Notes"),
          v("journal", "Journal"),
          v("projects", "Projects"),
          v("media", "Media"),
          sep,
          ...GLOBAL_VIEW,
        ];
      }
      case "Insert":
        return [cmd("note.linkInsert", "Insert Link to Note"), cmd("claude.newChat", "New Claude Chat")];
      case "Format":
        return [
          edit("Bold", "bold", "⌘B"),
          edit("Italic", "italic", "⌘I"),
          edit("Underline", "underline", "⌘U"),
          edit("Strikethrough", "strikeThrough"),
        ];
    }
  }

  if (app === "xdesign") {
    switch (name) {
      case "File": {
        const xp = useXDProjects.getState();
        const onHome = xp.activeId === null;
        const recent = [...xp.registry]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 6)
          .map<MenuItem>((m) => ({
            label: m.name,
            checked: m.id === xp.activeId,
            onClick: () => void useXDProjects.getState().openProject(m.id),
          }));
        return [
          {
            label: "New Project",
            hint: "⌘N",
            onClick: () => void useXDProjects.getState().newProject(),
          },
          {
            label: "New Page",
            disabled: onHome,
            onClick: () => useXDesign.getState().newPage(),
          },
          sep,
          ...(recent.length
            ? ([{ label: "Open Recent", disabled: true } as MenuItem, ...recent, sep])
            : []),
          {
            label: "Save",
            hint: "⌘S",
            disabled: onHome,
            onClick: () => {
              void flushActiveXDProject();
              toast.success("Project saved");
            },
          },
          {
            label: "Close Project",
            hint: "⌘W",
            disabled: onHome,
            onClick: () => {
              const id = useXDProjects.getState().activeId;
              if (id) void useXDProjects.getState().closeTab(id);
            },
          },
          {
            label: "Go to Home",
            disabled: onHome,
            onClick: () => void useXDProjects.getState().goHome(),
          },
          sep,
          cmd("settings.open", "Settings…"),
        ];
      }
      case "Edit":
        return xdesignEdit();
      case "Object":
        return xdesignObject();
      case "Type":
        return [...EDIT_BLOCK];
      case "Effect":
        return GLOBAL_VIEW;
      case "View":
        return GLOBAL_VIEW;
    }
  }

  if (app === "hermes") {
    switch (name) {
      case "Board":
      case "Task":
        return [
          {
            label: "New Task",
            hint: "⌘N",
            onClick: () => void useHermes.getState().createTask({ title: "New task", column: "backlog" }),
          },
        ];
      case "Agents":
        return [cmd("rosie.toggle", "Toggle R.O.S.I.E (orchestrator)")];
      case "View":
        return GLOBAL_VIEW;
    }
  }

  // Fallback so a button is never inert.
  return GLOBAL_VIEW;
}
