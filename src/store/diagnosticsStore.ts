import { create } from "zustand";

// Monaco MarkerSeverity: Hint=1, Info=2, Warning=4, Error=8.
export const SEVERITY_ERROR = 8;
export const SEVERITY_WARNING = 4;

export type Diagnostic = {
  /** Filesystem-ish path from the model URI (`monaco.Uri.path`). */
  path: string;
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  source?: string;
  code?: string;
};

type DiagnosticsState = {
  markers: Diagnostic[];
  errorCount: number;
  warningCount: number;
  setMarkers: (m: Diagnostic[]) => void;
};

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  markers: [],
  errorCount: 0,
  warningCount: 0,
  setMarkers: (markers) =>
    set({
      markers,
      errorCount: markers.filter((m) => m.severity === SEVERITY_ERROR).length,
      warningCount: markers.filter((m) => m.severity === SEVERITY_WARNING)
        .length,
    }),
}));
