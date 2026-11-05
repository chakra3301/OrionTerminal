import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useXDProjects } from "./projectsStore";

/** Opening a large project can take several seconds behind the dimmed workspace; a quick switch stays silent. */
export function ProjectChangeStatus() {
  const transitioning = useXDProjects(state => state.transitioning);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!transitioning) { setShown(false); return; }
    const timer = window.setTimeout(() => setShown(true), 500);
    return () => window.clearTimeout(timer);
  }, [transitioning]);
  return shown ? <div className="xd-project-status" role="status"><Loader2 size={14} className="ot-spin" aria-hidden="true"/>Loading project…</div> : null;
}
