import { create } from "zustand";
import { setAppState } from "@/lib/db";

type AutocompleteState = {
  /** Ghost-text completions on/off (persisted). API-key-less installs can
   * leave this on — the backend quietly returns nothing without a key. */
  enabled: boolean;
  /** Rolling latency telemetry for the status surface (and honesty). */
  lastLatencyMs: number | null;
  toggle: () => void;
  setEnabled: (on: boolean) => void;
  reportLatency: (ms: number) => void;
  hydrate: (value: boolean | null | undefined) => void;
};

export const useAutocomplete = create<AutocompleteState>((set, get) => ({
  enabled: true,
  lastLatencyMs: null,
  toggle: () => get().setEnabled(!get().enabled),
  setEnabled: (on) => {
    set({ enabled: on });
    void setAppState("tab_autocomplete", on);
  },
  reportLatency: (ms) => set({ lastLatencyMs: Math.round(ms) }),
  hydrate: (value) => set({ enabled: value !== false }),
}));
