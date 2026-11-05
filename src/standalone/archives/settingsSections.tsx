/** Archives 47's own Settings sections: General, Library, Shortcuts, About. */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { appConfigDir } from "@tauri-apps/api/path";
import { Check, Download, FolderOpen, Upload } from "lucide-react";
import { registry, type Command } from "@/commands/registry";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { toast } from "@/store/toastStore";
import { useNotesStore } from "@/store/notesStore";
import { THEMES, useThemeStore } from "@/store/themeStore";
import { ThemeSphere } from "@/features/settings/ThemeSphere";
import { exportArchiveBackup, importMarkdownFiles } from "@/apps/archives/exportImport";
import { APP_NAME, APP_TAGLINE } from "./brand";
import { formatHotkey } from "./hotkeyLabel";
import { version as APP_VERSION } from "../../../package.json";

function useDataDir(): string | null {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    appConfigDir()
      .then((d) => setDir(d.replace(/\/$/, "")))
      .catch((e) => log.warn("appConfigDir failed", e));
  }, []);
  return dir;
}

function Toggle({ on, label, blurb, onChange }: { on: boolean; label: string; blurb: string; onChange: (on: boolean) => void }) {
  return (
    <div className="ot-settings-toggle">
      <div className="ot-settings-toggle-meta">
        <div className="ot-settings-toggle-name">{label}</div>
        <div className="ot-settings-toggle-blurb">{blurb}</div>
      </div>
      <button type="button" className={`ot-switch${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
    </div>
  );
}

export function GeneralSection() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.set);
  const reduceGlass = useThemeStore((s) => s.reduceGlass);
  const setReduceGlass = useThemeStore((s) => s.setReduceGlass);
  return (
    <>
      <h2 className="ot-settings-h2">Appearance</h2>
      <p className="ot-settings-p">The theme changes surfaces and type. Archives keeps its neon green accent.</p>
      <div className="ot-theme-picker">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ot-theme-card${theme === t.id ? " active" : ""}`}
            data-theme-swatch={t.id}
            aria-pressed={theme === t.id}
            onClick={() => setTheme(t.id)}
          >
            <ThemeSphere theme={t.id} />
            <span className="ot-theme-meta">
              <span className="ot-theme-name">{t.label}</span>
              <span className="ot-theme-blurb">{t.blurb}</span>
            </span>
            <span className="ot-theme-selected" aria-hidden="true">{theme === t.id && <Check size={14} />}</span>
          </button>
        ))}
      </div>
      <Toggle
        on={reduceGlass}
        label="Reduce transparency"
        blurb="Turns off glass and reduces blur. Lighter on the GPU."
        onChange={setReduceGlass}
      />
    </>
  );
}

export function LibrarySection() {
  const dir = useDataDir();
  const [busy, setBusy] = useState(false);
  const run = async (label: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      log.error(`${label} failed`, e);
      toast.error(`${label} failed`, { body: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const exportAll = () =>
    run("Export", async () => {
      await useNotesStore.getState().load();
      await exportArchiveBackup([...useNotesStore.getState().notes.values()]);
    });
  const importMd = () =>
    run("Import", async () => {
      const ids = await importMarkdownFiles("note");
      if (ids.length) toast.success(`Imported ${ids.length} note${ids.length === 1 ? "" : "s"}`);
    });
  const reveal = (path: string) => run("Show in Finder", () => ipc.revealInOs(path));

  return (
    <>
      <h2 className="ot-settings-h2">Library</h2>
      <p className="ot-settings-p">
        Everything in {APP_NAME} lives on this Mac in its own library. A backup copy of the database is made each time the app starts.
      </p>
      <dl className="ot-settings-meta">
        <dt>Library</dt>
        <dd className="mono">{dir ?? "…"}</dd>
        <dt>Database</dt>
        <dd className="mono">↳ /archives.db</dd>
        <dt>Media</dt>
        <dd className="mono">↳ /assets/</dd>
        <dt>Backups</dt>
        <dd className="mono">↳ /backups/</dd>
      </dl>
      <div className="a47-settings-actions">
        <button type="button" className="ot-settings-btn" disabled={!dir || busy} onClick={() => dir && reveal(`${dir}/archives.db`)}>
          <FolderOpen size={13} /> Show in Finder
        </button>
        <button type="button" className="ot-settings-btn" disabled={busy} onClick={exportAll}>
          <Download size={13} /> Export all notes…
        </button>
        <button type="button" className="ot-settings-btn" disabled={busy} onClick={importMd}>
          <Upload size={13} /> Import Markdown…
        </button>
      </div>
      <p className="ot-settings-help">Export saves every note, journal entry and project as one JSON file. Import adds .md or .txt files as new notes.</p>
    </>
  );
}

function useCommands(): Command[] {
  return useSyncExternalStore((cb) => registry.subscribe(cb), () => registry.list(), () => registry.list());
}

export function ShortcutsSection() {
  const commands = useCommands();
  const grouped = useMemo(() => {
    const m = new Map<string, Command[]>();
    for (const c of commands) {
      if (!c.hotkey) continue;
      const g = c.group ?? "Other";
      m.set(g, [...(m.get(g) ?? []), c]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [commands]);
  return (
    <>
      <h2 className="ot-settings-h2">Keyboard shortcuts</h2>
      <p className="ot-settings-p">
        Press <span className="kbd">⌘K</span> to search notes and run any command.
      </p>
      <div className="ot-settings-shortcuts">
        {grouped.map(([group, cmds]) => (
          <div key={group} className="ot-settings-shortcut-group">
            <div className="group-label">{group}</div>
            {cmds.map((c) => (
              <div className="row" key={c.id}>
                <span className="label">{c.label}</span>
                <span className="hk">{formatHotkey(c.hotkey ?? "")}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

export function AboutSection() {
  const dir = useDataDir();
  return (
    <>
      <h2 className="ot-settings-h2">{APP_NAME}</h2>
      <p className="ot-settings-p">{APP_TAGLINE}. Notes, journal, projects, media, mood boards, Learn and RepoLens, with an AI assistant that knows your archive.</p>
      <dl className="ot-settings-meta">
        <dt>Version</dt>
        <dd>{APP_VERSION} · Alpha test</dd>
        <dt>Library</dt>
        <dd className="mono">{dir ?? "…"}</dd>
        <dt>Keys</dt>
        <dd>macOS Keychain, under {APP_NAME}</dd>
      </dl>
      <p className="ot-settings-help">This is an alpha build. Expect rough edges, and export a backup of anything important.</p>
      <p className="ot-settings-help">
        Includes the Website Ripper scaffold © JCodesMore, MIT license (github.com/JCodesMore/ai-website-cloner-template).
      </p>
    </>
  );
}
