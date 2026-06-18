import type { ResolvedSend } from "./resolveSend";

/** A turn runs two passes iff a distinct Action model is set. */
export function shouldTwoPass(r: ResolvedSend): boolean {
  return !!r.actionModel && r.actionModel !== r.model;
}

const PLAN_DIRECTIVE =
  "Produce a concise, ordered execution plan as numbered steps for the request below. " +
  "Plan only — do not call tools, do not perform the work, do not write code yet. " +
  "Output just the plan.";

/** The Brain pass system prompt: the agent persona + a plan-only directive. */
export function planningSystem(agentSystemAppend: string | null): string {
  return agentSystemAppend
    ? `${agentSystemAppend}\n\n${PLAN_DIRECTIVE}`
    : PLAN_DIRECTIVE;
}

/** The Action pass prompt: the Brain's plan plus the original request. */
export function executionPrompt(userPrompt: string, plan: string): string {
  return `Execute this plan:\n${plan}\n\nOriginal request:\n${userPrompt}`;
}
