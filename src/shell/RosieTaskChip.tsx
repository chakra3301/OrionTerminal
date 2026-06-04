import { useEffect, useState } from "react";
import { StopCircle } from "lucide-react";
import { useRosie, currentActivity } from "@/features/rosie/rosieStore";

/** Floating "R.O.S.I.E is working" chip. Surfaces only when a turn is
 * running AND the panel is closed — so dismissing the panel mid-task
 * doesn't hide all progress. Shows live activity (current tool / thinking /
 * responding) + elapsed time, click to re-open the panel, stop to cancel. */
export function RosieTaskChip() {
  const open = useRosie((s) => s.open);
  const running = useRosie((s) => s.running);
  const turnStartedAt = useRosie((s) => s.turnStartedAt);
  const openPanel = useRosie((s) => s.openPanel);
  const cancel = useRosie((s) => s.cancel);
  // Subscribe to the slices currentActivity reads so the label re-renders.
  const toolCalls = useRosie((s) => s.toolCalls);
  const messages = useRosie((s) => s.messages);

  const [elapsed, setElapsed] = useState(0);

  const visible = running && !open;

  useEffect(() => {
    if (!visible || turnStartedAt == null) return;
    const tick = () =>
      setElapsed(Math.max(0, Math.round((Date.now() - turnStartedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [visible, turnStartedAt]);

  if (!visible) return null;

  const activity = currentActivity(useRosie.getState());
  // Reference the subscribed slices so eslint/react keep the re-render dep
  // honest (the values themselves feed currentActivity via getState()).
  void toolCalls;
  void messages;

  return (
    <div className="ot-rosie-task" role="status">
      <button
        type="button"
        className="ot-rosie-task-main"
        onClick={openPanel}
        title="Open R.O.S.I.E"
      >
        <div className="ot-claude-orb" style={{ width: 16, height: 16 }} />
        <div className="ot-rosie-task-text">
          <span className="activity">{activity}</span>
          <span className="elapsed">{formatElapsed(elapsed)}</span>
        </div>
      </button>
      <button
        type="button"
        className="ot-rosie-task-stop"
        onClick={cancel}
        title="Stop"
      >
        <StopCircle size={14} />
      </button>
    </div>
  );
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
