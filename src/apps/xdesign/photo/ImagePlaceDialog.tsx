import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useXDProjects } from "../projectsStore";
import { useDesignDialog } from "../useDesignDialog";
import { useXDesign } from "../store";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { PhotoDialog } from "./photoDialog";

function context() {
  const photo = usePhotoWorkspace.getState();
  return JSON.stringify([photo.projectId, photo.documentId, photo.shapeId, photo.source, photo.stateVersion,
    photo.state?.activeLayer, photo.documentId && useXDesign.getState().photoDocuments[photo.documentId]?.version]);
}

export function ImagePlaceDialog({ linked, close }: { linked: boolean; close: () => void }) {
  const busy = usePhotoWorkspace(state => state.busy);
  const documentId = usePhotoWorkspace(state => state.documentId);
  const storedVersion = useXDesign(state => documentId ? state.photoDocuments[documentId]?.version : undefined);
  const available = usePhotoWorkspace(state => state.state?.features?.placeImages === true);
  const currentContext = usePhotoWorkspace(context);
  const project = useXDProjects(state => state.activeId);
  const transitioning = useXDProjects(state => state.transitioning);
  const initial = useRef(context());
  const initialVersion = useRef(storedVersion);
  const mounted = useRef(false);
  const selecting = useRef(false);
  const [picking, setPicking] = useState(false);
  const [path, setPath] = useState("");
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState("");
  const [centered, setCentered] = useState(true);
  const [opening] = useState<[number, number]>(() => {
    const state = usePhotoWorkspace.getState().state;
    return [(state?.width ?? 0) / 2, (state?.height ?? 0) / 2];
  });
  const [center, setCenter] = useState(opening);
  const [error, setError] = useState("");
  const title = linked ? "Place Linked" : "Place Embedded";
  const current = () => mounted.current && initial.current === context()
    && useXDProjects.getState().activeId === usePhotoWorkspace.getState().projectId
    && !useXDProjects.getState().transitioning && !usePhotoWorkspace.getState().busy
    && usePhotoWorkspace.getState().state?.features?.placeImages === true;
  const stale = initial.current !== currentContext || initialVersion.current !== storedVersion || !available || project !== usePhotoWorkspace.getState().projectId || transitioning;
  const locked = busy || picking || stale;
  const valid = (!scale || Number.isFinite(Number(scale)) && Number(scale) > 0) && (centered || center.every(Number.isFinite));
  const dialog = useDesignDialog<HTMLFormElement>(close, busy || picking);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const choose = async () => {
    if (selecting.current || !current()) return;
    selecting.current = true; setPicking(true); setError("");
    try {
      const selected = await open({ multiple: false });
      if (current() && typeof selected === "string") setPath(selected);
    } catch (error) {
      if (current()) setError(String(error));
    } finally {
      selecting.current = false;
      if (mounted.current) setPicking(false);
    }
  };
  const apply = async () => {
    if (selecting.current || !current() || !path || !valid) return;
    setError("");
    try {
      await runPhotoCommand(linked ? "file.placeLinked" : "file.placeEmbedded", {
        path, fit, ...(scale ? { scale: Number(scale) } : {}), ...(centered ? {} : { center }),
      });
      if (mounted.current) close();
    } catch (error) {
      if (mounted.current) setError(String(error));
    }
  };
  return <PhotoDialog dialog={dialog} title={title} busy={busy || picking} okDisabled={locked || !path || !valid} close={close} reset={() => { setPath(""); setFit(true); setScale(""); setCentered(true); setCenter(opening); setError(""); }} onSubmit={event => { event.preventDefault(); void apply(); }}>
    <div className="xd-ps-dialog-grid">
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Source File:</span><button type="button" disabled={locked} onClick={() => { void choose(); }}>{picking ? "Choosing…" : path.split(/[\\/]/).at(-1) || "Choose image…"}</button></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Scale:</span><input aria-label="Placement scale (%)" type="number" step="any" min="0.01" placeholder="Automatic" value={scale} disabled={locked} onChange={event => setScale(event.target.value)}/><span className="xd-ps-dialog-unit">%</span></label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input aria-label="Fit placed image" type="checkbox" checked={fit} disabled={locked || !!scale} onChange={event => setFit(event.target.checked)}/>Fit Large Images to Canvas</label></div>
      <div className="xd-ps-dialog-row"><label className="xd-ps-dialog-check"><input aria-label="Center placed image" type="checkbox" checked={centered} disabled={locked} onChange={event => setCentered(event.target.checked)}/>Center on Canvas</label></div>
      {(["X", "Y"] as const).map((axis, index) => <div key={axis} className="xd-ps-dialog-row"><label className="xd-ps-dialog-field"><span>Center {axis}:</span><input aria-label={`Placement center ${axis}`} type="number" step="any" required={!centered} disabled={locked || centered} value={Number.isFinite(center[index]) ? center[index] : ""} onChange={event => setCenter(previous => index === 0 ? [event.target.valueAsNumber, previous[1]] : [previous[0], event.target.valueAsNumber])}/><span className="xd-ps-dialog-unit">px</span></label></div>)}
    </div>
    {stale && <p role="alert">The image changed. Close this dialog and place the file again.</p>}
    {error && <p role="alert">{error}</p>}
  </PhotoDialog>;
}
