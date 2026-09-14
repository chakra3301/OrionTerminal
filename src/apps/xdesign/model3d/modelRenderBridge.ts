/**
 * Bridge between the live r3f viewport (DOM/WebGL, main-thread-only) and
 * the agent tool executor (`modelAssistTools.ts`, plain TS). `ModelViewport`
 * registers its capture function on mount; tools call through this module
 * instead of reaching into React internals — same shape as XDesign's
 * `captureCanvasSnapshot` pattern for the 2D canvas.
 */

export type OrbitCapture = { angleDeg: number; canvas: HTMLCanvasElement };

export type ModelRenderBridge = {
  /** Render the current model at the standing review angle. */
  captureReviewShot: () => Promise<HTMLCanvasElement | null>;
  /** Render N evenly-spaced orbit angles for the multi-angle degenerate-view gate. */
  captureOrbit: (angles: number[]) => Promise<OrbitCapture[]>;
};

let bridge: ModelRenderBridge | null = null;

export function registerModelRenderBridge(b: ModelRenderBridge | null): void {
  bridge = b;
}

export function getModelRenderBridge(): ModelRenderBridge | null {
  return bridge;
}
