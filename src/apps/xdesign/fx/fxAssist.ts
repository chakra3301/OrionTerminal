/**
 * FX Assist — an agent that BUILDS effects, not just talks about them.
 * Claude gets a toolbox over the live FX scene (add/patch/remove layers,
 * set params, bindings, keyframes, write custom GLSL) and loops until done.
 * Custom shaders are compiled on arrival; compile errors go back as tool
 * results so the model fixes its own GLSL. Streams through the existing
 * `messages_chat_run` command — no new backend surface.
 */

import { create } from "zustand";
import { ulid } from "ulid";
import { runAgentTurn } from "@/features/agents/agentTurn";
import type { RuntimeMsg } from "@/features/agents/dispatchSend";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { beginXDesignActivity } from "../runtimeActivity";
import { log } from "@/lib/log";
import { useFxStore } from "./fxStore";
import { validateFxShader } from "./compositor";
import { FX_EFFECTS, fxEffect } from "./fxRegistry";
import {
  FX_BLEND_MODES,
  FX_BIND_SOURCES,
  FX_CUSTOM_ID,
  type FxBindSource,
  type FxBlendMode,
  type FxLayer,
  type FxParamValue,
} from "./fxModel";

// ── Tool definitions (Anthropic tool-use schema) ──────────────────────────

const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required });

export const FX_TOOLS = [
  {
    name: "fx_get_scene",
    description:
      "Read the current scene: size, background, duration, and every layer with its id, effect, params, blend, opacity, bindings, keyframes, mask.",
    input_schema: obj({}),
  },
  {
    name: "fx_add_layer",
    description:
      "Add a registry effect as a new top layer. Returns the new layer id. Layers render bottom→top; effects transform everything below them.",
    input_schema: obj(
      {
        effectId: { type: "string", description: "Registry effect id" },
        name: { type: "string" },
        params: { type: "object", description: "Param overrides (key → value)" },
        blend: { type: "string", enum: [...FX_BLEND_MODES] },
        opacity: { type: "number" },
      },
      ["effectId"],
    ),
  },
  {
    name: "fx_add_custom_shader",
    description:
      "Add a layer with YOUR OWN GLSL ES 3.00 body defining `vec4 fxMain(vec2 uv)`. Use for anything the registry can't do. Available: uTex (stack below), uTime, uMouse (0..1), uMouseSpeed (0..1), uAudio (0..1 mic loudness), uResolution, sliders u_a..u_d (0..1), colors u_colorA/u_colorB, helpers fxHash21/fxNoise2/fxFbm/fxSimplex/fxFbmS/fxRidge/fxRotate2. NO #version/precision/main/uniform declarations. The shader is compiled immediately — fix and retry on error.",
    input_schema: obj(
      {
        name: { type: "string" },
        glsl: { type: "string" },
        params: { type: "object", description: "Initial a/b/c/d/colorA/colorB values" },
      },
      ["name", "glsl"],
    ),
  },
  {
    name: "fx_set_params",
    description: "Set one or more params on a layer (values clamped to range).",
    input_schema: obj(
      { layerId: { type: "string" }, params: { type: "object" } },
      ["layerId", "params"],
    ),
  },
  {
    name: "fx_patch_layer",
    description: "Patch layer meta: name, opacity, blend, hidden, maskLayerId (a SOURCE layer id, or null to clear).",
    input_schema: obj(
      {
        layerId: { type: "string" },
        name: { type: "string" },
        opacity: { type: "number" },
        blend: { type: "string", enum: [...FX_BLEND_MODES] },
        hidden: { type: "boolean" },
        maskLayerId: { type: ["string", "null"] },
      },
      ["layerId"],
    ),
  },
  {
    name: "fx_set_binding",
    description:
      "Bind a numeric param to an input (mouseX/mouseY/mouseSpeed/hover/appear). amount −1..1 = fraction of the param range the source sweeps. source null removes the binding.",
    input_schema: obj(
      {
        layerId: { type: "string" },
        param: { type: "string" },
        source: { type: ["string", "null"], enum: [...FX_BIND_SOURCES, null] },
        amount: { type: "number" },
        smooth: { type: "number" },
      },
      ["layerId", "param"],
    ),
  },
  {
    name: "fx_add_keyframe",
    description: "Add a timeline key for a numeric param. t is 0..1 across the scene loop.",
    input_schema: obj(
      {
        layerId: { type: "string" },
        param: { type: "string" },
        t: { type: "number" },
        v: { type: "number" },
        ease: { type: "string", enum: ["linear", "inOut", "hold"] },
      },
      ["layerId", "param", "t", "v"],
    ),
  },
  {
    name: "fx_remove_layer",
    description: "Delete a layer.",
    input_schema: obj({ layerId: { type: "string" } }, ["layerId"]),
  },
  {
    name: "fx_move_layer",
    description: "Move a layer up (toward top of stack) or down.",
    input_schema: obj(
      { layerId: { type: "string" }, direction: { type: "string", enum: ["up", "down"] } },
      ["layerId", "direction"],
    ),
  },
  {
    name: "fx_set_scene",
    description: "Patch scene: background (#hex), duration (s), width, height.",
    input_schema: obj({
      background: { type: "string" },
      duration: { type: "number" },
      width: { type: "number" },
      height: { type: "number" },
    }),
  },
];

// ── System prompt (registry catalog generated live) ───────────────────────

function catalog(): string {
  return FX_EFFECTS.filter((s) => s.id !== FX_CUSTOM_ID)
    .map((s) => {
      const params = s.params
        .filter((p) => !p.hidden)
        .map((p) =>
          p.type === "number"
            ? `${p.key}(${p.min}..${p.max})`
            : p.type === "select"
              ? `${p.key}[${p.options.map((o) => o.value).join("|")}]`
              : `${p.key}:${p.type}`,
        )
        .join(" ");
      return `- ${s.id} (${s.category}) — ${s.description}. Params: ${params}`;
    })
    .join("\n");
}

export function fxAssistSystem(): string {
  const prompt = `You are FX Assist inside Orion Terminal's XDesign — an expert motion/shader designer who BUILDS by calling tools, like a Unicorn Studio power user.

The scene is a layer stack rendered bottom→top on WebGL2. Each layer is a shader pass over the accumulated result below it.

# Registry effects
${catalog()}

# Rules of craft
- Compose: base generator(s) low, sources (srcShape/srcText/srcImage) in the middle, distortion/grade effects on top.
- INTERACTIVITY IS THE POINT. Use fx_set_binding liberally (mouseX/mouseY/mouseSpeed/hover/appear/audio). Prefer mouse effects (mouseGlow, repel, lens, mouseLiquid, spotlight) for cursor feel; bind to audio when the user wants music/sound reactivity.
- Use fx_add_custom_shader for anything the registry can't express — you have full GLSL. If it returns a compile error, FIX the code and call it again.
- Blend modes matter: add/screen for light, multiply for shadow, overlay/softlight for grading.
- Timeline: scene loops over its duration; keys at t=0 and t=1 with equal values loop seamlessly.
- Only source layers (srcShape/srcText/srcImage) can be masks.
- Call fx_get_scene first when the user refers to existing layers.
- Keep spoken replies to 1–3 sentences; let the tools do the talking. Finish by telling the user what to try (e.g. "move your mouse across the canvas").`;
  return FX_TOOLS.reduce((text, tool) => text.split(tool.name).join(`orion_${tool.name}`), prompt);
}

// ── Tool executor ──────────────────────────────────────────────────────────

function clampParams(
  effectId: string,
  params: Record<string, unknown> | undefined,
): Record<string, FxParamValue> {
  const spec = fxEffect(effectId);
  const out: Record<string, FxParamValue> = {};
  if (!spec || !params) return out;
  for (const p of spec.params) {
    const v = params[p.key];
    if (v === undefined) continue;
    if (p.type === "number" && typeof v === "number") {
      out[p.key] = Math.min(p.max, Math.max(p.min, v));
    } else if (p.type === "select" && typeof v === "number") {
      out[p.key] = v;
    } else if (typeof v === "string") {
      out[p.key] = v;
    }
  }
  return out;
}

function sceneSummary(): unknown {
  const { scene } = useFxStore.getState();
  return {
    width: scene.width,
    height: scene.height,
    background: scene.background,
    duration: scene.duration,
    layers: scene.layers.map((l) => ({
      id: l.id,
      effectId: l.effectId,
      name: l.name,
      opacity: l.opacity,
      blend: l.blend ?? "normal",
      hidden: l.hidden ?? false,
      params: l.params,
      bindings: l.bindings ?? {},
      keyframes: l.keyframes ?? {},
      maskLayerId: l.maskLayerId ?? null,
    })),
  };
}

function newestLayerId(): string | null {
  const { scene, selectedLayerId } = useFxStore.getState();
  return selectedLayerId ?? scene.layers[scene.layers.length - 1]?.id ?? null;
}

/** Execute one tool call against the live store. Always returns a JSON
 * string (never throws) so the loop can hand errors back to the model. */
export function executeFxTool(name: string, input: Record<string, unknown>): string {
  const S = useFxStore.getState();
  const fail = (error: string) => JSON.stringify({ ok: false, error });
  const ok = (extra: Record<string, unknown> = {}) => JSON.stringify({ ok: true, ...extra });
  try {
    switch (name) {
      case "fx_get_scene":
        return JSON.stringify(sceneSummary());

      case "fx_add_layer": {
        const effectId = String(input.effectId ?? "");
        const spec = fxEffect(effectId);
        if (!spec) return fail(`unknown effectId "${effectId}" — see the catalog`);
        if (effectId === FX_CUSTOM_ID) return fail("use fx_add_custom_shader for custom layers");
        S.addLayer(effectId);
        const id = newestLayerId();
        if (!id) return fail("layer was not created");
        const clamped = clampParams(effectId, input.params as Record<string, unknown>);
        for (const [k, v] of Object.entries(clamped)) S.setParam(id, k, v);
        if (typeof input.name === "string" && input.name) S.patchLayer(id, { name: input.name });
        if (typeof input.opacity === "number") {
          S.patchLayer(id, { opacity: Math.min(1, Math.max(0, input.opacity)) });
        }
        if (typeof input.blend === "string" && (FX_BLEND_MODES as readonly string[]).includes(input.blend)) {
          S.patchLayer(id, { blend: input.blend as FxBlendMode });
        }
        return ok({ layerId: id });
      }

      case "fx_add_custom_shader": {
        const glsl = String(input.glsl ?? "");
        const err = validateFxShader(glsl);
        if (err) return fail(`GLSL compile error — fix and retry:\n${err}`);
        S.addLayer(FX_CUSTOM_ID);
        const id = newestLayerId();
        if (!id) return fail("layer was not created");
        S.setParam(id, "code", glsl);
        const clamped = clampParams(FX_CUSTOM_ID, input.params as Record<string, unknown>);
        for (const [k, v] of Object.entries(clamped)) {
          if (k !== "code") S.setParam(id, k, v);
        }
        S.patchLayer(id, { name: String(input.name ?? "Custom") });
        return ok({ layerId: id });
      }

      case "fx_set_params": {
        const layer = findLayer(input.layerId);
        if (!layer) return fail("unknown layerId");
        const clamped = clampParams(layer.effectId, input.params as Record<string, unknown>);
        if (Object.keys(clamped).length === 0) return fail("no valid params for this effect");
        for (const [k, v] of Object.entries(clamped)) S.setParam(layer.id, k, v);
        return ok({ set: Object.keys(clamped) });
      }

      case "fx_patch_layer": {
        const layer = findLayer(input.layerId);
        if (!layer) return fail("unknown layerId");
        if (typeof input.name === "string" && input.name) S.patchLayer(layer.id, { name: input.name });
        if (typeof input.opacity === "number") {
          S.patchLayer(layer.id, { opacity: Math.min(1, Math.max(0, input.opacity)) });
        }
        if (typeof input.hidden === "boolean") S.patchLayer(layer.id, { hidden: input.hidden });
        if (typeof input.blend === "string" && (FX_BLEND_MODES as readonly string[]).includes(input.blend)) {
          S.patchLayer(layer.id, { blend: input.blend as FxBlendMode });
        }
        if ("maskLayerId" in input) {
          const mid = input.maskLayerId;
          if (mid === null) S.setMask(layer.id, null);
          else {
            const mask = findLayer(mid);
            if (!mask || fxEffect(mask.effectId)?.category !== "source") {
              return fail("maskLayerId must be a source layer (srcShape/srcText/srcImage)");
            }
            S.setMask(layer.id, mask.id);
          }
        }
        return ok();
      }

      case "fx_set_binding": {
        const layer = findLayer(input.layerId);
        if (!layer) return fail("unknown layerId");
        const param = String(input.param ?? "");
        const spec = fxEffect(layer.effectId);
        const p = spec?.params.find((q) => q.key === param);
        if (!p || p.type !== "number") return fail(`"${param}" is not a numeric param of ${layer.effectId}`);
        if (input.source === null) {
          S.setBinding(layer.id, param, null);
          return ok({ removed: true });
        }
        const source = String(input.source ?? "");
        if (!(FX_BIND_SOURCES as readonly string[]).includes(source)) {
          return fail(`source must be one of ${FX_BIND_SOURCES.join(", ")}`);
        }
        S.setBinding(layer.id, param, {
          source: source as FxBindSource,
          amount: Math.min(1, Math.max(-1, Number(input.amount ?? 0.5))),
          smooth: Math.min(1, Math.max(0, Number(input.smooth ?? 0.3))),
        });
        return ok();
      }

      case "fx_add_keyframe": {
        const layer = findLayer(input.layerId);
        if (!layer) return fail("unknown layerId");
        const param = String(input.param ?? "");
        const spec = fxEffect(layer.effectId);
        const p = spec?.params.find((q) => q.key === param);
        if (!p || p.type !== "number") return fail(`"${param}" is not a numeric param of ${layer.effectId}`);
        const ease = input.ease === "linear" || input.ease === "hold" ? input.ease : "inOut";
        S.addKeyframe(layer.id, param, {
          t: Math.min(1, Math.max(0, Number(input.t ?? 0))),
          v: Math.min(p.max, Math.max(p.min, Number(input.v ?? p.default))),
          ease,
        });
        return ok();
      }

      case "fx_remove_layer": {
        const layer = findLayer(input.layerId);
        if (!layer) return fail("unknown layerId");
        S.removeLayer(layer.id);
        return ok();
      }

      case "fx_move_layer": {
        const layer = findLayer(input.layerId);
        if (!layer) return fail("unknown layerId");
        S.moveLayer(layer.id, input.direction === "down" ? -1 : 1);
        return ok();
      }

      case "fx_set_scene": {
        const patch: Record<string, unknown> = {};
        if (typeof input.background === "string") patch.background = input.background;
        if (typeof input.duration === "number") {
          patch.duration = Math.min(120, Math.max(0.5, input.duration));
        }
        if (typeof input.width === "number") patch.width = Math.min(4096, Math.max(16, Math.round(input.width)));
        if (typeof input.height === "number") patch.height = Math.min(4096, Math.max(16, Math.round(input.height)));
        S.patchScene(patch);
        return ok();
      }

      default:
        return fail(`unknown tool ${name}`);
    }
  } catch (e) {
    log.error("fx assist tool", name, e);
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function findLayer(id: unknown): FxLayer | undefined {
  return useFxStore.getState().scene.layers.find((l) => l.id === String(id ?? ""));
}

/** Human-readable chip for the transcript. */
export function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "fx_get_scene": return "Read scene";
    case "fx_add_layer": return `Add ${String(input.effectId ?? "layer")}`;
    case "fx_add_custom_shader": return `Write shader “${String(input.name ?? "Custom")}”`;
    case "fx_set_params": return "Tune params";
    case "fx_patch_layer": return "Adjust layer";
    case "fx_set_binding": return `Bind ${String(input.param ?? "")} ← ${String(input.source ?? "off")}`;
    case "fx_add_keyframe": return `Key ${String(input.param ?? "")}`;
    case "fx_remove_layer": return "Remove layer";
    case "fx_move_layer": return "Reorder layer";
    case "fx_set_scene": return "Scene settings";
    default: return name;
  }
}

// ── Agent loop + panel store ───────────────────────────────────────────────

export type AssistItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; label: string; ok: boolean };

let activeRequest: AbortController | null = null;
type FxAssistState = {
  open: boolean;
  busy: boolean;
  items: AssistItem[];
  streaming: string;
  history: RuntimeMsg[];
  setOpen: (open: boolean) => void;
  send: (prompt: string) => Promise<void>;
  cancel: () => void;
  clear: () => void;
  recordTool: (name: string, input: Record<string, unknown>, ok: boolean) => void;
};

export const useFxAssist = create<FxAssistState>((set, get) => ({
  open: false,
  busy: false,
  items: [],
  streaming: "",
  history: [],
  setOpen: (open) => set({ open }),
  cancel: () => {
    activeRequest?.abort();
    activeRequest = null;
    set({ busy: false, streaming: "" });
  },
  clear: () => { get().cancel(); set({ items: [], history: [] }); },
  recordTool: (name, input, ok) => set((s) => ({
    items: [...s.items, { kind: "tool", label: toolLabel(name, input), ok }],
  })),
  send: async (prompt) => {
    if (get().busy || !prompt.trim()) return;
    const controller = new AbortController();
    activeRequest = controller;
    const endActivity = beginXDesignActivity("fx-assist", "Stop FX Assist before disabling the plugin.");
    const history: RuntimeMsg[] = [...get().history, { role: "user", content: prompt }];
    set((s) => ({ busy: true, streaming: "", items: [...s.items, { kind: "user", text: prompt }], history }));
    try {
      const text = await runAgentTurn({
        chatId: `fxassist-${ulid()}`,
        value: useModelPrefs.getState().modelFor("fx"),
        prompt, history,
        extra: {
          systemAppend: fxAssistSystem(),
          allowedTools: FX_TOOLS.map((t) => `mcp__orion__orion_${t.name}`),
        },
      }, {
        signal: controller.signal,
        onText: (streaming) => { if (activeRequest === controller) set({ streaming }); },
      });
      if (activeRequest !== controller) return;
      set((s) => ({
        items: text ? [...s.items, { kind: "assistant", text }] : s.items,
        history: text ? [...s.history, { role: "assistant", content: text }] : s.history,
      }));
    } catch (e) {
      if (activeRequest !== controller) return;
      log.error("fx assist", e);
      set((s) => ({ items: [...s.items, { kind: "assistant", text: `⚠ ${String(e)}` }] }));
    } finally {
      if (activeRequest === controller) { activeRequest = null; set({ busy: false, streaming: "" }); }
      endActivity();
    }
  },
}));
