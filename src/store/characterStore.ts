import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import { setAppState } from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import {
  BUILTIN_CHARACTERS,
  ROSIE_ID,
  type Character,
  type CustomCharacter,
} from "@/features/characters/catalog";

type Persisted = {
  selectedId: string;
  custom: CustomCharacter[];
};

type CharacterStore = Persisted & {
  hydrate: (s: Partial<Persisted>) => void;
  all: () => Character[];
  selected: () => Character | null;
  setSelected: (id: string) => void;
  addCustomFromPath: (sourcePath: string) => Promise<void>;
  removeCustom: (id: string) => Promise<void>;
  /** Resolve a renderable URL for any character. */
  urlFor: (c: Character) => string;
};

const DEFAULT_SELECTED = ROSIE_ID;

function persist(s: CharacterStore) {
  void setAppState("characters", {
    selectedId: s.selectedId,
    custom: s.custom,
  } satisfies Persisted);
}

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  selectedId: DEFAULT_SELECTED,
  custom: [],

  hydrate: (s) =>
    set((prev) => ({
      ...prev,
      selectedId:
        typeof s.selectedId === "string" ? s.selectedId : prev.selectedId,
      custom: Array.isArray(s.custom) ? s.custom : prev.custom,
    })),

  all: () => [...BUILTIN_CHARACTERS, ...get().custom],

  selected: () => {
    const { selectedId } = get();
    return get().all().find((c) => c.id === selectedId) ?? null;
  },

  setSelected: (id) => {
    if (!get().all().some((c) => c.id === id)) return;
    set({ selectedId: id });
    persist(get());
  },

  urlFor: (c) => (c.custom ? convertFileSrc(c.filePath) : c.url),

  addCustomFromPath: async (sourcePath) => {
    const stored = await ipc.characterStoreFile(sourcePath);
    const name = stored.originalName
      .replace(/\.(glb|gltf)$/i, "")
      .replace(/[_-]+/g, " ")
      .trim();
    const item: CustomCharacter = {
      id: `custom-${crypto.randomUUID()}`,
      name: name || "My Character",
      filePath: stored.filePath,
      custom: true,
    };
    set((prev) => ({ custom: [...prev.custom, item], selectedId: item.id }));
    persist(get());
  },

  removeCustom: async (id) => {
    const item = get().custom.find((c) => c.id === id);
    if (!item) return;
    set((prev) => {
      const custom = prev.custom.filter((c) => c.id !== id);
      const selectedId =
        prev.selectedId === id ? DEFAULT_SELECTED : prev.selectedId;
      return { custom, selectedId };
    });
    persist(get());
    ipc.characterClearFile(item.filePath).catch((err) =>
      log.warn("character_clear_file failed", err),
    );
  },
}));
