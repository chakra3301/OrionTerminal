import { create } from "zustand";
import { getAppState, setAppState, hasAnyUserData } from "@/lib/db";
import { log } from "@/lib/log";

export type CoachStep = {
  selector: string;
  title: string;
  body: string;
};

// dock → Spotlight → the three apps.
export const COACH_STEPS: CoachStep[] = [
  {
    selector: ".ot-dock",
    title: "Your dock",
    body: "Every app lives here. Click an icon to open it as a window you can move, resize and full-screen.",
  },
  {
    selector: '[data-coach="spotlight"]',
    title: "Spotlight · ⌘K",
    body: "One box to search apps, files and notes — and to run any command. Type “>” to search commands only.",
  },
  {
    selector: '[data-coach="app-archives"]',
    title: "Archives 47 · ⌘1",
    body: "Your notes, journal, projects and media. Capture with ⌘⇧N; ask your whole archive with ⌘⇧A.",
  },
  {
    selector: '[data-coach="app-orion"]',
    title: "Orion · ⌘2",
    body: "The AI code editor. Open a folder, then select code and press ⌘K to edit it inline with Claude.",
  },
  {
    selector: '[data-coach="app-xdesign"]',
    title: "XDesign · ⌘3",
    body: "The design studio — canvas, vector, prototypes, and export-to-code. Press ⌘L any time for R.O.S.I.E.",
  },
];

type OnboardingState = {
  active: boolean;
  step: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  dismiss: () => void;
  /** Auto-start the tour exactly once, for a genuinely fresh install. An
   * install that already holds data is marked complete silently — existing
   * owners never get a tutorial they don't need. */
  maybeAutoStart: () => Promise<void>;
};

let autoStartTried = false;

export const useOnboarding = create<OnboardingState>((set, get) => ({
  active: false,
  step: 0,

  start: () => set({ active: true, step: 0 }),

  next: () => {
    const { step } = get();
    if (step >= COACH_STEPS.length - 1) {
      get().dismiss();
    } else {
      set({ step: step + 1 });
    }
  },

  prev: () => set({ step: Math.max(0, get().step - 1) }),

  dismiss: () => {
    set({ active: false });
    void setAppState("onboarding.completed", true).catch((e) =>
      log.warn("persist onboarding.completed failed", e),
    );
  },

  maybeAutoStart: async () => {
    if (autoStartTried || get().active) return;
    autoStartTried = true;
    try {
      const done = await getAppState<boolean>("onboarding.completed");
      if (done) return;
      const hasData = await hasAnyUserData();
      if (hasData) {
        // Existing vault — don't pester; just record it as seen.
        await setAppState("onboarding.completed", true);
        return;
      }
      set({ active: true, step: 0 });
    } catch (e) {
      log.warn("onboarding auto-start check failed", e);
    }
  },
}));
