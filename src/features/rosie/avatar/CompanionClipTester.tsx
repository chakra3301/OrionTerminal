import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCompanionDebug } from "./companionDebugStore";

/**
 * Clip-test overlay (toggled by the `companion.clipTest` command). Steps the
 * companion through every animation clip by name so the user can decide event
 * mappings. Renders nothing unless test mode is on.
 */
export function CompanionClipTester() {
  const testMode = useCompanionDebug((s) => s.testMode);
  const names = useCompanionDebug((s) => s.names);
  const index = useCompanionDebug((s) => s.index);
  const next = useCompanionDebug((s) => s.next);
  const prev = useCompanionDebug((s) => s.prev);
  const toggle = useCompanionDebug((s) => s.toggle);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    if (!auto || !testMode) return;
    const id = setInterval(() => useCompanionDebug.getState().next(), 3500);
    return () => clearInterval(id);
  }, [auto, testMode]);

  if (!testMode) return null;
  const name = names[index] ?? "—";

  return (
    <div className="ot-clip-tester">
      <button className="ot-clip-btn" onClick={prev} aria-label="Previous clip">
        <ChevronLeft size={16} />
      </button>
      <div className="ot-clip-name">
        <span className="nm">{name}</span>
        <span className="ix">
          {names.length ? `${index + 1} / ${names.length}` : "no clips loaded"}
        </span>
      </div>
      <button className="ot-clip-btn" onClick={next} aria-label="Next clip">
        <ChevronRight size={16} />
      </button>
      <button
        className={`ot-clip-auto${auto ? " on" : ""}`}
        onClick={() => setAuto((a) => !a)}
        title="Auto-advance through clips"
      >
        auto
      </button>
      <button className="ot-clip-exit" onClick={toggle} title="Exit clip test">
        <X size={14} />
      </button>
    </div>
  );
}
