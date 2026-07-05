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
  Zap,
  X,
  Diamond,
  Download,
  Activity,
  Copy,
  Dices,
  Sparkles,
  Mic,
  MicOff,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ipc } from "@/lib/ipc";
import { toast, useToasts } from "@/store/toastStore";
import { log } from "@/lib/log";
import { recordCanvasToFile } from "@/apps/xdesign/recordCanvas";
import {
  sceneToJson,
  sceneFromJson,
  buildEmbedHtml,
  renderFxSnapshot,
} from "./fxExport";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { useAssetsStore } from "@/store/assetsStore";
import { useXDesign } from "@/apps/xdesign/store";
import { useXDProjects } from "@/apps/xdesign/projectsStore";
import { FxShaderModal } from "./FxShaderModal";
import { FxEffectBrowser } from "./FxEffectBrowser";
import { FxAssistPanel } from "./FxAssistPanel";
import { useFxAssist } from "./fxAssist";
import { FxCanvasOverlay } from "./FxCanvasOverlay";
import { sampleAudio, startAudio, stopAudio } from "./fxAudio";
import { ensureVideo, drawVideoFrame, dropVideo, dropAllVideos } from "./fxVideo";
import { toast as fxToast } from "@/store/toastStore";
import { FX_CUSTOM_ID, customCodeOf } from "./fxModel";
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

/** Live viewport canvas — registered so video export can captureStream it
 * (same pattern as exportXD's setExportSvgRef). */
let fxCanvasEl: HTMLCanvasElement | null = null;

/** Perf counters the render loop publishes (mutable, non-reactive — the
 * HUD polls). ms is CPU submit time; fps counts presented frames. */
const fxPerf = { ms: 0, worst: 0, fps: 0, passes: 0, w: 0, h: 0 };
import { fxEffect } from "./fxRegistry";
import { rasterizeSource, sourceRasterKey } from "./fxRaster";

// ── Viewport ──────────────────────────────────────────────────────────────

function PerfHud() {
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(iv);
  }, []);
  const layerCount = useFxStore((s) => s.scene.layers.filter((l) => !l.hidden).length);
  return (
    <div className="xd-fx-perf">
      <span className={fxPerf.fps >= 55 ? "ok" : fxPerf.fps >= 30 ? "warn" : "bad"}>
        {fxPerf.fps} fps
      </span>
      <span>{fxPerf.ms.toFixed(2)} ms avg · {fxPerf.worst.toFixed(1)} worst</span>
      <span>{fxPerf.passes} passes · {layerCount} layers</span>
      <span>{fxPerf.w}×{fxPerf.h}</span>
    </div>
  );
}

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
    let audio = 0;
    let lastRestartNonce = useFxStore.getState().restartNonce;
    const bindings = new FxBindingRuntime();
    const mouse: [number, number] = [0.5, 0.5];
    const mouseTarget: [number, number] = [0.5, 0.5];
    const mousePrev: [number, number] = [0.5, 0.5];

    const frameTimes: number[] = [];
    let fpsCount = 0;
    let fpsWindowStart = performance.now();

    // Source-layer rasterization bookkeeping. Keys are set eagerly (before
    // the async raster lands) so a failed raster doesn't retry every frame.
    const rasterKeys = new Map<string, string>();
    const syncSources = (pw: number, ph: number) => {
      const { scene } = useFxStore.getState();
      for (const layer of scene.layers) {
        // Video sources stream live (see syncVideos) — not key-cached.
        if (!fxEffect(layer.effectId)?.source || layer.effectId === "srcVideo") continue;
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

    // Video sources: create/point the <video>, upload the current frame
    // every tick, and prune elements for deleted layers.
    const videoIds = new Set<string>();
    const syncVideos = (pw: number, ph: number) => {
      const { scene } = useFxStore.getState();
      const live = new Set<string>();
      for (const layer of scene.layers) {
        if (layer.effectId !== "srcVideo") continue;
        live.add(layer.id);
        videoIds.add(layer.id);
        ensureVideo(layer);
        if (layer.hidden) continue;
        const cnv = drawVideoFrame(layer, pw, ph);
        if (cnv) compositor?.updateSource(layer.id, cnv);
      }
      for (const id of [...videoIds]) {
        if (!live.has(id)) {
          videoIds.delete(id);
          dropVideo(id);
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
      audio = sampleAudio();

      const timeline = evalSceneKeyframes(scene, sceneTime);
      const overrides = bindings.tick(
        scene,
        {
          mouseX: mouse[0],
          mouseY: mouse[1],
          mouseSpeed,
          hover,
          appear: easeOutCubic(sceneTime / 1.2),
          audio,
        },
        dt,
        timeline,
      );

      const dpi = resolveDpi(scene.dpi);
      const pw = Math.round(scene.width * dpi);
      const ph = Math.round(scene.height * dpi);
      syncSources(pw, ph);
      syncVideos(pw, ph);
      const t0 = performance.now();
      const passes = compositor.render(
        scene,
        { time: sceneTime, mouse, mouseSpeed, audio },
        pw,
        ph,
        overrides,
      );
      const ms = performance.now() - t0;

      frameTimes.push(ms);
      if (frameTimes.length > 60) frameTimes.shift();
      fpsCount++;
      if (now - fpsWindowStart >= 1000) {
        fxPerf.fps = Math.round((fpsCount * 1000) / (now - fpsWindowStart));
        fpsCount = 0;
        fpsWindowStart = now;
      }
      fxPerf.ms = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      fxPerf.worst = Math.max(...frameTimes);
      fxPerf.passes = passes;
      fxPerf.w = pw;
      fxPerf.h = ph;
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
      dropAllVideos();
      compositor?.dispose();
    };
  }, []);

  return (
    <div className="xd-fx-viewport" ref={wrapRef}>
      {glLost ? (
        <div className="xd-fx-gl-lost">WebGL2 unavailable</div>
      ) : (
        <>
          <canvas
            ref={(el) => {
              canvasRef.current = el;
              fxCanvasEl = el;
            }}
            className="xd-fx-canvas"
            style={{ width: fit.w || undefined, height: fit.h || undefined }}
          />
          <FxCanvasOverlay fitW={fit.w} fitH={fit.h} />
        </>
      )}
    </div>
  );
}

// ── Export ──────────────────────────────────────────────────────

async function saveBytes(
  bytes: Uint8Array,
  defaultName: string,
  filterName: string,
  ext: string,
): Promise<boolean> {
  const path = await saveDialog({
    defaultPath: defaultName,
    filters: [{ name: filterName, extensions: [ext] }],
  });
  if (!path) return false;
  await ipc.xdesignSaveBytes(path, Array.from(bytes));
  toast.success("Exported", { body: path });
  return true;
}

async function exportPng(): Promise<void> {
  const { scene } = useFxStore.getState();
  const dpi = resolveDpi(scene.dpi);
  const blob = await renderFxSnapshot(
    scene,
    fxClock.time,
    Math.round(scene.width * dpi),
    Math.round(scene.height * dpi),
  );
  if (!blob) {
    toast.error("PNG export failed", { body: "Couldn't render the scene offscreen." });
    return;
  }
  await saveBytes(
    new Uint8Array(await blob.arrayBuffer()),
    "fx-scene.png",
    "PNG image",
    "png",
  );
}

async function exportVideo(): Promise<void> {
  if (!fxCanvasEl) {
    toast.error("No live canvas to record");
    return;
  }
  const { scene } = useFxStore.getState();
  const ms = Math.round(Math.max(1, scene.duration) * 1000);
  const recId = toast.info(`Recording ${(ms / 1000).toFixed(1)}s…`, { durationMs: 0 });
  try {
    const { bytes, ext } = await recordCanvasToFile(fxCanvasEl, ms);
    useToasts.getState().dismiss(recId);
    await saveBytes(bytes, `fx-scene.${ext}`, "Video", ext);
  } catch (e) {
    useToasts.getState().dismiss(recId);
    log.error("fx video export", e);
    toast.error("Video export unavailable", {
      body: e instanceof Error ? e.message : String(e),
    });
  }
}

async function exportEmbed(): Promise<void> {
  const { scene } = useFxStore.getState();
  const sources: Record<string, string> = {};
  for (const layer of scene.layers) {
    if (!fxEffect(layer.effectId)?.source) continue;
    const cnv = await rasterizeSource(layer, scene.width, scene.height);
    if (cnv) sources[layer.id] = cnv.toDataURL("image/png");
  }
  const html = buildEmbedHtml(scene, sources);
  await saveBytes(
    new TextEncoder().encode(html),
    "fx-scene.html",
    "HTML",
    "html",
  );
}

/** Snapshot the scene to a PNG asset and drop it onto a DESIGN project's
 * canvas (creates one when the active project is this FX scene) — the
 * design↔FX bridge Unicorn doesn't have. */
async function placeInDesign(): Promise<void> {
  const { scene } = useFxStore.getState();
  const dpi = resolveDpi(scene.dpi);
  const blob = await renderFxSnapshot(
    scene,
    fxClock.time,
    Math.round(scene.width * dpi),
    Math.round(scene.height * dpi),
  );
  if (!blob) {
    toast.error("Snapshot failed");
    return;
  }
  const path = await join(await appConfigDir(), `fx-snapshot-${Date.now()}.png`);
  await ipc.xdesignSaveBytes(
    path,
    Array.from(new Uint8Array(await blob.arrayBuffer())),
  );
  const assets = await useAssetsStore.getState().ingestPaths([path]);
  const asset = assets.find((a) => a.kind === "image");
  if (!asset) {
    toast.error("Couldn't ingest the snapshot as an asset");
    return;
  }
  await useXDProjects.getState().ensureActive();
  const w = Math.min(600, scene.width);
  const h = Math.round((w / scene.width) * scene.height);
  useXDesign.getState().addShape({
    kind: "image",
    x: 500 - w / 2,
    y: 350 - h / 2,
    w,
    h,
    filePath: asset.filePath,
    assetId: asset.id,
    fill: "transparent",
    stroke: "transparent",
    strokeWidth: 0,
  });
  toast.success("Placed in design canvas");
}

async function exportJson(): Promise<void> {
  const { scene } = useFxStore.getState();
  await saveBytes(
    new TextEncoder().encode(sceneToJson(scene)),
    "fx-scene.json",
    "FX scene",
    "json",
  );
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = (fn: () => Promise<void>) => {
    setOpen(false);
    void fn().catch((e) => {
      log.error("fx export", e);
      toast.error("Export failed", { body: e instanceof Error ? e.message : String(e) });
    });
  };

  return (
    <div className="xd-fx-add-wrap">
      <button
        type="button"
        className="xd-fx-play"
        onClick={() => setOpen((v) => !v)}
        title="Export / import"
        aria-label="Export"
      >
        <Download size={13} />
      </button>
      {open && (
        <>
          <div className="xd-home-menu-scrim" onClick={() => setOpen(false)} />
          <div className="xd-fx-add-menu">
            <div className="xd-fx-add-group">Export</div>
            <button type="button" onClick={() => run(exportPng)}>
              <span className="xd-fx-add-label">PNG image</span>
            </button>
            <button type="button" onClick={() => run(exportVideo)}>
              <span className="xd-fx-add-label">Video (one loop)</span>
            </button>
            <button type="button" onClick={() => run(exportEmbed)}>
              <span className="xd-fx-add-label">HTML embed (standalone)</span>
            </button>
            <button type="button" onClick={() => run(exportJson)}>
              <span className="xd-fx-add-label">Scene JSON</span>
            </button>
            <button type="button" onClick={() => run(placeInDesign)}>
              <span className="xd-fx-add-label">Place in design canvas</span>
            </button>
            <div className="xd-fx-add-group">Import</div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                fileRef.current?.click();
              }}
            >
              <span className="xd-fx-add-label">Scene JSON…</span>
            </button>
          </div>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          void f.text().then((text) => {
            const scene = sceneFromJson(text);
            if (!scene) {
              toast.error("Not a valid FX scene file");
              return;
            }
            useFxStore.getState().hydrateFx({ scene });
            toast.success("Scene imported");
          });
        }}
      />
    </div>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────

function FxToolbar() {
  const scene = useFxStore((s) => s.scene);
  const playing = useFxStore((s) => s.playing);
  const patchScene = useFxStore((s) => s.patchScene);
  const showPerf = useFxStore((s) => s.showPerf);
  const audioOn = useFxStore((s) => s.audioOn);
  const assistOpen = useFxAssist((s) => s.open);

  const toggleAudio = () => {
    if (audioOn) {
      stopAudio();
      useFxStore.getState().setAudioOn(false);
      return;
    }
    void startAudio().then((ok) => {
      useFxStore.getState().setAudioOn(ok);
      if (!ok) {
        fxToast.error("Microphone unavailable", {
          body: "Grant mic access to drive effects with sound.",
        });
      }
    });
  };

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
      <span className="xd-fx-toolbar-spacer" />
      <button
        type="button"
        className={`xd-fx-play${audioOn ? " active" : ""}`}
        onClick={toggleAudio}
        title={audioOn ? "Mic reactivity on" : "React to sound (mic)"}
        aria-label="Toggle audio reactivity"
      >
        {audioOn ? <Mic size={13} /> : <MicOff size={13} />}
      </button>
      <button
        type="button"
        className={`xd-fx-assist-toggle${assistOpen ? " active" : ""}`}
        onClick={() => useFxAssist.getState().setOpen(!assistOpen)}
        title="FX Assist — describe an effect, it builds it"
      >
        <Sparkles size={13} /> Assist
      </button>
      <button
        type="button"
        className={`xd-fx-play${showPerf ? " active" : ""}`}
        onClick={() => useFxStore.getState().setShowPerf(!showPerf)}
        title="Performance HUD"
        aria-label="Performance HUD"
      >
        <Activity size={13} />
      </button>
      <ExportMenu />
    </div>
  );
}

// ── Layers panel ──────────────────────────────────────────────────────────

function AddLayerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="xd-fx-add"
        onClick={() => setOpen(true)}
        title="Add layer"
        aria-label="Add layer"
      >
        <Plus size={14} />
      </button>
      {open && <FxEffectBrowser onClose={() => setOpen(false)} />}
    </>
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
          onClick={(e) => {
            e.stopPropagation();
            useFxStore.getState().duplicateLayer(layer.id);
          }}
          aria-label="Duplicate layer"
          title="Duplicate"
        >
          <Copy size={11} />
        </button>
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
        <AddLayerButton />
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
  if (spec.type === "image" || spec.type === "video") {
    const isVideo = spec.type === "video";
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
              filters: isVideo
                ? [{ name: "Video", extensions: ["mp4", "mov", "webm", "m4v", "ogv"] }]
                : [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] }],
            }).then(async (picked) => {
              if (typeof picked !== "string") return;
              // Copy into the app's scoped asset dir so the asset:// protocol
              // can actually load it (an arbitrary ~/Desktop path is blocked).
              try {
                const stored = await ipc.assetStoreFile(picked);
                set(stored.filePath);
              } catch (e) {
                log.error("fx source ingest", e);
                toast.error("Couldn't load that file", {
                  body: e instanceof Error ? e.message : String(e),
                });
              }
            });
          }}
        >
          {name ?? (isVideo ? "Choose video…" : "Choose image…")}
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
      <span
        onDoubleClick={() => useFxStore.getState().resetParam(layerId, spec.key)}
        title="Double-click to reset"
      >
        {spec.label}
      </span>
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
  // Only true source layers (shape/text/image) make sense as masks — not
  // effects that merely carry an auxiliary texture (glyph dither's atlas).
  const candidates = layers.filter(
    (l) => l.id !== layer.id && fxEffect(l.effectId)?.category === "source",
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
  const [shaderModal, setShaderModal] = useState(false);
  const layer = scene.layers.find((l) => l.id === selectedId) ?? null;
  const spec = layer ? fxEffect(layer.effectId) : undefined;

  return (
    <aside className="xd-fx-inspector">
      {layer && spec ? (
        <>
          <div className="xd-fx-panel-head">
            <span>{spec.label}</span>
            <button
              type="button"
              className="xd-fx-add"
              onClick={() => useFxStore.getState().randomizeLayer(layer.id)}
              title="Randomize parameters"
              aria-label="Randomize parameters"
            >
              <Dices size={13} />
            </button>
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
            {layer.effectId === FX_CUSTOM_ID && (
              <button
                type="button"
                className="xd-fx-file"
                onClick={() => setShaderModal(true)}
              >
                Edit shader… (GLSL / Claude)
              </button>
            )}
            <MaskSelect layer={layer} />
            {spec.params.filter((p) => !p.hidden).map((p) => (
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
          {shaderModal && layer.effectId === FX_CUSTOM_ID && (
            <FxShaderModal
              layerId={layer.id}
              initialCode={customCodeOf(layer)}
              onClose={() => setShaderModal(false)}
            />
          )}
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
  const showPerf = useFxStore((s) => s.showPerf);
  return (
    <div className="xd-fx-shell">
      <FxLayersPanel />
      <div className="xd-fx-stage">
        <FxToolbar />
        <div className="xd-fx-stage-body">
          <FxViewport />
          {showPerf && <PerfHud />}
          <FxAssistPanel />
        </div>
        <FxTimelineBar />
      </div>
      <FxInspector />
    </div>
  );
}
