import { useMemo } from "react";
import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import {
  useDiagnosticsStore,
  SEVERITY_ERROR,
  SEVERITY_WARNING,
  type Diagnostic,
} from "@/store/diagnosticsStore";
import { useWorkspace } from "@/components/workspace/workspaceStore";
import { useEditorNavStore } from "@/store/editorNavStore";

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function severityIcon(sev: number) {
  if (sev === SEVERITY_ERROR)
    return <AlertCircle size={12} color="var(--neon-magenta)" />;
  if (sev === SEVERITY_WARNING)
    return <AlertTriangle size={12} color="var(--neon-yellow)" />;
  return <Info size={12} color="var(--neon-cyan)" />;
}

export function OrionProblemsPanel() {
  const markers = useDiagnosticsStore((s) => s.markers);

  const groups = useMemo(() => {
    const byPath = new Map<string, Diagnostic[]>();
    for (const m of markers) {
      const arr = byPath.get(m.path) ?? [];
      arr.push(m);
      byPath.set(m.path, arr);
    }
    return Array.from(byPath.entries())
      .map(([path, items]) => ({
        path,
        items: items.sort(
          (a, b) =>
            b.severity - a.severity || a.startLineNumber - b.startLineNumber,
        ),
      }))
      .sort((a, b) => basename(a.path).localeCompare(basename(b.path)));
  }, [markers]);

  const jump = (path: string, line: number, column: number) => {
    useWorkspace.getState().openTab({ kind: "file", path });
    useEditorNavStore.getState().reveal(path, line, column);
  };

  if (groups.length === 0) {
    return (
      <div className="or-problems or-problems--empty">
        <CheckCircle2 size={18} color="var(--neon-green)" />
        <span>No problems detected</span>
      </div>
    );
  }

  return (
    <div className="or-problems">
      {groups.map((g) => (
        <div key={g.path} className="or-problems-group">
          <div className="or-problems-file">
            {basename(g.path)}
            <span className="or-problems-count">{g.items.length}</span>
          </div>
          {g.items.map((m, i) => (
            <button
              key={i}
              type="button"
              className="or-problems-row"
              onClick={() => jump(m.path, m.startLineNumber, m.startColumn)}
            >
              {severityIcon(m.severity)}
              <span className="or-problems-msg">{m.message}</span>
              <span className="or-problems-loc">
                {m.startLineNumber}:{m.startColumn}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
