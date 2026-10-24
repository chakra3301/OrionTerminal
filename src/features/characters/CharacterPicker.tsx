import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Upload, Trash2, Check } from "lucide-react";
import { useCharacterStore } from "@/store/characterStore";
import { BUILTIN_CHARACTERS, builtinCharacter, colorOf, type BuiltinCharacter, type Character } from "./catalog";
import { CharacterCanvas } from "./CharacterCanvas";
import { log } from "@/lib/log";

type CardRegion = { id: string; type: "type" | "wipe" | "flick"; chars: number; delay: number; dur: number; x: number; y: number; w: number; h: number };
type CardSpec = { w: number; h: number; regions: CardRegion[]; leds: [number, number][] };

const specs = new Map<string, Promise<CardSpec | null>>();
function cardSpec(url: string) {
  if (!specs.has(url)) specs.set(url, fetch(url).then((r) => (r.ok ? r.json() as Promise<CardSpec> : null)).catch(() => null));
  return specs.get(url)!;
}

const CHAR_STEP = 0.028;

/** The site's companion card: the clean plate, then each text block revealed from the full art. */
function CompanionCard({ c, active, signal }: { c: BuiltinCharacter; active: boolean; signal: number }) {
  const [spec, setSpec] = useState<CardSpec | null>(null);
  useEffect(() => {
    let live = true;
    void cardSpec(c.card.spec).then((s) => { if (live) setSpec(s); });
    return () => { live = false; };
  }, [c.card.spec]);
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className="ot-ccard" style={{ aspectRatio: spec ? `${spec.w} / ${spec.h}` : "1080 / 1287" }}>
      {/* Remount on select so the type-in replays, like the site does on arrival. */}
      <div className={`ot-ccard-art${reduced || !spec ? " is-still" : ""}`} key={signal}>
        <img className="ot-ccard-base" src={spec && !reduced ? c.card.clean : c.card.art} alt="" draggable={false} />
        {spec && !reduced && spec.regions.map((r) => {
          const n = Math.max(1, r.chars || 1);
          return (
            <i
              key={r.id}
              className={`ot-ccard-txt is-${r.type}`}
              style={{
                left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`,
                backgroundImage: `url(${c.card.art})`,
                backgroundSize: `${10000 / r.w}% ${10000 / r.h}%`,
                backgroundPosition: `${r.w >= 100 ? 0 : (r.x / (100 - r.w)) * 100}% ${r.h >= 100 ? 0 : (r.y / (100 - r.h)) * 100}%`,
                "--d": `${r.delay + 0.1}s`, "--n": n, "--t": `${r.type === "wipe" ? r.dur || 0.9 : n * CHAR_STEP}s`,
              } as React.CSSProperties}
            />
          );
        })}
        {active && spec?.leds.map(([x, y]) => <b key={`${x}-${y}`} className="ot-ccard-led" style={{ left: `${x}%`, top: `${y}%` }} />)}
      </div>
    </div>
  );
}

export function CharacterPicker() {
  const selectedId = useCharacterStore((s) => s.selectedId);
  const custom = useCharacterStore((s) => s.custom);
  const setSelected = useCharacterStore((s) => s.setSelected);
  const addCustomFromPath = useCharacterStore((s) => s.addCustomFromPath);
  const removeCustom = useCharacterStore((s) => s.removeCustom);
  const urlFor = useCharacterStore((s) => s.urlFor);
  const showInApps = useCharacterStore((s) => s.showInApps);
  const setShowInApps = useCharacterStore((s) => s.setShowInApps);
  const selected = useMemo<Character | undefined>(
    () => builtinCharacter(selectedId) ?? custom.find((c) => c.id === selectedId),
    [selectedId, custom],
  );

  const [signals, setSignals] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const choose = (id: string) => {
    setSelected(id);
    setSignals((s) => ({ ...s, [id]: (s[id] ?? 0) + 1 }));
  };

  const upload = async () => {
    setMsg(null);
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "3D model", extensions: ["glb", "gltf"] }],
      });
      if (!picked || typeof picked !== "string") return;
      setBusy(true);
      await addCustomFromPath(picked);
    } catch (e) {
      log.error("character upload failed", e);
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const accent = selected ? colorOf(selected) : "#00e0ff";
  const builtin = selected && !selected.custom ? selected : undefined;

  return (
    <div className="ot-companions" style={{ "--char-accent": accent } as React.CSSProperties}>
      <h2 className="ot-settings-h2">Companions</h2>

      <div className="ot-companions-layout">
        <div className="ot-ccard-grid" role="radiogroup" aria-label="Companion">
          {BUILTIN_CHARACTERS.map((c) => {
            const active = c.id === selectedId;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${c.name}, ${c.blurb}`}
                key={c.id}
                className={`ot-ccard-pick${active ? " active" : ""}`}
                style={{ "--char-accent": c.color } as React.CSSProperties}
                onClick={() => choose(c.id)}
              >
                <CompanionCard c={c} active={active} signal={signals[c.id] ?? 0} />
              </button>
            );
          })}
        </div>

        <aside className="ot-companion-stage" aria-live="polite">
          {selected && (
            <>
              <CharacterCanvas
                key={selected.id}
                className="ot-companion-stage-canvas"
                url={urlFor(selected)}
                companion={builtin?.id}
                color={accent}
                selectSignal={signals[selected.id] ?? 0}
              />
              <div className="ot-companion-stage-meta">
                <span className="ot-companion-stage-code">{builtin ? `${builtin.code} · Active` : "Custom · Active"}</span>
                <span className="ot-companion-stage-name">{selected.name}</span>
                {builtin && <span className="ot-companion-stage-blurb">{builtin.blurb}</span>}
              </div>
            </>
          )}
        </aside>
      </div>

      <div className="ot-companions-custom">
        <div className="ot-companions-custom-head">
          <span className="ot-companions-label">Your models</span>
          <button type="button" className="ot-prompt-btn" disabled={busy} onClick={() => void upload()}>
            <Upload size={13} />
            {busy ? "Adding…" : "Upload .glb"}
          </button>
        </div>
        {custom.length > 0 && (
          <div className="ot-companions-custom-list">
            {custom.map((c) => {
              const active = c.id === selectedId;
              return (
                <div key={c.id} className={`ot-companions-custom-row${active ? " active" : ""}`}>
                  <button type="button" className="ot-companions-custom-pick" onClick={() => choose(c.id)} aria-pressed={active}>
                    {active && <Check size={12} />}
                    <span>{c.name}</span>
                  </button>
                  <button type="button" className="ot-companions-custom-remove" aria-label={`Remove ${c.name}`} onClick={() => void removeCustom(c.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {msg && <div className="ot-settings-msg">{msg}</div>}
      </div>

      <div className="ot-settings-toggle">
        <div className="ot-settings-toggle-meta">
          <div className="ot-settings-toggle-name">Show in apps</div>
          <div className="ot-settings-toggle-blurb">
            Keeps your companion on screen while an app is open. Off by default because she costs frame rate in busy apps like XDesign; turn on if your Mac has headroom.
          </div>
        </div>
        <button
          type="button"
          className={`ot-switch${showInApps ? " on" : ""}`}
          role="switch"
          aria-checked={showInApps}
          aria-label="Show companion in apps"
          onClick={() => setShowInApps(!showInApps)}
        />
      </div>
    </div>
  );
}
