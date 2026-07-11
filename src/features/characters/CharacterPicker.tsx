import { useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useGLTF } from "@react-three/drei";
import { Upload, Trash2, Check } from "lucide-react";
import { useCharacterStore } from "@/store/characterStore";
import { BUILTIN_CHARACTERS, colorOf, type Character } from "./catalog";
import { CharacterCanvas } from "./CharacterCanvas";
import { log } from "@/lib/log";

// Warm the cache so the grid's models start downloading on first open.
for (const c of BUILTIN_CHARACTERS) useGLTF.preload(c.url);

export function CharacterPicker() {
  const selectedId = useCharacterStore((s) => s.selectedId);
  const custom = useCharacterStore((s) => s.custom);
  const setSelected = useCharacterStore((s) => s.setSelected);
  const addCustomFromPath = useCharacterStore((s) => s.addCustomFromPath);
  const removeCustom = useCharacterStore((s) => s.removeCustom);
  const urlFor = useCharacterStore((s) => s.urlFor);
  const list = useMemo<Character[]>(
    () => [...BUILTIN_CHARACTERS, ...custom],
    [custom],
  );

  // Bump per card so re-selecting replays the animation.
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

  return (
    <>
      <h2 className="ot-settings-h2">Characters</h2>
      <p className="ot-settings-p">
        Pick your terminal companion. Models render live — click one to select
        it and watch it move. Upload your own .glb / .gltf to add it here.
      </p>

      <div className="ot-char-grid">
        {list.map((c) => {
          const active = c.id === selectedId;
          const accent = colorOf(c);
          return (
            <button
              type="button"
              key={c.id}
              className={`ot-char-card${active ? " active" : ""}`}
              style={{ "--char-accent": accent } as React.CSSProperties}
              onClick={() => choose(c.id)}
            >
              <CharacterCanvas
                url={urlFor(c)}
                color={accent}
                selectSignal={signals[c.id] ?? 0}
              />
              <div className="ot-char-meta">
                <span className="ot-char-name">{c.name}</span>
                {!c.custom && <span className="ot-char-blurb">{c.blurb}</span>}
              </div>
              {active && (
                <span className="ot-char-check" aria-label="selected">
                  <Check size={12} />
                </span>
              )}
              {c.custom && (
                <span
                  className="ot-char-remove"
                  role="button"
                  tabIndex={0}
                  aria-label="remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeCustom(c.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      void removeCustom(c.id);
                    }
                  }}
                >
                  <Trash2 size={12} />
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          className="ot-char-card ot-char-upload"
          disabled={busy}
          onClick={() => void upload()}
        >
          <div className="ot-char-upload-inner">
            <Upload size={22} />
            <span>{busy ? "Adding…" : "Upload model"}</span>
            <span className="ot-char-upload-hint">.glb / .gltf</span>
          </div>
        </button>
      </div>

      {custom.length > 0 && (
        <div className="ot-settings-msg mono">
          {custom.length} custom {custom.length === 1 ? "model" : "models"}
        </div>
      )}
      {msg && <div className="ot-settings-msg">{msg}</div>}
    </>
  );
}
