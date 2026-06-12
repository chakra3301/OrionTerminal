import { ChevronRight } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";

/** Slim path trail above the editor: project-relative segments, plus the
 * enclosing symbol (TS/JS via the worker's navigation tree) when known. */
export function Breadcrumbs({ path, symbol }: { path: string; symbol: string | null }) {
  const root = useProjectStore((s) => s.active?.root_path);
  const rel = root && path.startsWith(root) ? path.slice(root.length).replace(/^\//, "") : path;
  const segments = rel.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <div className="or-bc" aria-label="Breadcrumbs">
      {segments.map((seg, i) => {
        const last = i === segments.length - 1;
        return (
          <span key={`${seg}-${i}`} className="or-bc-seg-wrap">
            <span className={`or-bc-seg${last ? " last" : ""}`}>{seg}</span>
            {!last && <ChevronRight size={10} className="or-bc-sep" />}
          </span>
        );
      })}
      {symbol && (
        <>
          <ChevronRight size={10} className="or-bc-sep" />
          <span className="or-bc-symbol">{symbol}</span>
        </>
      )}
    </div>
  );
}
