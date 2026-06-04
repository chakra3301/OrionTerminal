import {
  SquareArrowOutUpRight,
  Pencil,
  Star,
  FileDown,
  Trash2,
  Plus,
  Link as LinkIcon,
  ImagePlus,
} from "lucide-react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import type { MenuItem } from "@/components/ContextMenu";
import { promptText } from "@/components/PromptModal";
import { useNotesStore, type Note } from "@/store/notesStore";
import { useAssetsStore, type Asset } from "@/store/assetsStore";
import { useMoodBoardsStore, type MoodBoard } from "@/store/moodBoardsStore";
import { exportNoteAsMarkdown } from "@/apps/archives/exportImport";
import { log } from "@/lib/log";

const ICON = 13;

/** Context-menu items for a note (covers Notes / Journal / Projects). */
export function noteMenuItems(
  note: Note,
  opts: {
    onOpen?: () => void;
    onDeleted?: () => void;
    /** Extra items inserted before the Delete separator (e.g. New subpage). */
    extra?: MenuItem[];
    /** Word shown in the delete confirm ("note", "entry", "project"). */
    noun?: string;
    /** Override the default confirm+remove (e.g. Projects cascade-delete). */
    onDelete?: () => void;
  } = {},
): MenuItem[] {
  const store = useNotesStore.getState();
  const noun = opts.noun ?? "note";
  const items: MenuItem[] = [];
  if (opts.onOpen) {
    items.push({
      label: "Open",
      icon: <SquareArrowOutUpRight size={ICON} />,
      onClick: opts.onOpen,
    });
  }
  items.push({
    label: "Rename",
    icon: <Pencil size={ICON} />,
    onClick: () => {
      void (async () => {
        const name = await promptText({
          title: `Rename ${noun}`,
          initialValue: note.title,
          placeholder: "Title",
          confirmLabel: "Rename",
        });
        if (name != null) await store.saveTitle(note.id, name);
      })();
    },
  });
  items.push({
    label: note.favorite ? "Remove from favorites" : "Add to favorites",
    icon: <Star size={ICON} />,
    onClick: () => void store.toggleFavorite(note.id),
  });
  items.push({
    label: "Export as Markdown…",
    icon: <FileDown size={ICON} />,
    onClick: () =>
      void exportNoteAsMarkdown(note).catch((e) => log.warn("export failed", e)),
  });
  if (opts.extra?.length) items.push(...opts.extra);
  items.push({ type: "separator" });
  items.push({
    label: "Delete",
    icon: <Trash2 size={ICON} />,
    danger: true,
    onClick: () => {
      if (opts.onDelete) {
        opts.onDelete();
        return;
      }
      void (async () => {
        const ok = await confirmDialog(
          `Delete "${note.title || "Untitled"}"? This cannot be undone.`,
          { title: `Delete ${noun}`, kind: "warning" },
        );
        if (!ok) return;
        await store.remove(note.id);
        opts.onDeleted?.();
      })();
    },
  });
  return items;
}

/** Context-menu items for a media asset. */
export function assetMenuItems(
  asset: Asset,
  opts: {
    onOpen?: () => void;
    onAddToBoard?: () => void;
    onDeleted?: () => void;
  } = {},
): MenuItem[] {
  const store = useAssetsStore.getState();
  const items: MenuItem[] = [];
  if (opts.onOpen) {
    items.push({
      label: "Open preview",
      icon: <SquareArrowOutUpRight size={ICON} />,
      onClick: opts.onOpen,
    });
  }
  items.push({
    label: asset.favorite ? "Remove from favorites" : "Add to favorites",
    icon: <Star size={ICON} />,
    onClick: () => void store.toggleFavorite(asset.id),
  });
  if (opts.onAddToBoard) {
    items.push({
      label: "Add to board…",
      icon: <ImagePlus size={ICON} />,
      onClick: opts.onAddToBoard,
    });
  }
  if (asset.filePath) {
    items.push({
      label: "Copy file path",
      icon: <LinkIcon size={ICON} />,
      onClick: () => {
        void navigator.clipboard
          .writeText(asset.filePath)
          .catch((e) => log.warn("clipboard write failed", e));
      },
    });
  }
  items.push({ type: "separator" });
  items.push({
    label: "Delete",
    icon: <Trash2 size={ICON} />,
    danger: true,
    onClick: () => {
      void (async () => {
        const ok = await confirmDialog(
          `Delete "${asset.title}"? This removes the file from your Archives.`,
          { title: "Delete asset", kind: "warning" },
        );
        if (!ok) return;
        await store.remove(asset.id);
        opts.onDeleted?.();
      })();
    },
  });
  return items;
}

/** Context-menu items for a mood board. */
export function boardMenuItems(
  board: MoodBoard,
  opts: { onOpen?: () => void; onDeleted?: () => void } = {},
): MenuItem[] {
  const store = useMoodBoardsStore.getState();
  const items: MenuItem[] = [];
  if (opts.onOpen) {
    items.push({
      label: "Open",
      icon: <SquareArrowOutUpRight size={ICON} />,
      onClick: opts.onOpen,
    });
  }
  items.push({
    label: "Rename",
    icon: <Pencil size={ICON} />,
    onClick: () => {
      void (async () => {
        const name = await promptText({
          title: "Rename board",
          initialValue: board.title,
          placeholder: "Board name",
          confirmLabel: "Rename",
        });
        if (name != null) await store.rename(board.id, name);
      })();
    },
  });
  items.push({
    label: board.favorite ? "Remove from favorites" : "Add to favorites",
    icon: <Star size={ICON} />,
    onClick: () => void store.toggleFavorite(board.id),
  });
  items.push({ type: "separator" });
  items.push({
    label: "Delete board",
    icon: <Trash2 size={ICON} />,
    danger: true,
    onClick: () => {
      void (async () => {
        const ok = await confirmDialog(
          `Delete "${board.title}"? The assets stay in your Media library.`,
          { title: "Delete board", kind: "warning" },
        );
        if (!ok) return;
        await store.remove(board.id);
        opts.onDeleted?.();
      })();
    },
  });
  return items;
}

/** A small reusable "+ new" menu item that some views surface in their More menu. */
export { Plus };
