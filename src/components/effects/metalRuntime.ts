import { createInstance, destroyInstance, type MetalFxInstance } from "metal-fx";

const key = Symbol.for("orion.metal-renderer-keeper");
const runtime = globalThis as typeof globalThis & { [key]?: MetalFxInstance };

export function keepMetalRendererWarm() {
  if (runtime[key]) return;
  // Upstream's disposed WebGL context delivers contextlost asynchronously and
  // its listener targets the shared singleton, including a newer replacement.
  // Keep ONE context for this document: no teardown/recreate race on switches.
  // This invisible, paused 1px lease never draws or starts a background loop.
  const keeper = createInstance({ hostCanvas: document.createElement("canvas"), cssWidth: 1, cssHeight: 1,
    cornerRadius: 0, kind: "pill", paused: true, opacityMul: 0, glowGain: 0 });
  keeper.visible = false;
  runtime[key] = keeper;
  const dispose = (event: PageTransitionEvent) => {
    if (event.persisted) return;
    if (runtime[key]) destroyInstance(runtime[key]);
    delete runtime[key];
    window.removeEventListener("pagehide", dispose);
  };
  window.addEventListener("pagehide", dispose);
}
