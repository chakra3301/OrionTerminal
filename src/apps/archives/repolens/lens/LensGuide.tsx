import { useState } from "react";
import { guideFor } from "../help";

/** Collapsible "how to read this" strip shown atop a lens result. */
export function LensGuide({ k }: { k: string }) {
  const g = guideFor(k);
  const [open, setOpen] = useState(false);
  if (!g) return null;
  return (
    <div className="rl-guide">
      <button className="rl-guide-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} How to read this
      </button>
      {open && (
        <div className="rl-guide-body">
          <p>{g.howToUse}</p>
          {g.misconceptions.length > 0 && (
            <ul>
              {g.misconceptions.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
