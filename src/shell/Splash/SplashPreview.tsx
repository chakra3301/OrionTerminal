import { useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { SplashScreen } from "./SplashScreen";
import { useSplashPreview } from "./splashPreviewStore";
import type { CoreMode } from "./EnergyCore";

/** Dev harness overlay: loops the splash, toggles launch/idle, replays the
 * assembly burst. Mounted from Shell; renders nothing unless opened via the
 * dev-only `dev.splashPreview` command. */
export function SplashPreview() {
  const open = useSplashPreview((s) => s.open);
  const hide = useSplashPreview((s) => s.hide);
  const [mode, setMode] = useState<CoreMode>("launch");
  const [nonce, setNonce] = useState(0);

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9001 }}>
      {/* key remounts on replay / mode switch so the launch burst re-runs. */}
      <SplashScreen key={`${mode}:${nonce}`} mode={mode} ready={false} />
      <div className="ot-splash-preview-bar">
        <span className="ot-spb-tag">SPLASH PREVIEW · dev</span>
        <div className="ot-spb-seg">
          <button
            className={mode === "launch" ? "on" : ""}
            onClick={() => {
              setMode("launch");
              setNonce((n) => n + 1);
            }}
          >
            Launch
          </button>
          <button
            className={mode === "idle" ? "on" : ""}
            onClick={() => setMode("idle")}
          >
            Idle (login)
          </button>
        </div>
        <button className="ot-spb-btn" onClick={() => setNonce((n) => n + 1)}>
          <RotateCcw size={12} /> Replay
        </button>
        <button className="ot-spb-btn" onClick={hide}>
          <X size={12} /> Close
        </button>
      </div>
    </div>
  );
}
