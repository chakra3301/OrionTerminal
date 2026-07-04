/**
 * FX scene editor — layers panel · WebGL viewport · inspector. Replaces the
 * SVG design shell when the active XDesign project is kind "fx".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Play,
  Pause,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useFxStore } from "./fxStore";
import { createCompositor, type FxCompositor } from "./compositor";
import { resolveDpi, type FxLayer, type FxParamSpec } from "./fxModel";
import { fxEffect, FX_EFFECTS } from "./fxRegistry";

// ── Viewport ──────────────────────────────────────────────────────────────

function FxViewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const sceneW = useFxStore((s) => s.scene.width);
  const sceneH = useFxStore((s) => s.scene.height);
  const [glLost, setGlLost] = useState(false);

  // Letterbox the scene into the available stage space.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const pad = 28;
      const availW = Math.max(0, wrap.clientWidth - pad * 2);
      const availH = Math.max(0, wrap.clientHeight - pad * 2);
      if (availW === 0 || availH === 0) return;
      const scale = Math.min(availW / sceneW, availH / sceneH, 1);
      setFit({ w: Math.round(sceneW * scale), h: Math.round(sceneH * scale) });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [sceneW, sceneH]);

  // Render loop. Reads the store imperatively each frame — React re-renders
  // are reserved for layout changes, not animation.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let compositor: FxCompositor | null = createCompositor(canvas);
    if (!compositor) {
      setGlLost(true);
      return;
    }

    let raf = 0;
    let last = performance.now();
    let sceneTime = 0;
    let accum = 0;
    let visible = true;
    const mouse: [number, number] = [0.5, 0.5];
    const mouseTarget: [number, number] = [0.5, 0.5];

    const io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? true;
    });
    io.observe(canvas);

    const onPointer = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      mouseTarget[0] = (e.clientX - r.left) / r.width;
      mouseTarget[1] = 1 - (e.clientY - r.top) / r.height;
    };
    canvas.addEventListener("pointermove", onPointer);

    const onCtxLost = (e: Event) => {
      e.preventDefault();
      setGlLost(true);
    };
    const onCtxRestored = () => {
      compositor?.dispose();
      compositor = createCompositor(canvas);
      setGlLost(compositor === null);
    };
    canvas.addEventListener("webglcontextlost", onCtxLost);
    canvas.addEventListener("webglcontextrestored", onCtxRestored);

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!visible || document.hidden || !compositor) return;

      const { scene, playing } = useFxStore.getState();

      // FPS cap: accumulate and only draw when a frame interval elapsed.
      if (scene.fps > 0) {
        accum += dt;
        const interval = 1 / scene.fps;
        if (accum < interval) return;
        accum %= interval;
      }

      if (playing) sceneTime += dt;
      const k = 1 - Math.exp(-dt * 8);
      mouse[0] += (mouseTarget[0] - mouse[0]) * k;
      mouse[1] += (mouseTarget[1] - mouse[1]) * k;

      const dpi = resolveDpi(scene.dpi);
      compositor.render(
        scene,
        { time: sceneTime, mouse },
        scene.width * dpi,
        scene.height * dpi,
      );
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("webglcontextlost", onCtxLost);
      canvas.removeEventListener("webglcontextrestored", onCtxRestored);
      compositor?.dispose();
    };
  }, []);

  return (
    <div className="xd-fx-viewport" ref={wrapRef}>
      {glLost ? (
        <div className="xd-fx-gl-lost">WebGL2 unavailable</div>
      ) : (
        <canvas
          ref={canvasRef}
          className="xd-fx-canvas"
          style={{ width: fit.w || undefined, height: fit.h || undefined }}
        />
      )}
    </div>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────

function FxToolbar() {
  const scene = useFxStore((s) => s.scene);
  const playing = useFxStore((s) => s.playing);
  const patchScene = useFxStore((s) => s.patchScene);

  const dim = (v: string, fallback: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 16 && n <= 4096 ? n : fallback;
  };

  return (
    <div className="xd-fx-toolbar">
      <button
        type="button"
        className="xd-fx-play"
        onClick={() => useFxStore.getState().setPlaying(!playing)}
        title={playing ? "Pause" : "Play"}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <span className="xd-fx-toolbar-group">
        <input
          className="xd-fx-dim"
          type="number"
          value={scene.width}
          onChange={(e) => patchScene({ width: dim(e.target.value, scene.width) })}
          aria-label="Scene width"
        />
        <span className="xd-fx-dim-x">×</span>
        <input
          className="xd-fx-dim"
          type="number"
          value={scene.height}
          onChange={(e) => patchScene({ height: dim(e.target.value, scene.height) })}
          aria-label="Scene height"
        />
      </span>
      <select
        className="xd-fx-select"
        value={String(scene.dpi)}
        onChange={(e) => {
          const v = e.target.value;
          patchScene({ dpi: v === "auto" ? "auto" : (Number(v) as 0.5 | 1 | 2) });
        }}
        aria-label="Render DPI"
      >
        <option value="auto">DPI auto</option>
        <option value="0.5">DPI 0.5×</option>
        <option value="1">DPI 1×</option>
        <option value="2">DPI 2×</option>
      </select>
      <select
        className="xd-fx-select"
        value={String(scene.fps)}
        onChange={(e) => patchScene({ fps: Number(e.target.value) as 0 | 30 | 60 })}
        aria-label="FPS cap"
      >
        <option value="0">FPS native</option>
        <option value="60">FPS 60</option>
        <option value="30">FPS 30</option>
      </select>
    </div>
  );
}

// ── Layers panel ──────────────────────────────────────────────────────────

function AddLayerMenu() {
  const [open, setOpen] = useState(false);
  const groups = useMemo(
    () => ({
      generator: FX_EFFECTS.filter((s) => s.category === "generator"),
      effect: FX_EFFECTS.filter((s) => s.category === "effect"),
    }),
    [],
  );

  return (
    <div className="xd-fx-add-wrap">
      <button
        type="button"
        className="xd-fx-add"
        onClick={() => setOpen((v) => !v)}
        title="Add layer"
        aria-label="Add layer"
      >
        <Plus size={14} />
      </button>
      {open && (
        <>
          <div className="xd-home-menu-scrim" onClick={() => setOpen(false)} />
          <div className="xd-fx-add-menu">
            <div className="xd-fx-add-group">Generators</div>
            {groups.generator.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  useFxStore.getState().addLayer(s.id);
                }}
              >
                <Sparkles size={13} />
                <span>
                  <span className="xd-fx-add-label">{s.label}</span>
                  <span className="xd-fx-add-desc">{s.description}</span>
                </span>
              </button>
            ))}
            <div className="xd-fx-add-group">Effects</div>
            {groups.effect.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  useFxStore.getState().addLayer(s.id);
                }}
              >
                <Wand2 size={13} />
                <span>
                  <span className="xd-fx-add-label">{s.label}</span>
                  <span className="xd-fx-add-desc">{s.description}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LayerRow({ layer, isTop, isBottom }: { layer: FxLayer; isTop: boolean; isBottom: boolean }) {
  const selected = useFxStore((s) => s.selectedLayerId === layer.id);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(layer.name);

  const commit = () => {
    setRenaming(false);
    const name = draft.trim();
    if (name && name !== layer.name) {
      useFxStore.getState().patchLayer(layer.id, { name });
    }
  };

  return (
    <div
      className={`xd-fx-layer${selected ? " selected" : ""}${layer.hidden ? " hidden-layer" : ""}`}
      onClick={() => useFxStore.getState().selectLayer(layer.id)}
      onDoubleClick={() => {
        setDraft(layer.name);
        setRenaming(true);
      }}
    >
      <button
        type="button"
        className="xd-fx-layer-eye"
        onClick={(e) => {
          e.stopPropagation();
          useFxStore.getState().patchLayer(layer.id, { hidden: !layer.hidden });
        }}
        aria-label={layer.hidden ? "Show layer" : "Hide layer"}
      >
        {layer.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
      {renaming ? (
        <input
          className="xd-fx-layer-rename"
          value={draft}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <span className="xd-fx-layer-name" title={layer.name}>
          {layer.name}
        </span>
      )}
      <span className="xd-fx-layer-actions">
        <button
          type="button"
          disabled={isTop}
          onClick={(e) => {
            e.stopPropagation();
            useFxStore.getState().moveLayer(layer.id, 1);
          }}
          aria-label="Move layer up"
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          disabled={isBottom}
          onClick={(e) => {
            e.stopPropagation();
            useFxStore.getState().moveLayer(layer.id, -1);
          }}
          aria-label="Move layer down"
        >
          <ChevronDown size={12} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            useFxStore.getState().removeLayer(layer.id);
          }}
          aria-label="Delete layer"
        >
          <Trash2 size={12} />
        </button>
      </span>
    </div>
  );
}

function FxLayersPanel() {
  const layers = useFxStore((s) => s.scene.layers);
  // Stack order: top of list = top of stack = last in render order.
  const display = useMemo(() => [...layers].reverse(), [layers]);

  return (
    <aside className="xd-fx-layers">
      <div className="xd-fx-panel-head">
        <span>Layers</span>
        <AddLayerMenu />
      </div>
      <div className="xd-fx-layer-list">
        {display.length === 0 && (
          <div className="xd-fx-empty">No layers — add a generator to start.</div>
        )}
        {display.map((l, i) => (
          <LayerRow
            key={l.id}
            layer={l}
            isTop={i === 0}
            isBottom={i === display.length - 1}
          />
        ))}
      </div>
    </aside>
  );
}

// ── Inspector ─────────────────────────────────────────────────────────────

function ParamControl({
  layerId,
  spec,
  value,
}: {
  layerId: string;
  spec: FxParamSpec;
  value: number | string | undefined;
}) {
  const set = (v: number | string) =>
    useFxStore.getState().setParam(layerId, spec.key, v);

  if (spec.type === "color") {
    return (
      <label className="xd-fx-field">
        <span>{spec.label}</span>
        <input
          type="color"
          value={typeof value === "string" ? value : spec.default}
          onChange={(e) => set(e.target.value)}
        />
      </label>
    );
  }
  if (spec.type === "select") {
    return (
      <label className="xd-fx-field">
        <span>{spec.label}</span>
        <select
          className="xd-fx-select"
          value={String(typeof value === "number" ? value : spec.default)}
          onChange={(e) => set(Number(e.target.value))}
        >
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const num = typeof value === "number" ? value : spec.default;
  return (
    <label className="xd-fx-field">
      <span>{spec.label}</span>
      <span className="xd-fx-slider-row">
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={num}
          onChange={(e) => set(Number(e.target.value))}
        />
        <input
          className="xd-fx-num"
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={num}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) set(Math.min(spec.max, Math.max(spec.min, v)));
          }}
        />
      </span>
    </label>
  );
}

function FxInspector() {
  const scene = useFxStore((s) => s.scene);
  const selectedId = useFxStore((s) => s.selectedLayerId);
  const layer = scene.layers.find((l) => l.id === selectedId) ?? null;
  const spec = layer ? fxEffect(layer.effectId) : undefined;

  return (
    <aside className="xd-fx-inspector">
      {layer && spec ? (
        <>
          <div className="xd-fx-panel-head">
            <span>{spec.label}</span>
          </div>
          <div className="xd-fx-fields">
            <label className="xd-fx-field">
              <span>Opacity</span>
              <span className="xd-fx-slider-row">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={layer.opacity}
                  onChange={(e) =>
                    useFxStore
                      .getState()
                      .patchLayer(layer.id, { opacity: Number(e.target.value) })
                  }
                />
                <span className="xd-fx-num-label">
                  {Math.round(layer.opacity * 100)}%
                </span>
              </span>
            </label>
            {spec.params.map((p) => (
              <ParamControl
                key={p.key}
                layerId={layer.id}
                spec={p}
                value={layer.params[p.key]}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="xd-fx-panel-head">
            <span>Scene</span>
          </div>
          <div className="xd-fx-fields">
            <label className="xd-fx-field">
              <span>Background</span>
              <input
                type="color"
                value={scene.background}
                onChange={(e) =>
                  useFxStore.getState().patchScene({ background: e.target.value })
                }
              />
            </label>
            <p className="xd-fx-hint">
              Select a layer to edit its parameters.
            </p>
          </div>
        </>
      )}
    </aside>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────

export function FxEditor() {
  return (
    <div className="xd-fx-shell">
      <FxLayersPanel />
      <div className="xd-fx-stage">
        <FxToolbar />
        <FxViewport />
      </div>
      <FxInspector />
    </div>
  );
}
