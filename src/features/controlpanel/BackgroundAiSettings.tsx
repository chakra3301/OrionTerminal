import { useEffect, useState } from "react";
import { useBackgroundAi, type BackgroundAiKind } from "@/store/backgroundAiStore";

const CHOICES: Array<{ kind: BackgroundAiKind; title: string; detail: string }> = [
  { kind: "notes", title: "Automatic note tags", detail: "Sends note titles and excerpts to your Archives AI selection after editing settles." },
  { kind: "assets", title: "Automatic media tags", detail: "Sends imported/generated images, or file metadata, to your Archives AI selection." },
  { kind: "companion", title: "Personalized companion check-ins", detail: "Sends recent note titles, open file names and recent chat context to your ROSIE AI selection. Generic local check-ins remain available when off." },
];

export function BackgroundAiSettings() {
  const permissions = useBackgroundAi((s) => s.permissions);
  const loaded = useBackgroundAi((s) => s.loaded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<{ kind: BackgroundAiKind; on: boolean } | null>(null);
  const load = () => {
    setError("");
    void useBackgroundAi.getState().load().catch(() => setError("Could not load background AI consent. Automatic uploads remain off. Retry loading."));
  };
  useEffect(load, []);
  const change = async (kind: BackgroundAiKind, on: boolean) => {
    if (busy) return;
    setBusy(true); setError(""); setRetry(null);
    try { await useBackgroundAi.getState().setConsent(kind, on); }
    catch { setRetry({ kind, on }); setError("Could not save consent. A failed enable stays off; a failed disable stays off until restart. Retry saving before restarting."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Background AI consent" style={{ margin: "18px 0" }}>
    <div className="cp-eyebrow">Background AI · opt-in</div>
    <p className="cp-card-sub">Off by default. Enabling sends the listed data automatically to the selected provider, using its subscription limits or API billing. Changing your AI selection changes the recipient. Turning off cancels pending work; data already sent cannot be recalled.</p>
    {CHOICES.map(({ kind, title, detail }) => <label className="cp-card" key={kind}>
      <div className="cp-card-main"><div className="cp-card-title">{title}</div><div className="cp-card-sub">{detail}</div></div>
      <input type="checkbox" checked={permissions[kind]} disabled={!loaded || busy} aria-label={title} onChange={(e) => void change(kind, e.target.checked)} />
    </label>)}
    {error && <div role="alert" className="cp-card-sub">{error}{!loaded && <button className="cp-link" onClick={load}>Retry</button>}{retry && <button className="cp-link" disabled={busy} onClick={() => void change(retry.kind, retry.on)}>Retry saving</button>}</div>}
  </section>;
}
