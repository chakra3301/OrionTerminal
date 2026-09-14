import { modelFor } from "./models";
import { runRepoLensModel } from "./modelCall";
import type { RepoLensModelConfig } from "./types";

const MIN_GAP_MS = 1200;

let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;

/**
 * Enqueue a provider-routed model call. All RepoLens AI calls run through this
 * single chain with a minimum gap, so a multi-call lens never starts parallel
 * subscription/API model processes.
 */
export function enqueueClaude(
  cfg: RepoLensModelConfig,
  part: string,
  prompt: string,
): Promise<string> {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
    return runRepoLensModel(prompt, modelFor(cfg, part));
  });
  chain = run.catch(() => undefined);
  return run;
}
