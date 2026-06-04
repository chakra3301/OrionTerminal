import { Wifi, BatteryMedium, Mic, MicOff, Loader2 } from "lucide-react";
import { useShell, focusedApp, APP_NAMES } from "@/shell/store/useShell";
import { useClock } from "@/shell/useClock";
import { useVoice } from "@/store/voiceStore";

// Twelve bars driven by CSS animations. Heights/delays are pseudo-random
// (hand-picked) so each bar moves on its own beat — gives the impression of
// a live waveform without actually sampling audio.
const WAVE_BARS: Array<{ delay: number; duration: number; peak: number }> = [
  { delay: 0,    duration: 0.95, peak: 0.55 },
  { delay: 0.12, duration: 0.78, peak: 0.85 },
  { delay: 0.24, duration: 1.10, peak: 0.7  },
  { delay: 0.36, duration: 0.82, peak: 0.95 },
  { delay: 0.04, duration: 1.04, peak: 0.6  },
  { delay: 0.18, duration: 0.88, peak: 0.78 },
  { delay: 0.30, duration: 1.16, peak: 0.5  },
  { delay: 0.08, duration: 0.92, peak: 0.88 },
  { delay: 0.22, duration: 0.74, peak: 0.62 },
  { delay: 0.34, duration: 1.08, peak: 0.92 },
  { delay: 0.16, duration: 0.86, peak: 0.7  },
  { delay: 0.28, duration: 0.98, peak: 0.45 },
];

const APP_MENUS: Record<string, string[]> = {
  archives: ["File", "Edit", "View", "Insert", "Format"],
  orion: ["File", "Edit", "Selection", "View", "Run", "Terminal"],
  xdesign: ["File", "Edit", "Object", "Type", "Effect", "View"],
  hermes: ["Board", "Task", "Agents", "View"],
};

const DEFAULT_MENU = ["File", "Edit", "View", "Window"];

function VoiceIndicator() {
  const status = useVoice((s) => s.status);
  const amplitude = useVoice((s) => s.amplitude);
  const toggle = useVoice((s) => s.toggle);
  const toggleListening = useVoice((s) => s.toggleListening);
  const listenMode = useVoice((s) => s.listenMode);
  const error = useVoice((s) => s.error);

  const recording = status === "recording";
  const transcribing = status === "transcribing";
  const loading = status === "loading_model";
  const listening = status === "listening" || (listenMode && !recording);
  const busy = transcribing || loading;
  // Amplitude-driven bars whenever the mic is live (recording OR listening).
  const live = recording || listening;
  const label =
    status === "error"
      ? error ?? "Voice error"
      : recording
        ? `Recording — input ${Math.round(amplitude * 100)}% · click to stop`
        : transcribing
          ? "Transcribing…"
          : loading
            ? "Loading speech model…"
            : listening
              ? `Listening for "Rosie…" — ${Math.round(amplitude * 100)}% · ⌘⇧J to stop`
              : "Click or ⌘⇧V to speak · ⌘⇧J for wake-word mode";

  const Icon = status === "error" ? MicOff : busy ? Loader2 : Mic;
  const stateClass = recording
    ? "active"
    : listening
      ? "listening"
      : busy
        ? "busy"
        : status === "error"
          ? "error"
          : "";

  return (
    <button
      type="button"
      className={`ot-mb-wave ${stateClass}`}
      title={label}
      onClick={() => void toggle()}
      onContextMenu={(e) => {
        // Right-click toggles wake-word (ambient) listening.
        e.preventDefault();
        void toggleListening();
      }}
      disabled={busy}
    >
      <Icon
        size={11}
        className={`ot-mb-wave-icon${busy ? " spin" : ""}`}
      />
      <div className="ot-mb-wave-bars">
        {WAVE_BARS.map((b, i) => {
          // While the mic is live (recording or ambient listening), drive
          // bar height from real amplitude (tiny per-bar offset so they
          // don't all twin). Otherwise let the CSS ambient animation run.
          if (live) {
            const wobble = ((i * 37) % 11) / 30; // 0..0.36, stable per bar
            const peak = Math.min(1, amplitude + wobble);
            return (
              <span
                key={i}
                className="ot-mb-wave-bar live"
                style={{ ["--peak" as string]: peak.toFixed(3) }}
              />
            );
          }
          return (
            <span
              key={i}
              className="ot-mb-wave-bar"
              style={{
                animationDelay: `${b.delay}s`,
                animationDuration: `${b.duration}s`,
                ["--peak" as string]: b.peak,
              }}
            />
          );
        })}
      </div>
    </button>
  );
}

export function MenuBar() {
  const time = useClock();
  const app = useShell(focusedApp);

  const items = app ? APP_MENUS[app] ?? DEFAULT_MENU : DEFAULT_MENU;
  const appLabel = app ? APP_NAMES[app] : "Desktop";

  const clockText = time.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const dateText = time.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="ot-menubar">
      <div className="ot-menubar-logo">
        <span className="dot" />
        <span>ORION TERMINAL</span>
      </div>
      <div className="ot-menubar-sep" />
      <div className="ot-menubar-items">
        <span className="ot-menubar-app">{appLabel}</span>
        {items.map((it) => (
          <button type="button" key={it}>
            {it}
          </button>
        ))}
      </div>
      <div className="ot-menubar-spacer" />
      <div className="ot-menubar-status">
        <VoiceIndicator />
        <span className="pill">
          <span className="pill-dot" />
          CLAUDE • ONLINE
        </span>
        <span style={{ color: "var(--t-secondary)" }}>
          <Wifi size={13} />
        </span>
        <span
          style={{
            color: "var(--t-secondary)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <BatteryMedium size={14} /> 84%
        </span>
        <span style={{ color: "var(--t-tertiary)" }}>{dateText}</span>
        <span style={{ color: "var(--t-primary)" }}>{clockText}</span>
      </div>
    </div>
  );
}
