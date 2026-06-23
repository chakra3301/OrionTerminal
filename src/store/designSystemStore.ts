import { create } from "zustand";
import {
  listDesignSystems,
  upsertDesignSystem,
  deleteDesignSystem,
  getActiveDesignSystemId,
  setActiveDesignSystemId,
} from "@/lib/xdDesignSystemDb";
import {
  BUILTIN_DESIGN_SYSTEMS,
  type DesignSystem,
} from "@/apps/xdesign/designSystem";
import { log } from "@/lib/log";

type DSState = {
  systems: DesignSystem[];
  activeId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  active: () => DesignSystem | null;
  setActive: (id: string | null) => Promise<void>;
  save: (ds: DesignSystem) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useDesignSystems = create<DSState>((set, get) => ({
  systems: [],
  activeId: null,
  loaded: false,

  load: async () => {
    try {
      let systems = await listDesignSystems();
      // Seed built-ins on first run (idempotent — only when absent).
      const have = new Set(systems.map((s) => s.id));
      const now = Date.now();
      const missing = BUILTIN_DESIGN_SYSTEMS.filter((b) => !have.has(b.id));
      if (missing.length) {
        for (const b of missing) {
          await upsertDesignSystem({ ...b, createdAt: now, updatedAt: now });
        }
        systems = await listDesignSystems();
      }
      let activeId = await getActiveDesignSystemId();
      if (!activeId && systems.length) {
        activeId = systems[0]!.id;
        await setActiveDesignSystemId(activeId);
      }
      set({ systems, activeId, loaded: true });
    } catch (e) {
      log.warn("design systems load failed", e);
      set({ loaded: true });
    }
  },

  active: () => {
    const { systems, activeId } = get();
    return systems.find((s) => s.id === activeId) ?? null;
  },

  setActive: async (id) => {
    set({ activeId: id });
    try {
      await setActiveDesignSystemId(id);
    } catch (e) {
      log.warn("setActive design system failed", e);
    }
  },

  save: async (ds) => {
    set((s) => {
      const idx = s.systems.findIndex((x) => x.id === ds.id);
      const systems =
        idx >= 0
          ? s.systems.map((x) => (x.id === ds.id ? ds : x))
          : [...s.systems, ds];
      return { systems };
    });
    try {
      await upsertDesignSystem(ds);
    } catch (e) {
      log.warn("save design system failed", e);
    }
  },

  remove: async (id) => {
    set((s) => {
      const systems = s.systems.filter((x) => x.id !== id);
      const activeId = s.activeId === id ? (systems[0]?.id ?? null) : s.activeId;
      return { systems, activeId };
    });
    try {
      await deleteDesignSystem(id);
      const cur = get().activeId;
      await setActiveDesignSystemId(cur);
    } catch (e) {
      log.warn("remove design system failed", e);
    }
  },
}));
