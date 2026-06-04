// Canvas command DSL — how XDesign's Claude rail manipulates the document.
//
// Claude embeds JSON commands in <canvas-command>…</canvas-command> tags in
// its responses. We parse these out, hide them from the rendered chat, and
// run them against the useXDesign store. One pushHistory() per batch so a
// single ⌘Z undoes the whole change.

import { useXDesign, type Shape, type ShapePatch } from "@/apps/xdesign/store";
import { log } from "@/lib/log";

export type AddRectCmd = {
  action: "addRect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  rotation?: number;
  name?: string;
};

export type AddEllipseCmd = {
  action: "addEllipse";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rotation?: number;
  name?: string;
};

export type AddTextCmd = {
  action: "addText";
  x: number;
  y: number;
  w?: number;
  h?: number;
  text: string;
  fontSize?: number;
  fill?: string;
  rotation?: number;
  name?: string;
};

export type AddFrameCmd = {
  action: "addFrame";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  radius?: number;
  name?: string;
};

export type AddStarCmd = {
  action: "addStar";
  cx: number;
  cy: number;
  outerR: number;
  innerR: number;
  points?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rotation?: number;
  name?: string;
};

export type AddPathCmd = {
  action: "addPath";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Points in unit space (0..1) relative to the path's bbox. */
  points: Array<{ x: number; y: number }>;
  closed?: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rotation?: number;
  name?: string;
};

export type UpdateCmd = {
  action: "update";
  id: string;
} & Partial<Omit<Shape, "id" | "kind">>;

export type DeleteCmd = { action: "delete"; id: string };
export type SelectCmd = { action: "select"; ids: string[] };
export type ClearCmd = { action: "clearCanvas" };

// Phase 3 — structure, components, variables.
export type GroupCmd = { action: "group"; ids: string[] };
export type UngroupCmd = { action: "ungroup"; ids: string[] };
export type ReparentCmd = {
  action: "reparent";
  id: string;
  /** New parent frame id, or null/omitted to move to the page root. */
  parentId?: string | null;
};
export type MakeComponentCmd = { action: "makeComponent"; id: string };
export type CreateInstanceCmd = {
  action: "createInstance";
  mainId: string;
  /** Optional placement for the instance root; defaults to offset-right. */
  x?: number;
  y?: number;
};
export type SyncInstanceCmd = { action: "syncInstance"; id: string };
export type DetachInstanceCmd = { action: "detachInstance"; id: string };
export type AddVariableCmd = {
  action: "addVariable";
  name: string;
  value: string | number;
  varType?: "color" | "number";
};
export type SetVariableValueCmd = {
  action: "setVariableValue";
  id: string;
  modeId: string;
  value: string | number;
};
export type AddModeCmd = { action: "addMode"; name: string };
export type SetActiveModeCmd = { action: "setActiveMode"; id: string };

// Pages + z-order + duplicate.
export type AddPageCmd = { action: "addPage"; name?: string };
export type SwitchPageCmd = { action: "switchPage"; id: string };
export type RenamePageCmd = { action: "renamePage"; id: string; name: string };
export type DeletePageCmd = { action: "deletePage"; id: string };
export type BringToFrontCmd = { action: "bringToFront"; ids: string[] };
export type SendToBackCmd = { action: "sendToBack"; ids: string[] };
export type DuplicateCmd = { action: "duplicate"; ids: string[] };

export type CanvasCommand =
  | AddRectCmd
  | AddEllipseCmd
  | AddTextCmd
  | AddFrameCmd
  | AddStarCmd
  | AddPathCmd
  | UpdateCmd
  | DeleteCmd
  | SelectCmd
  | ClearCmd
  | GroupCmd
  | UngroupCmd
  | ReparentCmd
  | MakeComponentCmd
  | CreateInstanceCmd
  | SyncInstanceCmd
  | DetachInstanceCmd
  | AddVariableCmd
  | SetVariableValueCmd
  | AddModeCmd
  | SetActiveModeCmd
  | AddPageCmd
  | SwitchPageCmd
  | RenamePageCmd
  | DeletePageCmd
  | BringToFrontCmd
  | SendToBackCmd
  | DuplicateCmd;

const TAG_RE = /<canvas-command>([\s\S]*?)<\/canvas-command>/g;

/** Pull command JSON out of an assistant message. Malformed blocks are
 * skipped silently — Claude occasionally hallucinates trailing prose
 * inside a tag and we'd rather keep going. */
export function parseCanvasCommands(text: string): CanvasCommand[] {
  const out: CanvasCommand[] = [];
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      // Support `[{...}, {...}]` array form too.
      if (Array.isArray(obj)) {
        for (const cmd of obj) {
          if (cmd && typeof cmd.action === "string") {
            out.push(cmd as CanvasCommand);
          }
        }
      } else if (obj && typeof obj.action === "string") {
        out.push(obj as CanvasCommand);
      }
    } catch (e) {
      log.warn("canvas-command parse failed", e);
    }
  }
  return out;
}

/** Strip the command tags from a message body so they don't show up in the
 * chat UI. */
export function stripCanvasCommands(text: string): string {
  return text.replace(TAG_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Generate a star path in unit space (0..1) for n-pointed star with given
 * outer/inner radius ratio. Returns points ready for an XDesign PathShape
 * along with the unit-space bbox info (always 0..1 by construction). */
function starUnitPoints(
  nPoints: number,
  innerRatio: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  // Outer radius = 0.5, inner = 0.5 * innerRatio. Centered at (0.5, 0.5).
  // Start at the top (angle = -π/2).
  const outer = 0.5;
  const inner = 0.5 * innerRatio;
  for (let i = 0; i < nPoints * 2; i++) {
    const angle = (i * Math.PI) / nPoints - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    points.push({
      x: 0.5 + Math.cos(angle) * r,
      y: 0.5 + Math.sin(angle) * r,
    });
  }
  return points;
}

export type CanvasOpResult = {
  action: string;
  ok: boolean;
  id?: string;
  error?: string;
};

export type CanvasRunOutcome = {
  applied: number;
  newIds: string[];
  results: CanvasOpResult[];
};

/** Run a batch of commands against the live useXDesign store as ONE undo
 * step. Returns the applied count, the ids of shapes created (in order), and
 * a per-op result list (carrying the new id for add ops) so callers — e.g.
 * the MCP `orion_xdesign_apply` tool — can hand Claude the ids of what it
 * just made and report which ops failed. */
export function runCanvasCommands(cmds: CanvasCommand[]): CanvasRunOutcome {
  if (cmds.length === 0) return { applied: 0, newIds: [], results: [] };
  const store = useXDesign.getState();
  // Individual store actions (addShape/deleteShapes/…) each push their OWN
  // history entry, so a naive batch becomes N undo steps. Snapshot the
  // pre-batch state up front, let the ops run normally, then rewrite history
  // (below) to a single entry so one ⌘Z reverts the whole batch.
  const priorPast = store.past;
  const priorFuture = store.future;
  const shapesBefore = store.shapes;
  const pageBefore = store.activePageId;
  let applied = 0;
  const newIds: string[] = [];
  const results: CanvasOpResult[] = [];

  for (const c of cmds) {
    const action = (c as { action?: string }).action ?? "unknown";
    const beforeApplied = applied;
    const beforeIds = newIds.length;
    // Set by ops that create a NON-shape entity (variable/mode) — reported in
    // the result id but kept out of newIds (which drives shape selection).
    let nonShapeId: string | undefined;
    try {
      switch (c.action) {
        case "addRect": {
          const id = store.addShape({
            kind: "rect",
            x: c.x,
            y: c.y,
            w: c.w,
            h: c.h,
            radius: c.radius ?? 4,
            rotation: c.rotation ?? 0,
            fill: c.fill ?? "rgba(255, 62, 165, 0.2)",
            stroke: c.stroke ?? "rgba(255, 62, 165, 0.7)",
            strokeWidth: c.strokeWidth ?? 1.5,
            ...(c.name ? { name: c.name } : {}),
          });
          newIds.push(id);
          applied++;
          break;
        }
        case "addEllipse": {
          const id = store.addShape({
            kind: "ellipse",
            x: c.x,
            y: c.y,
            w: c.w,
            h: c.h,
            rotation: c.rotation ?? 0,
            fill: c.fill ?? "rgba(0, 224, 255, 0.2)",
            stroke: c.stroke ?? "rgba(0, 224, 255, 0.7)",
            strokeWidth: c.strokeWidth ?? 1.5,
            ...(c.name ? { name: c.name } : {}),
          });
          newIds.push(id);
          applied++;
          break;
        }
        case "addText": {
          const id = store.addShape({
            kind: "text",
            x: c.x,
            y: c.y,
            w: c.w ?? 220,
            h: c.h ?? 36,
            text: c.text,
            fontSize: c.fontSize ?? 22,
            rotation: c.rotation ?? 0,
            fill: c.fill ?? "var(--t-primary)",
            stroke: "transparent",
            strokeWidth: 0,
            ...(c.name ? { name: c.name } : {}),
          });
          newIds.push(id);
          applied++;
          break;
        }
        case "addFrame": {
          const id = store.addShape({
            kind: "frame",
            x: c.x,
            y: c.y,
            w: c.w,
            h: c.h,
            radius: c.radius ?? 8,
            fill: c.fill ?? "rgba(255,255,255,0.02)",
            stroke: c.stroke ?? "rgba(255,255,255,0.12)",
            strokeWidth: 1,
            ...(c.name ? { name: c.name } : {}),
          });
          newIds.push(id);
          applied++;
          break;
        }
        case "addStar": {
          const n = Math.max(3, c.points ?? 5);
          const ratio = c.outerR > 0 ? c.innerR / c.outerR : 0.5;
          const w = c.outerR * 2;
          const h = c.outerR * 2;
          const id = store.addShape({
            kind: "path",
            x: c.cx - c.outerR,
            y: c.cy - c.outerR,
            w,
            h,
            points: starUnitPoints(n, ratio),
            closed: true,
            rotation: c.rotation ?? 0,
            fill: c.fill ?? "rgba(230, 255, 58, 0.8)",
            stroke: c.stroke ?? "rgba(230, 255, 58, 1)",
            strokeWidth: c.strokeWidth ?? 1.5,
            ...(c.name ? { name: c.name } : {}),
          });
          newIds.push(id);
          applied++;
          break;
        }
        case "addPath": {
          const id = store.addShape({
            kind: "path",
            x: c.x,
            y: c.y,
            w: c.w,
            h: c.h,
            points: c.points,
            closed: c.closed ?? false,
            rotation: c.rotation ?? 0,
            fill: c.fill ?? "transparent",
            stroke: c.stroke ?? "rgba(255, 62, 165, 0.85)",
            strokeWidth: c.strokeWidth ?? 1.5,
            ...(c.name ? { name: c.name } : {}),
          });
          newIds.push(id);
          applied++;
          break;
        }
        case "update": {
          const { action: _action, id, ...patch } = c;
          store.updateShape(id, patch as ShapePatch);
          applied++;
          break;
        }
        case "delete": {
          store.deleteShapes([c.id]);
          applied++;
          break;
        }
        case "select": {
          store.selectMany(c.ids);
          applied++;
          break;
        }
        case "clearCanvas": {
          const ids = store.shapes.map((s) => s.id);
          if (ids.length > 0) store.deleteShapes(ids);
          applied++;
          break;
        }
        case "group": {
          const id = store.groupAsFrame(c.ids);
          if (id) newIds.push(id);
          applied++;
          break;
        }
        case "ungroup": {
          store.ungroup(c.ids);
          applied++;
          break;
        }
        case "reparent": {
          store.reparent(c.id, c.parentId ?? null);
          applied++;
          break;
        }
        case "makeComponent": {
          store.toggleMainComponent(c.id);
          applied++;
          break;
        }
        case "createInstance": {
          const at =
            c.x != null && c.y != null ? { x: c.x, y: c.y } : undefined;
          const id = store.createInstance(c.mainId, at);
          if (id) newIds.push(id);
          applied++;
          break;
        }
        case "syncInstance": {
          store.syncFromMain(c.id);
          applied++;
          break;
        }
        case "detachInstance": {
          store.detachInstance(c.id);
          applied++;
          break;
        }
        case "addVariable": {
          nonShapeId = store.addVariable(c.name, c.value, c.varType);
          applied++;
          break;
        }
        case "setVariableValue": {
          store.setVariableValue(c.id, c.modeId, c.value);
          applied++;
          break;
        }
        case "addMode": {
          nonShapeId = store.addMode(c.name);
          applied++;
          break;
        }
        case "setActiveMode": {
          store.setActiveMode(c.id);
          applied++;
          break;
        }
        case "addPage": {
          nonShapeId = store.newPage(c.name);
          applied++;
          break;
        }
        case "switchPage": {
          store.switchPage(c.id);
          applied++;
          break;
        }
        case "renamePage": {
          store.renamePage(c.id, c.name);
          applied++;
          break;
        }
        case "deletePage": {
          store.deletePage(c.id);
          applied++;
          break;
        }
        case "bringToFront": {
          store.bringToFront(c.ids);
          applied++;
          break;
        }
        case "sendToBack": {
          store.sendToBack(c.ids);
          applied++;
          break;
        }
        case "duplicate": {
          const ids = store.duplicate(c.ids);
          for (const id of ids) newIds.push(id);
          applied++;
          break;
        }
      }
      if (applied > beforeApplied) {
        const addedId =
          newIds.length > beforeIds ? newIds[newIds.length - 1] : nonShapeId;
        results.push(
          addedId ? { action, ok: true, id: addedId } : { action, ok: true },
        );
      } else {
        results.push({ action, ok: false, error: `unknown action: ${action}` });
      }
    } catch (e) {
      log.warn("canvas command failed", c, e);
      results.push({
        action,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (newIds.length > 0) {
    useXDesign.getState().selectMany(newIds);
  }
  // Collapse the batch into a single undo step. If an agent turn is being
  // coalesced, collapse back to the TURN baseline instead of this batch's —
  // so multiple apply calls in one turn stay a single undo. Otherwise use the
  // per-batch snapshot. (selectMany above runs first so it can't leave a stray
  // entry behind this rewrite.)
  const after = useXDesign.getState();
  const baselinePast = after.coalesce ? after.coalesce.past : priorPast;
  const baselineShapes = after.coalesce ? after.coalesce.shapes : shapesBefore;
  const baselinePage = after.coalesce ? after.coalesce.pageId : pageBefore;
  if (after.activePageId !== baselinePage) {
    // A page op switched the active page: the baseline shapes belong to a
    // DIFFERENT page, so a collapse entry would restore them onto the wrong
    // canvas. Leave history as the ops left it (page nav isn't shape-undo)
    // and just clear redo. Page-creating batches are a hard undo boundary.
    useXDesign.setState({ future: [] });
  } else if (after.shapes !== baselineShapes) {
    useXDesign.setState({ past: [...baselinePast, baselineShapes], future: [] });
  } else {
    // Net no change vs the baseline — drop any stray entries the ops pushed.
    useXDesign.setState({
      past: baselinePast,
      future: after.coalesce ? [] : priorFuture,
    });
  }
  return { applied, newIds, results };
}
