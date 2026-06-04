import { useEffect, useState } from "react";
import { useVoice } from "@/store/voiceStore";

/** Brief screen-edge glow that fires whenever the wake word is recognized.
 * Keyed off `voice.wakePulse` so repeated triggers re-fire. Purely visual
 * confirmation — pairs with the earcon. */
export function WakeFlash() {
  const wakePulse = useVoice((s) => s.wakePulse);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (wakePulse === 0) return; // initial state, never flashed
    setActive(true);
    const t = setTimeout(() => setActive(false), 900);
    return () => clearTimeout(t);
  }, [wakePulse]);

  if (!active) return null;
  // `key` forces a fresh element each pulse so the CSS animation restarts
  // even on back-to-back triggers.
  return <div key={wakePulse} className="ot-wake-flash" aria-hidden />;
}
