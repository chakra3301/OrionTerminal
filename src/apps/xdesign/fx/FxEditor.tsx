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
  RotateCcw,
  Sparkles,
  Wand2,
  Zap,
  X,
  Diamond,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useFxStore } from "./fxStore";
import { createCompositor, type FxCompositor } from "./compositor";
import {
  resolveDpi,
  FX_BLEND_MODES,
  FX_BIND_SOURCES,
  type FxBinding,
  type FxBindSource,
  type FxBlendMode,
  type FxLayer,
  type FxParamSpec,
} from "./fxModel";
import { FxBindingRuntime, easeOutCubic, FX_BIND_LABELS } from "./fxBindings";
import { evalSceneKeyframes } from "./fxTimeline";

/** Mutable scene clock the viewport publishes each frame — read by the
 * timeline bar on a slow poll so React isn't re-rendered at 60fps. */
const fxClock = { time: 0 };
import { fxEffect, FX_EFFECTS } from "./fxRegistry";
import { rasterizeSource, sourceRasterKey } from "./fxRaster";

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
    let hover = 0;
    let mouseSpeed = 0;
    let lastRestartNonce = useFxStore.getState().restartNonce;
    const bindings = new FxBindingRuntime();
    const mouse: [number, number] = [0.5, 0.5];
    const mouseTarget: [number, number] = [0.5, 0.5];
    const mousePrev: [number, number] = [0.5, 0.5];

    // Source-layer rasterization bookkeeping. Keys are set eagerly (before
    // the async raster lands) so a failed raster doesn't retry every frame.
    const rasterKeys = new Map<string, string>();
    const syncSources = (pw: number, ph: number) => {
      const { scene } = useFxStore.getState();
      for (const layer of scene.layers) {
        if (!fxEffect(layer.effectId)?.source) continue;
        const key = sourceRasterKey(layer, pw, ph);
        if (rasterKeys.get(layer.id) === key) continue;
        rasterKeys.set(layer.id, key);
        void rasterizeSource(layer, pw, ph).then((cnv) => {
          if (cnv && rasterKeys.get(layer.id) === key) {
            compositor?.updateSource(layer.id, cnv);
          }
        });
      }
      for (const id of [...rasterKeys.keys()]) {
        if (!scene.layers.some((l) => l.id === id)) {
          rasterKeys.delete(id);
          compositor?.dropSource(id);
        }
      }
    };

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
    const onEnter = () => {
      hover = 1;
    };
    const onLeave = () => {
      hover = 0;
    };
    canvas.addEventListener("pointermove", onPointer);
    canvas.addEventListener("pointerenter", onEnter);
    canvas.addEventListener("pointerleave", onLeave);

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

      const { scene, playing, restartNonce, scrubTime } = useFxStore.getState();
      if (restartNonce !== lastRestartNonce) {
        lastRestartNonce = restartNonce;
        sceneTime = 0;
        bindings.reset();
      }
      if (scrubTime !== null) sceneTime = scrubTime;

      // FPS cap: accumulate and only draw when a frame interval elapsed.
      if (scene.fps > 0) {
        accum += dt;
        const interval = 1 / scene.fps;
        if (accum < interval) return;
        accum %= interval;
      }

      if (playing && scrubTime === null) sceneTime += dt;
      fxClock.time = sceneTime;
      const k = 1 - Math.exp(-dt * 8);
      mouse[0] += (mouseTarget[0] - mouse[0]) * k;
      mouse[1] += (mouseTarget[1] - mouse[1]) * k;

      // Pointer speed: normalized uv distance per second, decaying when
      // still. 2.0 uv/s ≈ a brisk sweep maps to 1.
      if (dt > 0) {
        const dx = mouseTarget[0] - mousePrev[0];
        const dy = mouseTarget[1] - mousePrev[1];
        const raw = Math.min(1, Math.hypot(dx, dy) / dt / 2.0);
        mouseSpeed = Math.max(raw, mouseSpeed * Math.exp(-dt * 4));
      }
      mousePrev[0] = mouseTarget[0];
      mousePrev[1] = mouseTarget[1];

      const timeline = evalSceneKeyframes(scene, sceneTime);
      const overrides = bindings.tick(
        scene,
        {
          mouseX: mouse[0],
          mouseY: mouse[1],
          mouseSpeed,
          hover,
          appear: easeOutCubic(sceneTime / 1.2),
        },
        dt,
        timeline,
      );

      const dpi = resolveDpi(scene.dpi);
      const pw = Math.round(scene.width * dpi);
      const ph = Math.round(scene.height * dpi);
      syncSources(pw, ph);
      compositor.render(scene, { time: sceneTime, mouse }, pw, ph, overrides);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onLeave);
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
      <button
        type="button"
        className="xd-fx-play"
        onClick={() => useFxStore.getState().restart()}
        title="Restart (re-fires Appear bindings)"
        aria-label="Restart"
      >
        <RotateCcw size={13} />
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
      source: FX_EFFECTS.filter((s) => s.category === "source"),
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
            <div className="xd-fx-add-group">Sources</div>
            {groups.source.map((s) => (
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

function BindingRow({
  layerId,
  paramKey,
  binding,
}: {
  layerId: string;
  paramKey: string;
  binding: FxBinding;
}) {
  const patch = (p: Partial<FxBinding>) =>
    useFxStore.getState().setBinding(layerId, paramKey, { ...binding, ...p });
  return (
    <span className="xd-fx-bind-row">
      <select
        className="xd-fx-select xd-fx-bind-src"
        value={binding.source}
        onChange={(e) => patch({ source: e.target.value as FxBindSource })}
      >
        {FX_BIND_SOURCES.map((s) => (
          <option key={s} value={s}>
            {FX_BIND_LABELS[s]}
          </option>
        ))}
      </select>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.01}
        value={binding.amount}
        title={`Amount ${Math.round(binding.amount * 100)}%`}
        onChange={(e) => patch({ amount: Number(e.target.value) })}
      />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={binding.smooth ?? 0.3}
        className="xd-fx-bind-smooth"
        title={`Smoothing ${Math.round((binding.smooth ?? 0.3) * 100)}%`}
        onChange={(e) => patch({ smooth: Number(e.target.value) })}
      />
      <button
        type="button"
        className="xd-fx-bind-remove"
        onClick={() => useFxStore.getState().setBinding(layerId, paramKey, null)}
        aria-label="Remove binding"
      >
        <X size={10} />
      </button>
    </span>
  );
}

function ParamControl({
  layerId,
  spec,
  value,
  binding,
  keyframes,
}: {
  layerId: string;
  spec: FxParamSpec;
  value: number | string | undefined;
  binding?: FxBinding;
  keyframes?: { t: number; v: number }[];
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
  if (spec.type === "text") {
    return (
      <label className="xd-fx-field">
        <span>{spec.label}</span>
        <input
          type="text"
          className="xd-fx-text"
          value={typeof value === "string" ? value : spec.default}
          onChange={(e) => set(e.target.value)}
        />
      </label>
    );
  }
  if (spec.type === "image") {
    const file = typeof value === "string" ? value : "";
    const name = file ? file.split("/").pop() : null;
    return (
      <label className="xd-fx-field">
        <span>{spec.label}</span>
        <button
          type="button"
          className="xd-fx-file"
          onClick={() => {
            void openDialog({
              multiple: false,
              filters: [
                { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] },
              ],
            }).then((picked) => {
              if (typeof picked === "string") set(picked);
            });
          }}
        >
          {name ?? "Choose image…"}
        </button>
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
        <button
          type="button"
          className={`xd-fx-bind-btn${binding ? " on" : ""}`}
          title={binding ? "Edit interaction binding" : "Bind to mouse / hover / appear"}
          onClick={(e) => {
            e.preventDefault();
            useFxStore
              .getState()
              .setBinding(
                layerId,
                spec.key,
                binding ? null : { source: "mouseX", amount: 0.5, smooth: 0.3 },
              );
          }}
        >
          <Zap size={10} />
        </button>
        <button
          type="button"
          className={`xd-fx-bind-btn${keyframes?.length ? " on" : ""}`}
          title="Add keyframe at the current time"
          onClick={(e) => {
            e.preventDefault();
            const { scene } = useFxStore.getState();
            const dur = Math.max(0.1, scene.duration);
            const t01 = (((fxClock.time % dur) + dur) % dur) / dur;
            useFxStore.getState().addKeyframe(layerId, spec.key, { t: t01, v: num });
          }}
        >
          <Diamond size={9} />
        </button>
      </span>
      {binding && (
        <BindingRow layerId={layerId} paramKey={spec.key} binding={binding} />
      )}
      {keyframes && keyframes.length > 0 && (
        <span className="xd-fx-keys">
          {keyframes.map((k, i) => (
            <button
              key={`${k.t}-${i}`}
              type="button"
              className="xd-fx-key-chip"
              title={`t ${(k.t * 100).toFixed(0)}% · ${k.v} — click to remove`}
              onClick={(e) => {
                e.preventDefault();
                useFxStore.getState().removeKeyframe(layerId, spec.key, i);
              }}
            >
              ◆ {(k.t * 100).toFixed(0)}%
            </button>
          ))}
        </span>
      )}
    </label>
  );
}

function MaskSelect({ layer }: { layer: FxLayer }) {
  const layers = useFxStore((s) => s.scene.layers);
  const candidates = layers.filter(
    (l) => l.id !== layer.id && fxEffect(l.effectId)?.source,
  );
  if (candidates.length === 0) return null;
  return (
    <label className="xd-fx-field">
      <span>Mask (by source layer alpha)</span>
      <select
        className="xd-fx-select"
        value={layer.maskLayerId ?? ""}
        onChange={(e) =>
          useFxStore.getState().setMask(layer.id, e.target.value || null)
        }
      >
        <option value="">None</option>
        {candidates.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
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
              <span>Blend</span>
              <select
                className="xd-fx-select"
                value={layer.blend ?? "normal"}
                onChange={(e) =>
                  useFxStore
                    .getState()
                    .patchLayer(layer.id, { blend: e.target.value as FxBlendMode })
                }
              >
                {FX_BLEND_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m[0]!.toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </select>
            </label>
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
            <MaskSelect layer={layer} />
            {spec.params.map((p) => (
              <ParamControl
                key={p.key}
                layerId={layer.id}
                spec={p}
                value={layer.params[p.key]}
                binding={layer.bindings?.[p.key]}
                keyframes={layer.keyframes?.[p.key]}
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

// ── Timeline bar ────────────────────────────────────────────────

function FxTimelineBar() {
  const duration = useFxStore((s) => s.scene.duration);
  const scrub = useFxStore((s) => s.scrubTime);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => {
      setNow(((fxClock.time % duration) + duration) % duration);
    }, 100);
    return () => clearInterval(iv);
  }, [duration]);

  const shown = scrub !== null ? ((scrub % duration) + duration) % duration : now;

  return (
    <div className="xd-fx-timeline">
      <span className="xd-fx-time">
        {shown.toFixed(1)}s / {duration.toFixed(1)}s
      </span>
      <input
        type="range"
        className="xd-fx-scrub"
        min={0}
        max={duration}
        step={0.01}
        value={shown}
        onPointerDown={() => useFxStore.getState().setScrub(shown)}
        onChange={(e) => useFxStore.getState().setScrub(Number(e.target.value))}
        onPointerUp={() => useFxStore.getState().setScrub(null)}
        aria-label="Timeline scrubber"
      />
      <label className="xd-fx-dur" title="Loop duration (seconds)">
        <input
          className="xd-fx-dim"
          type="number"
          min={0.5}
          max={120}
          step={0.5}
          value={duration}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0.5 && v <= 120) {
              useFxStore.getState().patchScene({ duration: v });
            }
          }}
        />
        <span>s loop</span>
      </label>
    </div>
  );
}

export function FxEditor() {
  return (
    <div className="xd-fx-shell">
      <FxLayersPanel />
      <div className="xd-fx-stage">
        <FxToolbar />
        <FxViewport />
        <FxTimelineBar />
      </div>
      <FxInspector />
    </div>
  );
}
