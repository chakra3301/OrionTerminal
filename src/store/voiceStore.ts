import { create } from "zustand";
import { log } from "@/lib/log";
import { useRosie } from "@/features/rosie/rosieStore";

export type VoiceStatus =
  | "idle"
  /** First-call model warmup; only fires the very first time. */
  | "loading_model"
  | "requesting_mic"
  | "recording"
  /** Ambient wake-word mode active — mic open, waiting for a trigger. */
  | "listening"
  | "transcribing"
  | "error";

type VoiceState = {
  status: VoiceStatus;
  /** Live 0..1 amplitude during recording — drives the menubar waveform. */
  amplitude: number;
  /** Last transcribed text. Cleared on next session start. */
  lastTranscript: string;
  /** Human-readable error message (e.g. "Microphone access denied"). */
  error: string | null;

  /** Ambient wake-word listening enabled (persisted). Independent of the
   * push-to-talk `toggle()` flow. */
  listenMode: boolean;
  /** Monotonic counter bumped each time the wake word is recognized. The
   * screen-edge flash overlay keys its animation off this so repeated
   * triggers re-fire the glow. */
  wakePulse: number;

  setStatus: (status: VoiceStatus) => void;
  setAmplitude: (a: number) => void;
  setTranscript: (t: string) => void;
  setError: (e: string | null) => void;
  setListenMode: (v: boolean) => void;
  /** Bump wakePulse — call when a wake word is recognized. */
  pulse: () => void;

  /** Top-level toggle. If idle → start recording. If recording → stop +
   * transcribe. While loading/transcribing, no-op. */
  toggle: () => Promise<void>;
  /** Force-stop and discard any pending audio. */
  cancel: () => void;
  /** Turn ambient wake-word listening on/off. */
  toggleListening: () => Promise<void>;
};

export const useVoice = create<VoiceState>((set, get) => ({
  status: "idle",
  amplitude: 0,
  lastTranscript: "",
  error: null,
  listenMode: false,
  wakePulse: 0,

  setStatus: (status) => set({ status }),
  setAmplitude: (amplitude) => set({ amplitude }),
  setTranscript: (lastTranscript) => set({ lastTranscript }),
  setError: (error) => set({ error }),
  setListenMode: (listenMode) => set({ listenMode }),
  pulse: () => set((s) => ({ wakePulse: s.wakePulse + 1 })),

  toggleListening: async () => {
    const next = !get().listenMode;
    set({ listenMode: next });
    void import("@/lib/db").then((m) =>
      m.setAppState("voice.listenMode", next),
    );
    const [wake, earcon] = await Promise.all([
      import("@/lib/wakeWord"),
      import("@/lib/earcon"),
    ]);
    if (next) {
      try {
        await wake.startListening();
        earcon.earconArmed();
      } catch {
        set({ listenMode: false });
      }
    } else {
      wake.stopListening();
      earcon.earconDisarmed();
    }
  },

  toggle: async () => {
    const cur = get().status;
    if (cur === "loading_model" || cur === "transcribing") return;
    // Push-to-talk and ambient listening are mutually exclusive — pause
    // the ambient listener for the duration of an explicit recording.
    if (get().listenMode && cur !== "recording") {
      const wake = await import("@/lib/wakeWord");
      wake.stopListening();
    }
    // Lazy-import the capture module so the @xenova/transformers chunk
    // doesn't load until the user actually uses voice.
    const { startVoiceCapture, stopAndTranscribe } = await import(
      "@/lib/voiceCapture"
    );
    if (cur === "recording") {
      const transcript = await stopAndTranscribe();
      if (transcript && transcript.trim()) {
        // Drop the transcript into Core: open the panel + populate input.
        // Auto-send is too aggressive (user can't preview/edit) — they
        // hit Enter to actually run it.
        const core = useRosie.getState();
        core.openPanel();
        core.setPendingInput(transcript.trim());
        set({ lastTranscript: transcript });
      }
      // Resume ambient listening if it was on before this push-to-talk.
      if (get().listenMode) {
        const wake = await import("@/lib/wakeWord");
        void wake.startListening();
      }
      return;
    }
    try {
      await startVoiceCapture();
    } catch (e) {
      log.warn("voice start failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: "error", error: msg });
    }
  },

  cancel: () => {
    set({ status: "idle", amplitude: 0, error: null });
    void (async () => {
      const m = await import("@/lib/voiceCapture");
      m.abortVoiceCapture();
    })();
  },
}));
