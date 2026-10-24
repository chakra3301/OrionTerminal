import type { DesignControlSession, DesignNavigation, DesignNode, DesignPoint } from './reactExportRuntime';
import type { PrototypeSession, PrototypeVariables } from './prototypeValues';

export type NativeReactRequest = {
  rootId?: string;
  controlScope?: string;
  session?: PrototypeSession;
  controls?: DesignControlSession;
  rootSizes?: Record<string, { width?: number; height?: number }>;
};
export type NativeReactModel = { nodes: DesignNode[]; width: number; height: number; byteLength?: number; prototypeVariables?: PrototypeVariables; scrollPositions?: Record<string, DesignPoint> };
export type NativeReactInit = { graph: string; ids: string[]; wasm: Uint8Array; fonts: unknown };
export type NativeReactMotionEndpoint = NativeReactRequest & { rootId: string; overlays?: { rootId: string; controlScope: string; origin: DesignPoint; offset: DesignPoint }[]; scrollPositions?: Record<string, DesignPoint> };
export type NativeReactMotionRequest = { sessionId: number; from: NativeReactMotionEndpoint; to: NativeReactMotionEndpoint; link: DesignNavigation };
export type NativeReactMotionInfo = { sessionId: number; matched: number; from: { width: number; height: number }; to: { width: number; height: number }; movements: Record<string, DesignPoint>; movement?: DesignPoint; initialModel: NativeReactModel };
export type NativeReactOperation = { type: 'render'; request: NativeReactRequest } | { type: 'motion-prepare'; motion: NativeReactMotionRequest } | { type: 'motion-frame'; sessionId: number; progress: number };
export type NativeReactInput = { type: 'init'; payload: NativeReactInit } | (NativeReactOperation & { id: number }) | { type: 'motion-cancel'; sessionId: number };
export type NativeReactOutput = { type: 'ready' } | { type: 'model'; id: number; model: NativeReactModel } | { type: 'motion-ready'; id: number; motion: NativeReactMotionInfo } | { type: 'error'; id?: number; message: string };
