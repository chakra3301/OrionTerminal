import { ipc } from "@/lib/ipc";
import { modelFor } from "./models";
import type { RepoLensModelConfig } from "./types";

const MIN_GAP_MS = 1200;

let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;

/**
 * Enqueue a Claude call. All RepoLens AI calls run through this single chain
 * with a minimum gap, so a multi-call lens (Deep Dive = 3 calls) never spawns
 * parallel `claude` processes. Resolves the model per part from the config.
 *
 * Never call ipc.repolensClaudeCall directly from components — always via this.
 */
export function enqueueClaude(
  cfg: RepoLensModelConfig,
  part: string,
  prompt: string,
): Promise<string> {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const reply = await ipc.repolensClaudeCall(prompt, modelFor(cfg, part));
    return reply.result;
  });
  // Keep the chain alive even when a call rejects.
  chain = run.catch(() => undefined);
  return run;
}
