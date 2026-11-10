import type { CSSProperties } from "react";
import seti from "@/assets/fileIcons/setiMap.json";
import "@/assets/fileIcons/fileIcons.css";

type Glyph = [code: number, dark: string, light: string];
type SetiMap = {
  glyphs: Record<string, Glyph>;
  file: string;
  names: Record<string, string>;
  exts: Record<string, string>;
  patterns: [string, string][];
};

const map = seti as unknown as SetiMap;

const patterns = map.patterns.map(([glob, id]) => {
  const rx = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return [new RegExp(`^${rx}$`), id] as const;
});

/**
 * VS Code's icon-theme lookup, which Cursor uses: exact file name, then the
 * longest matching extension (`a.d.ts` tries `d.ts`, then `ts`), then the
 * language's file-name patterns, then the default file icon.
 */
export function fileIconId(path: string): string {
  const name = (path.split(/[\\/]/).pop() ?? path).toLowerCase();
  const byName = map.names[name];
  if (byName) return byName;
  for (let i = name.indexOf("."); i !== -1; i = name.indexOf(".", i + 1)) {
    const id = map.exts[name.slice(i + 1)];
    if (id) return id;
  }
  for (const [rx, id] of patterns) if (rx.test(name)) return id;
  return map.file;
}

/** The Seti glyph Cursor shows next to a file, in its own color (light themes use Seti's light palette). */
export function FileTypeIcon({ path, className }: { path: string; className?: string }) {
  const g = map.glyphs[fileIconId(path)] ?? map.glyphs[map.file]!;
  const style = { "--fi-dark": g[1], "--fi-light": g[2] } as CSSProperties;
  return (
    <span className={`ot-file-icon${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      {String.fromCharCode(g[0])}
    </span>
  );
}
