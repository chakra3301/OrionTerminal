import { useEffect, useId, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, FileUp, Trash2 } from "lucide-react";
import { ulid } from "ulid";
import { ModelSelect } from "@/components/ModelSelect";
import { confirmAction } from "@/components/ConfirmModal";
import { runSurfaceAnalysis } from "@/features/agents/textCall";
import { useFileDropZone } from "@/lib/fileDrop";
import { ipc } from "@/lib/ipc";
import { useThemeStore } from "@/store/themeStore";
import { ThemeSphere } from "./ThemeSphere";
import { MAX_CUSTOM_THEMES, parseThemeReply, themePrompt, themeWarnings, validateMarkdown, type CustomTheme } from "./themeDesign";
import "./customThemes.css";

type Phase = "reading" | "generating" | "saving" | "removing" | null;
export function CustomThemeSection() {
  const themes = useThemeStore(s => s.customThemes);
  const active = useThemeStore(s => s.theme);
  const preview = useThemeStore(s => s.previewTheme);
  const loadError = useThemeStore(s => s.customLoadError);
  const saving = useThemeStore(s => s.customSaving);
  const [source, setSource] = useState<{ name: string; text: string } | null>(null);
  const [draft, setDraft] = useState<CustomTheme | null>(null);
  const [phase, setPhaseState] = useState<Phase>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const zone = useRef<HTMLButtonElement>(null);
  const zoneId = useId();
  const alive = useRef(false), sequence = useRef(0), busy = useRef<Phase>(null);
  const controller = useRef<AbortController | null>(null);
  const draftId = useRef<CustomTheme["id"] | null>(null);
  const setPhase = (value: Phase) => { busy.current = value; setPhaseState(value); };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; sequence.current++; controller.current?.abort(); if (draftId.current) useThemeStore.getState().cancelPreview(draftId.current); };
  }, []);
  useEffect(() => {
    if (!preview || preview.id !== draft?.id) return;
    const timer = setTimeout(() => useThemeStore.getState().cancelPreview(preview.id), 30_000);
    return () => clearTimeout(timer);
  }, [preview, draft?.id]);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const importPath = async (paths?: string[]) => {
    if (busy.current) return;
    const seq = ++sequence.current;
    setPhase("reading"); setError(null);
    try {
      const picked = paths ?? await open({ multiple: false, filters: [{ name: "Design Markdown", extensions: ["md", "markdown"] }] });
      if (!alive.current || seq !== sequence.current || !picked) return;
      const files = Array.isArray(picked) ? picked : [picked];
      if (files.length !== 1 || !/\.(md|markdown)$/i.test(files[0]!)) throw new Error("Drop one .md or .markdown design file.");
      const text = validateMarkdown(await ipc.themeReadMarkdown(files[0]!));
      if (!alive.current || seq !== sequence.current) return;
      if (draftId.current) useThemeStore.getState().cancelPreview(draftId.current);
      draftId.current = null; setDraft(null);
      setSource({ name: files[0]!.split(/[\\/]/).pop()!, text });
    } catch (e) { if (alive.current && seq === sequence.current) fail(e); }
    finally { if (alive.current && seq === sequence.current) setPhase(null); }
  };
  useFileDropZone(zone, `appearance-design-${zoneId}`, event => {
    setDragging(event.type === "enter");
    if (event.type === "drop") void importPath(event.paths);
  });
  const generate = async () => {
    if (!source || busy.current || loadError || themes.length >= MAX_CUSTOM_THEMES) return;
    const seq = ++sequence.current, abort = new AbortController();
    controller.current = abort;
    if (draftId.current) useThemeStore.getState().cancelPreview(draftId.current);
    setPhase("generating"); setError(null);
    try {
      const reply = await runSurfaceAnalysis(themePrompt(source.text), "theme", { signal: abort.signal });
      if (!alive.current || seq !== sequence.current || abort.signal.aborted) return;
      const next: CustomTheme = { ...parseThemeReply(reply), id: `custom:${ulid()}` };
      draftId.current = next.id; setDraft(next);
    } catch (e) { if (alive.current && seq === sequence.current && !abort.signal.aborted) fail(e); }
    finally { if (alive.current && seq === sequence.current) { controller.current = null; setPhase(null); } }
  };
  const stop = () => { sequence.current++; controller.current?.abort(); controller.current = null; setPhase(null); };
  const save = async () => {
    if (!draft || busy.current) return;
    const seq = ++sequence.current;
    setPhase("saving"); setError(null);
    const selectionRevision = useThemeStore.getState().selectionRevision;
    try {
      await useThemeStore.getState().saveCustom(draft);
      if (!alive.current || seq !== sequence.current) return;
      if (useThemeStore.getState().selectionRevision === selectionRevision) useThemeStore.getState().set(draft.id);
      draftId.current = null; setDraft(null);
    } catch (e) { if (alive.current && seq === sequence.current) fail(e); }
    finally { if (alive.current && seq === sequence.current) setPhase(null); }
  };
  const remove = async (theme: CustomTheme) => {
    if (busy.current) return;
    const seq = ++sequence.current;
    setPhase("removing"); setError(null);
    try {
      const confirmed = await confirmAction({ title: `Remove ${theme.name}?`, body: "This removes the saved theme, not your design Markdown. If active, Orion returns to Liquid.", confirmLabel: "Remove theme", danger: true });
      if (confirmed && alive.current && seq === sequence.current) await useThemeStore.getState().removeCustom(theme.id);
    } catch (e) { if (alive.current && seq === sequence.current) fail(e); }
    finally { if (alive.current && seq === sequence.current) setPhase(null); }
  };
  return <section className="ot-custom-themes" aria-labelledby="custom-theme-title">
    <div className="cp-setting-heading"><h3 id="custom-theme-title">Create from a design document</h3><span>{themes.length}/{MAX_CUSTOM_THEMES} saved</span></div>
    <p>Bring your own palette, corners and material direction. Orion keeps its layout, fonts and your content intact.</p>
    {loadError && <p role="alert">{loadError}</p>}
    <button ref={zone} type="button" className={`ot-theme-drop${dragging ? " dragging" : ""}`} onClick={() => void importPath()} disabled={!!phase || saving}>
      <FileUp size={22} aria-hidden="true" /><strong>{phase === "reading" ? "Reading design…" : source?.name ?? "Drop a design .md here"}</strong><span>or choose a file · UTF-8 · up to 64 KiB</span>
    </button>
    {source && <details className="ot-theme-source"><summary>Review Markdown before sending</summary><pre>{source.text}</pre></details>}
    <div className="ot-theme-generate"><ModelSelect surface="theme" disabled={!!phase || saving} />
      {phase === "generating" ? <button type="button" className="ot-settings-btn" onClick={stop}>Cancel generation</button> : <button type="button" className="ot-settings-btn primary" disabled={!source || !!phase || saving || !!loadError || themes.length >= MAX_CUSTOM_THEMES} onClick={() => void generate()}>Generate theme</button>}
    </div>
    <p className="ot-theme-consent">Generate sends only this document’s text to the selected AI. Linked files are not opened. No tools or arbitrary CSS run. Source Markdown is not saved with the theme.</p>
    {phase && <p role="status">{phase === "generating" ? "Interpreting your design… This can take up to three minutes." : phase === "saving" ? "Saving theme…" : phase === "reading" ? "Reading Markdown…" : "Removing theme…"}</p>}
    {error && <p role="alert">{error}</p>}
    {draft && <div className="ot-theme-draft">
      <div><h4>{draft.name}</h4><p>{draft.description}</p><small>{draft.mode} · {draft.finish} · {draft.depth} depth</small></div>
      <div className="ot-theme-palette" aria-label="Generated palette">{Object.entries(draft.colors).map(([name, color]) => <span key={name} title={`${name}: ${color}`} style={{ backgroundColor: color }} />)}</div>
      {themeWarnings(draft).map(warning => <p key={warning} className="ot-theme-warning">{warning}</p>)}
      <div className="ot-theme-actions">
        <button type="button" className="ot-settings-btn" disabled={!!phase || saving} onClick={() => preview?.id === draft.id ? useThemeStore.getState().cancelPreview(draft.id) : useThemeStore.getState().preview(draft)}>{preview?.id === draft.id ? "Revert preview" : "Try on desktop"}</button>
        <button type="button" className="ot-settings-btn primary" disabled={!!phase || saving || !!loadError} onClick={() => void save()}>Save and use</button>
      </div>
      {preview?.id === draft.id && <p role="status">Temporary preview · automatically reverts after 30 seconds or when you leave Appearance.</p>}
    </div>}
    {themes.length > 0 && <div className="ot-theme-group"><h4 className="ot-theme-group-title">Your themes</h4><div className="ot-custom-theme-list">{themes.map(theme => <div className="ot-custom-theme-row" key={theme.id}>
      <button className={`ot-theme-card${active === theme.id ? " active" : ""}`} type="button" aria-pressed={active === theme.id} disabled={!!phase || saving} onClick={() => useThemeStore.getState().set(theme.id)}><ThemeSphere theme={theme.id} /><span className="ot-theme-meta"><span className="ot-theme-name">{theme.name}</span><span className="ot-theme-blurb">{theme.description}</span><span className="ot-theme-blurb">{theme.mode} · {theme.finish}</span></span><span className="ot-theme-selected" aria-hidden="true">{active === theme.id && <Check size={14} />}</span></button>
      <button type="button" className="ot-settings-btn" disabled={!!phase || saving || !!loadError} onClick={() => void remove(theme)} aria-label={`Remove ${theme.name}`} title={`Remove ${theme.name}`}><Trash2 size={14} /></button>
    </div>)}</div></div>}
  </section>;
}
