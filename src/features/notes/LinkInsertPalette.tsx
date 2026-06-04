import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useNotesStore } from "@/store/notesStore";
import { create } from "zustand";
import { formatOrionUri } from "@/lib/orionProtocol";

type InsertResult = {
  href: string;
  text: string;
};

type LinkPaletteState = {
  open: boolean;
  excludeNoteId: string | null;
  resolve: ((r: InsertResult | null) => void) | null;
  show: (excludeNoteId: string | null) => Promise<InsertResult | null>;
  cancel: () => void;
  pick: (r: InsertResult) => void;
};

export const useLinkPaletteStore = create<LinkPaletteState>((set, get) => ({
  open: false,
  excludeNoteId: null,
  resolve: null,
  show: (excludeNoteId) =>
    new Promise((resolve) => {
      const prev = get().resolve;
      if (prev) prev(null);
      set({ open: true, excludeNoteId, resolve });
    }),
  cancel: () => {
    const r = get().resolve;
    set({ open: false, resolve: null });
    if (r) r(null);
  },
  pick: (result) => {
    const r = get().resolve;
    set({ open: false, resolve: null });
    if (r) r(result);
  },
}));

export function LinkInsertPalette() {
  const open = useLinkPaletteStore((s) => s.open);
  const excludeNoteId = useLinkPaletteStore((s) => s.excludeNoteId);
  const cancel = useLinkPaletteStore((s) => s.cancel);
  const pick = useLinkPaletteStore((s) => s.pick);
  const notes = useNotesStore((s) => s.list)();

  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const items = useMemo(() => {
    return notes
      .filter((n) => n.id !== excludeNoteId)
      .slice(0, 200)
      .map((n) => ({
        id: n.id,
        title: n.title.trim() || "Untitled",
      }));
  }, [notes, excludeNoteId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <Command
        label="Insert note link"
        className="w-[min(560px,90vw)] rounded-lg border border-border bg-bg-elevated shadow-2xl overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
        }}
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Link a note…"
          className="w-full px-4 py-3 bg-transparent outline-none border-b border-border text-sm font-mono"
        />
        <Command.List className="max-h-72 overflow-y-auto p-1">
          <Command.Empty className="px-3 py-2 text-xs text-fg-subtle">
            No matching notes.
          </Command.Empty>
          {items.map((n) => (
            <Command.Item
              key={n.id}
              value={`${n.title} ${n.id}`}
              onSelect={() =>
                pick({
                  href: formatOrionUri({ kind: "note", id: n.id }),
                  text: n.title,
                })
              }
              className="px-3 py-1.5 text-sm font-mono rounded cursor-pointer data-[selected=true]:bg-bg-hover data-[selected=true]:text-fg text-fg-muted"
            >
              {n.title}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
