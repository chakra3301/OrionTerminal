import { create } from "zustand";
import { ulid } from "ulid";
import {
  listProperties,
  createProperty,
  updateProperty,
  deleteProperty,
  listValuesForCollection,
  setValue as dbSetValue,
  listViews,
  createView,
  updateView as dbUpdateView,
  deleteView,
  type CollectionView,
  type ViewType,
  type ViewConfig,
} from "@/features/database/databaseDb";
import {
  OPTION_COLORS,
  type Property,
  type PropertyType,
  type SelectOption,
} from "@/features/database/propertyTypes";
import { log } from "@/lib/log";

type DatabaseState = {
  collectionId: string | null;
  loading: boolean;
  properties: Property[];
  /** noteId -> (propertyId -> raw value) */
  values: Map<string, Map<string, string>>;
  views: CollectionView[];
  activeViewId: string | null;

  load: (collectionId: string) => Promise<void>;
  valueAt: (noteId: string, propertyId: string) => string;

  addProperty: (name: string, type: PropertyType) => Promise<void>;
  renameProperty: (id: string, name: string) => Promise<void>;
  setPropertyType: (id: string, type: PropertyType) => Promise<void>;
  removeProperty: (id: string) => Promise<void>;
  addOption: (propertyId: string, name: string) => Promise<SelectOption | null>;

  setValue: (noteId: string, propertyId: string, value: string) => Promise<void>;

  addView: (name: string, type: ViewType) => Promise<void>;
  setActiveView: (id: string) => void;
  patchActiveView: (config: Partial<ViewConfig>) => Promise<void>;
  removeView: (id: string) => Promise<void>;
};

export const useDatabase = create<DatabaseState>((set, get) => ({
  collectionId: null,
  loading: false,
  properties: [],
  values: new Map(),
  views: [],
  activeViewId: null,

  load: async (collectionId) => {
    set({ collectionId, loading: true });
    try {
      const [properties, values, existingViews] = await Promise.all([
        listProperties(collectionId),
        listValuesForCollection(collectionId),
        listViews(collectionId),
      ]);
      let views = existingViews;
      // Every database has at least a Table view.
      if (views.length === 0) {
        const table = await createView(collectionId, "Table", "table", 0);
        views = [table];
      }
      set({
        properties,
        values,
        views,
        activeViewId: views[0]?.id ?? null,
        loading: false,
      });
    } catch (e) {
      log.error("database load failed", e);
      set({ loading: false });
    }
  },

  valueAt: (noteId, propertyId) =>
    get().values.get(noteId)?.get(propertyId) ?? "",

  addProperty: async (name, type) => {
    const cid = get().collectionId;
    if (!cid) return;
    const pos = get().properties.length;
    const prop = await createProperty(cid, name, type, pos);
    set((s) => ({ properties: [...s.properties, prop] }));
  },

  renameProperty: async (id, name) => {
    await updateProperty(id, { name });
    set((s) => ({
      properties: s.properties.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  },

  setPropertyType: async (id, type) => {
    await updateProperty(id, { type });
    set((s) => ({
      properties: s.properties.map((p) => (p.id === id ? { ...p, type } : p)),
    }));
  },

  removeProperty: async (id) => {
    await deleteProperty(id);
    set((s) => {
      const values = new Map(s.values);
      for (const [noteId, m] of values) {
        if (m.has(id)) {
          const nm = new Map(m);
          nm.delete(id);
          values.set(noteId, nm);
        }
      }
      return { properties: s.properties.filter((p) => p.id !== id), values };
    });
  },

  addOption: async (propertyId, name) => {
    const prop = get().properties.find((p) => p.id === propertyId);
    if (!prop) return null;
    const option: SelectOption = {
      id: ulid(),
      name,
      color: OPTION_COLORS[prop.options.length % OPTION_COLORS.length]!,
    };
    const options = [...prop.options, option];
    await updateProperty(propertyId, { options });
    set((s) => ({
      properties: s.properties.map((p) =>
        p.id === propertyId ? { ...p, options } : p,
      ),
    }));
    return option;
  },

  setValue: async (noteId, propertyId, value) => {
    // Optimistic.
    set((s) => {
      const values = new Map(s.values);
      const m = new Map(values.get(noteId) ?? []);
      if (value === "") m.delete(propertyId);
      else m.set(propertyId, value);
      values.set(noteId, m);
      return { values };
    });
    try {
      await dbSetValue(noteId, propertyId, value);
    } catch (e) {
      log.error("set value failed", e);
    }
  },

  addView: async (name, type) => {
    const cid = get().collectionId;
    if (!cid) return;
    const pos = get().views.length;
    const view = await createView(cid, name, type, pos);
    set((s) => ({ views: [...s.views, view], activeViewId: view.id }));
  },

  setActiveView: (id) => set({ activeViewId: id }),

  patchActiveView: async (config) => {
    const id = get().activeViewId;
    if (!id) return;
    const view = get().views.find((v) => v.id === id);
    if (!view) return;
    const merged = { ...view.config, ...config };
    set((s) => ({
      views: s.views.map((v) => (v.id === id ? { ...v, config: merged } : v)),
    }));
    await dbUpdateView(id, { config: merged });
  },

  removeView: async (id) => {
    if (get().views.length <= 1) return; // keep at least one
    await deleteView(id);
    set((s) => {
      const views = s.views.filter((v) => v.id !== id);
      return {
        views,
        activeViewId: s.activeViewId === id ? (views[0]?.id ?? null) : s.activeViewId,
      };
    });
  },
}));
