/**
 * Archives 47's macOS menu bar, built from the command registry so menu items,
 * hotkeys and the ⌘K palette all run the same commands.
 */
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { registry } from "@/commands/registry";
import { log } from "@/lib/log";
import { APP_NAME } from "./brand";
import { toAccelerator } from "./hotkeyLabel";

export type MenuEntry = { commandId: string; label?: string } | "separator";

export type MenuSpec = { title: string; entries: MenuEntry[]; predefined?: "edit" | "window" };

/** The menu layout. Items whose command isn't registered are skipped. */
export const MENU_SPEC: MenuSpec[] = [
  {
    title: APP_NAME,
    entries: [{ commandId: "archives47.about", label: `About ${APP_NAME}` }, "separator", { commandId: "archives47.settings" }],
  },
  {
    title: "File",
    entries: [
      { commandId: "note.new" },
      { commandId: "note.quickCapture" },
      { commandId: "note.newJournal" },
      { commandId: "note.newProject" },
      { commandId: "note.newFromTemplate" },
      { commandId: "mood.newBoard" },
      "separator",
      { commandId: "note.dailyNote" },
      { commandId: "archives.downloads" },
      "separator",
      { commandId: "note.exportPdf" },
      { commandId: "note.delete" },
    ],
  },
  { title: "Edit", entries: [], predefined: "edit" },
  {
    title: "View",
    entries: [
      { commandId: "archives47.palette" },
      { commandId: "note.askArchive" },
      "separator",
      { commandId: "archives47.view.today" },
      { commandId: "archives47.view.journal" },
      { commandId: "archives47.view.notes" },
      { commandId: "archives47.view.projects" },
      { commandId: "archives47.view.mood" },
      { commandId: "archives47.view.media" },
      { commandId: "archives47.view.brain" },
      { commandId: "archives47.view.learn" },
      { commandId: "archives47.view.repolens" },
      { commandId: "archives47.view.chats" },
      "separator",
      { commandId: "archives47.toggleSidebar" },
      { commandId: "archives47.toggleChat" },
    ],
  },
  { title: "Window", entries: [], predefined: "window" },
];

async function item(entry: MenuEntry) {
  if (entry === "separator") return PredefinedMenuItem.new({ item: "Separator" });
  const cmd = registry.get(entry.commandId);
  if (!cmd) return null;
  return MenuItem.new({
    id: cmd.id,
    text: entry.label ?? cmd.label,
    accelerator: cmd.hotkey ? toAccelerator(cmd.hotkey) : undefined,
    action: () => {
      if (cmd.when && !cmd.when()) return;
      void registry.run(cmd.id).catch((e) => log.error("menu command failed", cmd.id, e));
    },
  });
}

async function predefinedItems(kind: "edit" | "window") {
  const names =
    kind === "edit"
      ? (["Undo", "Redo", "Separator", "Cut", "Copy", "Paste", "SelectAll"] as const)
      : (["Minimize", "Maximize", "Separator", "Fullscreen", "CloseWindow"] as const);
  return Promise.all(names.map((name) => PredefinedMenuItem.new({ item: name })));
}

export async function installNativeMenu(): Promise<void> {
  const submenus = [];
  for (const spec of MENU_SPEC) {
    const built = spec.predefined ? await predefinedItems(spec.predefined) : [];
    for (const entry of spec.entries) {
      const made = await item(entry);
      if (made) built.push(made);
    }
    if (spec.title === APP_NAME) {
      built.push(
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Hide", text: `Hide ${APP_NAME}` }),
        await PredefinedMenuItem.new({ item: "HideOthers" }),
        await PredefinedMenuItem.new({ item: "ShowAll" }),
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Quit", text: `Quit ${APP_NAME}` }),
      );
    }
    submenus.push(await Submenu.new({ text: spec.title, items: built }));
  }
  const menu = await Menu.new({ items: submenus });
  await menu.setAsAppMenu();
}
