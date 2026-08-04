import type { Command } from "@/commands/registry";
import { registry } from "@/commands/registry";
import type { DisposableScope } from "@/plugins/contracts";
import { internalActionRegistry } from "@/plugins/internalActionRegistry";
import { useShell } from "@/shell/store/useShell";
import { useAppChat } from "@/store/appChatStore";
import { useAssetsStore } from "@/store/assetsStore";
import { useDesignSystems } from "@/store/designSystemStore";
import { logActivity } from "@/lib/db";
import { log } from "@/lib/log";
import { useXDesign } from "@/apps/xdesign/store";
import {
  flushActive,
  projectKind,
  useXDProjects,
} from "@/apps/xdesign/projectsStore";
import { useFxStore } from "@/apps/xdesign/fx/fxStore";
import { useFxAssist } from "@/apps/xdesign/fx/fxAssist";
import { stopAudio } from "@/apps/xdesign/fx/fxAudio";
import { dropAllVideos } from "@/apps/xdesign/fx/fxVideo";
import { usePresentMode } from "@/apps/xdesign/presentStore";
import { useHtmlArtifact } from "@/apps/xdesign/htmlArtifactStore";
import {
  clearXDesignActivities,
  setXDesignActivity,
  xdesignActivityReason,
} from "@/apps/xdesign/runtimeActivity";

export const XDESIGN_CONTRIBUTION_IDS = {
  addRectAction: "xdesign_add_rect",
  addTextAction: "xdesign_add_text",
  addEllipseAction: "xdesign_add_ellipse",
  addFrameAction: "xdesign_add_frame",
  getCanvasAction: "xdesign_get_canvas",
  getSelectionAction: "xdesign_get_selection",
  applyAction: "xdesign_apply",
} as const;

let designSaveTimer: ReturnType<typeof setTimeout> | null = null;
let fxSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastLoggedProjectId: string | null = null;

function xdesignCommands(): Command[] {
  return [
    {
      id: "xdesign.exportToCode",
      label: "XDesign: Export Selection to React",
      keywords: ["xdesign", "export", "react", "code", "design", "component", "tsx"],
      group: "View",
      run: () => {
        void import("@/apps/xdesign/exportToCode").then((module) =>
          module.exportSelectionToCode(),
        );
      },
    },
    {
      id: "xdesign.present",
      label: "XDesign: Present Prototype",
      keywords: ["xdesign", "present", "play", "prototype", "preview", "demo", "flow"],
      group: "View",
      run: () => {
        void import("@/apps/xdesign/XDesignApp").then((module) =>
          module.startPresent(),
        );
      },
    },
  ];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

function dimension(payload: Record<string, unknown>, key: "w" | "h"): number {
  const value = finite(payload, key);
  if (value <= 0 || value > 100_000) {
    throw new Error(`${key} must be greater than zero and at most 100000`);
  }
  return value;
}

function optionalNumber(
  payload: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  return payload[key] === undefined ? fallback : finite(payload, key);
}

function optionalColor(
  payload: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = payload[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new Error(`${key} must be a non-empty string of at most 128 characters`);
  }
  return value;
}

async function ensureDesignProject(): Promise<void> {
  useShell.getState().openApp("xdesign");
  await useXDProjects.getState().ensureActive();
}

async function addRectAction(value: unknown): Promise<void> {
  const payload = record(value);
  if (!payload) throw new Error("xdesign_add_rect: invalid payload");
  const x = finite(payload, "x");
  const y = finite(payload, "y");
  const w = dimension(payload, "w");
  const h = dimension(payload, "h");
  const radius = optionalNumber(payload, "radius", 0);
  const fill = optionalColor(payload, "fill", "#00e0ff");
  await ensureDesignProject();
  useXDesign.getState().addShape({
    kind: "rect",
    x,
    y,
    w,
    h,
    radius,
    fill,
    stroke: "transparent",
    strokeWidth: 0,
  });
}

async function addEllipseAction(value: unknown): Promise<void> {
  const payload = record(value);
  if (!payload) throw new Error("xdesign_add_ellipse: invalid payload");
  const x = finite(payload, "x");
  const y = finite(payload, "y");
  const w = dimension(payload, "w");
  const h = dimension(payload, "h");
  const fill = optionalColor(payload, "fill", "#00e0ff");
  await ensureDesignProject();
  useXDesign.getState().addShape({
    kind: "ellipse",
    x,
    y,
    w,
    h,
    fill,
    stroke: "transparent",
    strokeWidth: 0,
  });
}

async function addFrameAction(value: unknown): Promise<void> {
  const payload = record(value);
  if (!payload) throw new Error("xdesign_add_frame: invalid payload");
  const x = finite(payload, "x");
  const y = finite(payload, "y");
  const w = dimension(payload, "w");
  const h = dimension(payload, "h");
  const fill = optionalColor(payload, "fill", "rgba(255,255,255,0.03)");
  await ensureDesignProject();
  useXDesign.getState().addShape({
    kind: "frame",
    x,
    y,
    w,
    h,
    radius: 0,
    fill,
    stroke: "rgba(255,255,255,0.12)",
    strokeWidth: 1,
  });
}

async function addTextAction(value: unknown): Promise<void> {
  const payload = record(value);
  if (!payload) throw new Error("xdesign_add_text: invalid payload");
  const text = payload.text;
  if (typeof text !== "string" || text.length === 0 || text.length > 10_000) {
    throw new Error("text must be a non-empty string of at most 10000 characters");
  }
  const fontSize = optionalNumber(payload, "fontSize", 24);
  if (fontSize <= 0 || fontSize > 1_000) {
    throw new Error("fontSize must be greater than zero and at most 1000");
  }
  const x = finite(payload, "x");
  const y = finite(payload, "y");
  const fill = optionalColor(payload, "fill", "#e6f4ec");
  await ensureDesignProject();
  useXDesign.getState().addShape({
    kind: "text",
    x,
    y,
    w: Math.max(60, text.length * fontSize * 0.55),
    h: fontSize * 1.3,
    text,
    fontSize,
    fill,
    stroke: "transparent",
    strokeWidth: 0,
  });
}

function canvasSnapshot(): Record<string, unknown> {
  const state = useXDesign.getState();
  return {
    activePageId: state.activePageId,
    pages: state.pages.map((page) => ({
      id: page.id,
      name: page.name,
      shapeCount: page.shapes.length,
    })),
    selection: Array.from(state.selection),
    shapes: state.shapes,
  };
}

function selectionSnapshot(): Record<string, unknown> {
  const state = useXDesign.getState();
  return {
    selection: Array.from(state.selection),
    shapes: state.shapes.filter((shape) => state.selection.has(shape.id)),
  };
}

async function applyAction(value: unknown): Promise<Record<string, unknown>> {
  const payload = record(value);
  const ops = payload?.ops;
  if (!Array.isArray(ops) || ops.length > 100) {
    throw new Error("xdesign_apply: ops must be an array of at most 100 entries");
  }
  await ensureDesignProject();
  const { runCanvasCommands } = await import("@/apps/xdesign/claudeCommands");
  const outcome = runCanvasCommands(
    ops as Parameters<typeof runCanvasCommands>[0],
  );
  return { applied: outcome.applied, results: outcome.results };
}

function clearPersistenceTimers(): void {
  if (designSaveTimer) clearTimeout(designSaveTimer);
  if (fxSaveTimer) clearTimeout(fxSaveTimer);
  designSaveTimer = null;
  fxSaveTimer = null;
  setXDesignActivity("design-save-pending", false, "");
  setXDesignActivity("fx-save-pending", false, "");
}

function scheduleDesignSave(): void {
  if (designSaveTimer) clearTimeout(designSaveTimer);
  setXDesignActivity(
    "design-save-pending",
    true,
    "Wait for the XDesign document to finish saving before disabling the plugin.",
  );
  designSaveTimer = setTimeout(() => {
    designSaveTimer = null;
    setXDesignActivity("design-save-pending", false, "");
    const activeId = useXDProjects.getState().activeId;
    if (!activeId) return;
    const state = useXDesign.getState();
    void flushActive()
      .then(() => {
        if (activeId === lastLoggedProjectId) {
          const page = state.pages.find((candidate) => candidate.id === state.activePageId);
          return logActivity({
            source: "xdesign",
            kind: "design.edit",
            title: page?.name || "Canvas",
            summary: `${state.shapes.length} layer${state.shapes.length === 1 ? "" : "s"}`,
            refId: state.activePageId,
          });
        }
        lastLoggedProjectId = activeId;
      })
      .catch((error) => log.warn("xdesign document save failed", error));
  }, 400);
}

function scheduleFxSave(): void {
  if (fxSaveTimer) clearTimeout(fxSaveTimer);
  setXDesignActivity(
    "fx-save-pending",
    true,
    "Wait for the XDesign FX scene to finish saving before disabling the plugin.",
  );
  fxSaveTimer = setTimeout(() => {
    fxSaveTimer = null;
    setXDesignActivity("fx-save-pending", false, "");
    const { activeId, registry: projects } = useXDProjects.getState();
    if (!activeId) return;
    if (projectKind(projects.find((project) => project.id === activeId)) !== "fx") return;
    void flushActive().catch((error) => log.warn("xdesign FX save failed", error));
  }, 400);
}

function disposeXDesignRuntime(): void {
  clearPersistenceTimers();
  clearXDesignActivities();
  useXDesign.getState().endHistoryCoalesce();
  usePresentMode.getState().exit();
  useHtmlArtifact.getState().close();
  useHtmlArtifact.setState({
    builder: null,
    refiner: null,
    elementRefiner: null,
  });
  useHtmlArtifact.getState().setProject(null);
  useFxAssist.setState({ open: false });
  useFxStore.getState().setAudioOn(false);
  stopAudio();
  dropAllVideos();
  useXDProjects.setState({ openTabs: [], activeId: null, ready: false });
}

export function xdesignDisableReason(): string | null {
  if (useAppChat.getState().threads.xdesign.running) {
    return "Wait for the XDesign Claude response to finish before disabling the plugin.";
  }
  if (useFxAssist.getState().busy) {
    return "Wait for XDesign FX Assist to finish before disabling the plugin.";
  }
  return xdesignActivityReason();
}

export async function loadXDesignPluginData(): Promise<void> {
  await Promise.all([
    useXDProjects.getState().init(),
    useDesignSystems.getState().load(),
    useAssetsStore.getState().load(),
  ]);
}

export function registerXDesignContributions(
  ownerId: string,
  subscriptions: DisposableScope,
): void {
  subscriptions.add(disposeXDesignRuntime);
  subscriptions.add(useXDesign.subscribe(scheduleDesignSave));
  subscriptions.add(
    useFxStore.subscribe((state, previous) => {
      if (state.scene !== previous.scene) scheduleFxSave();
    }),
  );

  for (const command of xdesignCommands()) {
    subscriptions.add(registry.register(command, ownerId));
  }

  const actions = [
    { id: XDESIGN_CONTRIBUTION_IDS.addRectAction, handle: addRectAction },
    { id: XDESIGN_CONTRIBUTION_IDS.addTextAction, handle: addTextAction },
    { id: XDESIGN_CONTRIBUTION_IDS.addEllipseAction, handle: addEllipseAction },
    { id: XDESIGN_CONTRIBUTION_IDS.addFrameAction, handle: addFrameAction },
    { id: XDESIGN_CONTRIBUTION_IDS.getCanvasAction, handle: canvasSnapshot },
    { id: XDESIGN_CONTRIBUTION_IDS.getSelectionAction, handle: selectionSnapshot },
    { id: XDESIGN_CONTRIBUTION_IDS.applyAction, handle: applyAction },
  ];
  for (const action of actions) {
    subscriptions.add(internalActionRegistry.register(ownerId, action));
  }
}
