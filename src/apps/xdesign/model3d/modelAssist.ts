/**
 * The img2model chat-turn driver. Runs on the SAME subscription path as
 * every other embedded Claude in the terminal — the `claude` CLI subprocess
 * via `claude_send` (`--resume` for session continuity, a real file path
 * via `imagePath` for the reference image on turn 1), not a direct
 * Messages-API key. Tool execution is NOT driven from here: the CLI
 * subprocess calls the `orion_model_*` MCP tools autonomously (wired in
 * `src-tauri/src/mcp_server.rs` → `EventBridge.tsx` → `executeModelTool`),
 * exactly like the docked Design Partner's `orion_xdesign_apply`. This
 * module just sends prompts, watches the stream for text + session id, and
 * runs the bounded correction loop off the spec's own review history once a
 * turn finishes (independent of anything the model claims mid-stream).
 */

import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { ulid } from "ulid";
import { dispatchSend, dispatchCancel, forgetDispatch, selectionSupportsImages } from "@/features/agents/dispatchSend";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { log } from "@/lib/log";
import { useModelStore } from "./modelStore";
import { useModelFeed } from "./modelTranscriptFeed";
import { currentPass, passOrderFor } from "./passOrchestrator";
import { decideLoop, type LoopHistoryEntry } from "./correctionLoop";
import { beginXDesignActivity } from "../runtimeActivity";

const SYSTEM = `You are the img2model pipeline agent inside XDesign — you rebuild the object/character in a reference image as a code-only procedural Three.js model, following a staged sculpting pipeline with a self-correction loop. This is reconstruction-by-code: primitives, procedural materials, and instancing — never photogrammetry or downloaded art.

Your tools are the orion_model_* MCP tools (orion_model_get_spec, orion_model_set_object_class, orion_model_set_complexity, orion_model_set_quality_contract, orion_model_scan_zones, orion_model_add_detail, orion_model_add_material, orion_model_add_material_override, orion_model_add_component, orion_model_add_local_feature, orion_model_add_repetition_system, orion_model_set_feature_targets, orion_model_set_anatomy, orion_model_validate, orion_model_solve_camera, orion_model_extract_pbr, orion_model_project_texture, orion_model_request_render, orion_model_submit_review). Call orion_model_get_spec whenever you don't already know the current state.

# Order of operations (do not skip steps)
1. Look at the attached reference image yourself first — identify the subject, decompose macro→meso→micro, name materials in PBR terms, list identity-defining features, note what the single view hides.
2. orion_model_set_object_class — primaryDomain MUST be object|character|hybrid.
3. orion_model_set_complexity — pick a tier from observed structure (simple/moderate/complex/ultra-complex), not a guess. This sets targetMinDetails and minimumSpecDepth.
4. orion_model_set_quality_contract — replace the generic starter contract with THIS object's real definition of done ("leaf clusters must form irregular overlapping canopy masses", not "make leaves look good").
5. orion_model_scan_zones then orion_model_add_detail for every identity-defining small detail (gloss/bevel/fastener/linework/contour/seam/stitch/stain/scratch/chip/decal/emissive/hole/groove/ridge). Every detail MUST set mapsTo a real localFeature or materialOverride id — create the material/component first if needed, then the local feature/override, THEN the detail entry pointing at it.
6. orion_model_add_material for every distinct surface response (independent PBR channels — never fold color into roughness). Use orion_model_extract_pbr on a crop when you want measured evidence instead of eyeballing. For a reference-matched patterned surface (the single biggest fidelity lever), prefer orion_model_project_texture over a procedural approximation.
7. orion_model_add_component for every macro/meso/micro part. Classify topologyClass BEFORE choosing primitive. Appendages (limbs/branches/handles/tubes) MUST include 'attachment' (localStart/localEnd/contactType) or they float — this is a hard gate.
8. orion_model_add_repetition_system for any repeated small parts (rivets/leaves/scales) — always instanced, never one-off meshes.
9. orion_model_set_feature_targets — replace the starter targets with ≤5 critical + ≤3 important REAL systems, spread across the passes they matter for.
10. For a character/hybrid domain: orion_model_set_anatomy with MEASURED head-units and landmarks from the actual image (do not assume realistic proportions).
11. orion_model_validate with strict:true — fix every error before requesting a render. A validation error is cheaper to fix now than a failed review later.
12. orion_model_request_render — it returns Divine Eye's deterministic scores (silhouette IoU, scale, proportion, symmetry, pHash, SSIM, edges, objectness) as a HARD floor, plus a comparisonSheetPath. USE YOUR READ TOOL ON comparisonSheetPath TO ACTUALLY SEE the reference-vs-render comparison before deciding anything — Divine Eye is not the acceptance authority, your own vision judgment of that image is. Pass multiAngle:true during structural-pass/form-refinement for non-planar subjects (catches a flat plane faking volume).
13. orion_model_submit_review — choose exactly one: continue | refine-spec | refine-code | request-input | stop, with real per-feature scores from what you SAW in the comparison sheet. 'continue' on a visual pass needs your aiVisionScore ≥ 0.7 (or the pass's own threshold) AND every critical feature ≥ its threshold — the tool enforces this and will downgrade your action if you're wrong about it.
14. Repeat 11-13 for each locked pass in order: blockout → structural-pass → form-refinement → material-pass → surface-pass → lighting-pass → interaction-pass → optimization-pass (character/hybrid inserts proportion-lock + feature-placement right after blockout). A pass is LOCKED until the previous one gets a 'continue' — orion_model_request_render/orion_model_submit_review operate on whichever pass orion_model_get_spec.pipeline.currentPass reports.
15. Keep working through passes autonomously in this one turn where you can — you have real tool access, don't just describe what you'd do.

# Root cause discipline
refine-spec when a component/material/detail is missing or wrong, primitive family is wrong, or proportions are wrong. refine-code when the spec is right but the render doesn't match it. request-input when the image hides essential geometry or exact fidelity isn't achievable from one view — SAY SO, don't fake confidence. stop when target fidelity is reached or the user accepted the current approximation.

# Transparency
After every pass, state exactly what changed with concrete numbers/ids, and name what still doesn't match. Never claim "done" when it's only "improved". A high Divine Eye/vision score does not mean 3D realism — judge edge sharpness, cross-section thickness, and material response on the comparison sheet too, not just silhouette.

Keep spoken replies short (2-4 sentences) between tool calls — the tools and the render are the work.`;

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: string; [k: string]: unknown };

type ClaudeEvent =
  | { type: "system"; subtype?: string; session_id?: string }
  | { type: "assistant"; message?: { content?: ContentBlock[] } }
  | { type: "user"; message?: { content?: Array<{ type: string; [k: string]: unknown }> } }
  | { type: "result"; total_cost_usd?: number; session_id?: string; is_error?: boolean; errors?: string[] }
  | { type: "stderr"; text?: string }
  | { type: string; [k: string]: unknown };

type ClaudeEnvelope = { chatId: string; event: ClaudeEvent };

function extractText(content: ContentBlock[]): string {
  return content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("");
}

type TurnResult = { sessionId: string | null; isError: boolean; errorText: string | null; timedOut: boolean };

/** A single turn can legitimately run long — the system prompt tells the
 * model to autonomously push through as many passes as it can in one turn,
 * which can mean dozens of `orion_model_*` tool round-trips plus real
 * vision inspection of each comparison sheet. Generous, but not infinite —
 * past this, cancel the CLI subprocess and surface a clear error instead of
 * an indefinite spinner. */
const TURN_TIMEOUT_MS = 8 * 60_000;

/** Streams one `claude_send` turn to completion. We don't need to collect
 * tool_use blocks ourselves anymore — the CLI executes `orion_model_*` tools
 * autonomously; we only track text (for the transcript) and the session id
 * (for `--resume` continuity). */
function streamTurn(chatId: string, model: string, start: () => Promise<void>): Promise<TurnResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sessionId: string | null = null;
    let sawAssistantText = false;
    let sawAnyEvent = false;
    const unlisteners: Array<() => void> = [];
    const finish = (result?: TurnResult, err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(silenceCheck);
      for (const u of unlisteners) u();
      forgetDispatch(chatId);
      if (err) reject(err);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      void dispatchCancel(chatId, model).catch((e) => log.warn("model cancel failed", e));
      // Resolve (not reject) with `timedOut: true` — the caller needs to react
      // (drop the session; see the comment in `send()`), not just abort.
      finish({ sessionId, isError: true, errorText: `turn timed out after ${Math.round(TURN_TIMEOUT_MS / 1000)}s — cancelled`, timedOut: true });
    }, TURN_TIMEOUT_MS);
    // Diagnostic only — tells us WHERE it's stuck (never got a `system/init`
    // event at all ⇒ the claude/MCP subprocess itself never came up, vs. some
    // activity then silence ⇒ stuck inside a specific tool call).
    let silenceStreak = 0;
    const silenceCheck = setInterval(() => {
      silenceStreak += 15;
      useModelFeed.getState().push({
        kind: "assistant",
        text: sawAnyEvent
          ? `· (no activity for ${silenceStreak}s — likely mid-tool-call or the model is thinking; will time out at ${Math.round(TURN_TIMEOUT_MS / 1000)}s)`
          : `· (no response from the selected connector for ${silenceStreak}s — check Control Panel → Providers and its MCP setup)`,
      });
    }, 15_000);

    const keep = (u: () => void) => { if (settled) u(); else unlisteners.push(u); };
    const eventReady = listen<ClaudeEnvelope>("claude:event", (e) => {
      if (e.payload.chatId !== chatId || settled) return;
      if (useModelAssist.getState().chatId !== chatId) {
        finish({ sessionId, isError: true, errorText: "Cancelled", timedOut: false });
        return;
      }
      sawAnyEvent = true;
      silenceStreak = 0;
      const ev = e.payload.event;
      if (ev.type === "system" && (ev as { subtype?: string }).subtype === "init") {
        sessionId = (ev as { session_id?: string }).session_id ?? sessionId;
        return;
      }
      if (ev.type === "assistant") {
        const content = (ev as { message?: { content?: ContentBlock[] } }).message?.content;
        if (Array.isArray(content)) {
          const text = extractText(content);
          if (text) {
            sawAssistantText = true;
            useModelAssist.setState({ streaming: text });
          }
        }
        return;
      }
      if (ev.type === "result") {
        const sid = (ev as { session_id?: string }).session_id ?? sessionId;
        const isError = !!(ev as { is_error?: boolean }).is_error;
        const errors = (ev as { errors?: string[] }).errors;
        if (sawAssistantText) {
          useModelFeed.getState().push({ kind: "assistant", text: useModelAssist.getState().streaming });
        }
        finish({ sessionId: sid, isError, errorText: isError ? (errors ?? []).join("\n") || "turn failed" : null, timedOut: false });
        return;
      }
      if (ev.type === "stderr") {
        const text = (ev as { text?: string }).text;
        if (text) {
          log.warn("[img2model connector stderr]", text);
          useModelFeed.getState().push({ kind: "assistant", text: `⚠ [connector stderr] ${text}` });
        }
      }
    }).then(keep);

    const exitReady = listen<{ chatId: string; code?: number | null; error?: string | null }>("claude:exit", (e) => {
      if (e.payload.chatId === chatId && !settled) {
        const error = e.payload.error || (e.payload.code != null && e.payload.code !== 0 ? `Connector exited with code ${e.payload.code}` : null);
        finish({ sessionId, isError: !!error, errorText: error, timedOut: false });
      }
    }).then(keep);
    void Promise.all([eventReady, exitReady]).then(async () => {
      if (settled) return;
      if (useModelAssist.getState().chatId !== chatId) {
        finish({ sessionId, isError: true, errorText: "Cancelled", timedOut: false });
        return;
      }
      await start();
    }).catch((e) => finish(undefined, e instanceof Error ? e : new Error(String(e))));
  });
}

// Rounds beyond this were the other half of the "stalling" complaint: each
// round is a FULL new `claude` subprocess spawn, and nothing capped how
// many could auto-chain silently — 30 meant up to 30 sequential CLI
// invocations with no user input in between. The pipeline has 8-10 passes;
// this gives headroom for retries within a pass without runaway chaining.
const MAX_ROUNDS = 12;
let runGeneration = 0;
let activeModel = "";

type ModelAssistState = {
  open: boolean;
  busy: boolean;
  streaming: string;
  chatId: string | null;
  sessionId: string | null;
  passLoopHistory: LoopHistoryEntry[];
  currentLoopPass: string | null;
  setOpen: (open: boolean) => void;
  send: (prompt: string) => Promise<void>;
  cancel: () => void;
  clear: () => void;
};

export const useModelAssist = create<ModelAssistState>((set, get) => ({
  open: false,
  busy: false,
  streaming: "",
  chatId: null,
  sessionId: null,
  passLoopHistory: [],
  currentLoopPass: null,

  setOpen: (open) => set({ open }),
  cancel: () => {
    const id = get().chatId;
    runGeneration++;
    if (id) void dispatchCancel(id, activeModel).catch((e) => log.warn("model cancel failed", e));
    set({ busy: false, streaming: "", chatId: null, sessionId: null });
  },
  clear: () => {
    get().cancel();
    useModelFeed.getState().clear();
    set({ sessionId: null, chatId: null, streaming: "", passLoopHistory: [], currentLoopPass: null });
  },

  send: async (prompt) => {
    if (get().busy) return;
    const model = useModelPrefs.getState().modelFor("model3d");
    try {
      if (!selectionSupportsImages(model)) throw new Error("Model Assist needs vision and Orion MCP tools. Choose Claude or Codex in the model selector.");
    } catch (e) {
      useModelFeed.getState().push({ kind: "assistant", text: `⚠ ${String(e)}` });
      return;
    }
    if (activeModel !== model) set({ sessionId: null });
    activeModel = model;
    const generation = ++runGeneration;
    const reference = useModelStore.getState().reference;
    const isFirstTurn = !get().sessionId;
    if (isFirstTurn && !reference) {
      useModelFeed.getState().push({ kind: "assistant", text: "⚠ Attach a reference image first — I need something to reconstruct." });
      return;
    }

    const endActivity = beginXDesignActivity(
      "model-assist",
      "Stop or finish XDesign Model Assist before disabling the plugin.",
    );
    useModelFeed.getState().push({ kind: "user", text: prompt || "(reference image attached)" });
    set({ busy: true, streaming: "" });

    let stallRounds = 0;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const reviewCountBefore = useModelStore.getState().spec.reviewHistory.length;
        // Fresh chatId every round — conversation continuity comes from
        // `--resume <sessionId>`, not from reusing the event-routing id.
        const chatId = `img2model-${ulid()}`;
        set({ chatId });
        if (round > 0) {
          useModelFeed.getState().push({ kind: "assistant", text: `→ continuing autonomously (round ${round + 1}/${MAX_ROUNDS})…` });
        }
        const turnPrompt = isFirstTurn && round === 0
          ? `${SYSTEM}\n\n---\n\n${prompt || "Rebuild this reference as a procedural Three.js model. Follow the full staged pipeline autonomously."}`
          : round === 0
            ? prompt
            : "Continue with the next unlocked pass.";

        const result = await streamTurn(chatId, model, () => dispatchSend({
          chatId, value: model, prompt: turnPrompt,
          history: [{ role: "user", content: turnPrompt }],
          sessionId: get().sessionId,
          imagePath: isFirstTurn && round === 0 ? reference!.filePath : null,
        }));
        if (generation !== runGeneration) break;
        set({ streaming: "" });

        if (result.timedOut) {
          // Killing the subprocess mid-turn can leave its CLI session with a
          // dangling tool_use that never got a tool_result. Resuming THAT
          // session tends to re-hit the exact same hang (this is what two
          // identical "timed out after 240s" turns in a row looked like) —
          // so drop the session entirely instead of storing it. The next
          // `send()` call starts fresh (system prompt + reference image
          // reattached) and recovers spec state via orion_model_get_spec.
          set({ sessionId: null });
          useModelFeed.getState().push({
            kind: "assistant",
            text: `⚠ ${result.errorText}. Progress made so far is saved in the spec — press Send again (or type "continue") to pick up where it left off in a fresh session.`,
          });
          break;
        }
        if (result.sessionId) set({ sessionId: result.sessionId });

        if (result.isError) {
          useModelFeed.getState().push({ kind: "assistant", text: `⚠ ${result.errorText}` });
          break;
        }

        // Drive the bounded correction loop off the spec's OWN review
        // history (ground truth), not anything the model said — a turn may
        // have advanced zero, one, or several passes autonomously.
        const spec = useModelStore.getState().spec;
        const pass = currentPass(spec);
        const lastReview = spec.reviewHistory[spec.reviewHistory.length - 1];
        if (lastReview) {
          const loopPass = String(pass);
          const sameLoop = get().currentLoopPass === loopPass;
          const entry: LoopHistoryEntry = {
            fidelity: lastReview.estimatedFidelity,
            action: lastReview.action,
            mismatchSignature: lastReview.mismatches.join("|"),
          };
          const nextHistory = sameLoop ? [...get().passLoopHistory, entry] : [entry];
          set({ passLoopHistory: nextHistory, currentLoopPass: loopPass });
          const decision = decideLoop(nextHistory);
          if (decision.done && decision.reason !== "success") {
            useModelFeed.getState().push({
              kind: "loop-stop",
              reason: `bounded correction loop stopped this pass: ${decision.reason} — needs your input before continuing`,
            });
            break;
          }
        }

        if (pass === "complete") break;

        const madeProgress = useModelStore.getState().spec.reviewHistory.length > reviewCountBefore;
        stallRounds = madeProgress ? 0 : stallRounds + 1;
        if (stallRounds >= 2) {
          useModelFeed.getState().push({
            kind: "loop-stop",
            reason: "two turns in a row with no recorded review — the model may be stuck or waiting on you; check the transcript above.",
          });
          break;
        }
        // The CLI turn ended (model stopped calling tools) but the pipeline
        // isn't done — nudge it to keep going instead of leaving the user to
        // manually prompt "continue" every single pass.
      }
    } catch (e) {
      if (generation === runGeneration) {
        log.error("model assist", e);
        set({ sessionId: null });
        useModelFeed.getState().push({ kind: "assistant", text: `⚠ ${e instanceof Error ? e.message : String(e)}` });
      }
    } finally {
      if (generation === runGeneration) set({ busy: false, streaming: "", chatId: null });
      endActivity();
    }
  },
}));

export function passProgressLabel(): string {
  const spec = useModelStore.getState().spec;
  const order = passOrderFor(spec);
  const cur = currentPass(spec);
  const idx = cur === "complete" ? order.length : order.indexOf(cur);
  return `${idx}/${order.length} passes · ${cur}`;
}
