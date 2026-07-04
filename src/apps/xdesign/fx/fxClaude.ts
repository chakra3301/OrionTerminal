/**
 * Claude → shader. Streams one Messages API turn through the existing
 * `messages_chat_run` Rust command (OS-keychain key) and extracts a GLSL
 * fxMain body from the reply. No new backend surface.
 */

import { listen } from "@tauri-apps/api/event";
import { ulid } from "ulid";
import { ipc } from "@/lib/ipc";

const SYSTEM = `You write GLSL ES 3.00 fragment-shader bodies for a layer-based WebGL compositor (like Unicorn Studio).

Output EXACTLY one GLSL code block and nothing else. The block must define:
  vec4 fxMain(vec2 uv)
It may also define helper functions above fxMain.

Available (already declared — do NOT redeclare):
- sampler2D uTex — the accumulated stack below this layer; sample it for filter effects
- vec2 uResolution; float uTime; vec2 uMouse (0..1, y up)
- float u_a, u_b, u_c, u_d — user sliders 0..1, use them for tweakables
- vec3 u_colorA, u_colorB — user colors
- helpers: float fxHash21(vec2), float fxNoise2(vec2), float fxFbm(vec2), mat2 fxRotate2(float)

Rules:
- NO #version, NO precision, NO main(), NO uniform/in/out declarations.
- Return alpha < 1.0 only when the effect should composite over the stack rather than replace it.
- Correct aspect where circular shapes matter: p.x *= uResolution.x / uResolution.y.
- Keep loops bounded by constants. Prefer readable, tuned defaults.`;

/** Pull the last fenced code block (or the raw text when unfenced). */
export function extractGlslBody(reply: string): string | null {
  const fences = [...reply.matchAll(/```(?:glsl|c|cpp)?\s*\n([\s\S]*?)```/g)];
  const body = fences.length > 0
    ? fences[fences.length - 1]![1]!.trim()
    : reply.trim();
  return body.includes("fxMain") ? body : null;
}

/** One-shot generation. Rejects on stream error or when no fxMain body can
 * be extracted. */
export async function generateFxShader(
  prompt: string,
  currentCode: string,
): Promise<string> {
  const chatId = `fxshader-${ulid()}`;
  let text = "";

  const done = new Promise<void>((resolve, reject) => {
    const unlisteners: Array<() => void> = [];
    const finish = (err?: Error) => {
      for (const u of unlisteners) u();
      err ? reject(err) : resolve();
    };
    void listen<{ chatId: string; text?: string }>("chat:delta", (e) => {
      if (e.payload.chatId === chatId) text += e.payload.text ?? "";
    }).then((u) => unlisteners.push(u));
    void listen<{ chatId: string }>("chat:done", (e) => {
      if (e.payload.chatId === chatId) finish();
    }).then((u) => unlisteners.push(u));
    void listen<{ chatId: string; message: string }>("chat:error", (e) => {
      if (e.payload.chatId === chatId) finish(new Error(e.payload.message));
    }).then((u) => unlisteners.push(u));
    // Hard cap so a dropped stream can't hang the modal forever.
    setTimeout(() => finish(new Error("shader generation timed out")), 90_000);
  });

  const user = `Write an fxMain body for this request:\n\n${prompt}\n\nCurrent code (replace it entirely):\n\`\`\`glsl\n${currentCode}\n\`\`\``;
  await ipc.messagesChatRun(chatId, SYSTEM, [
    { role: "user", content: user },
  ]);
  await done;

  const body = extractGlslBody(text);
  if (!body) throw new Error("Claude's reply contained no fxMain body");
  return body;
}
