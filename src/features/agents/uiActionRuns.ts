import { ulid } from "ulid";

const runs = new Map<string, string>();
const active = new Set<string>();

export function currentUiRun(chatId: string): string | null {
  return runs.get(chatId) ?? null;
}

export function revokeUiRun(chatId: string): void {
  const id = runs.get(chatId);
  if (id) active.delete(id);
  runs.delete(chatId);
}

export function beginUiRun(chatId: string): () => void {
  revokeUiRun(chatId);
  const id = ulid();
  runs.set(chatId, id);
  active.add(id);
  return () => {
    active.delete(id);
    if (runs.get(chatId) === id) runs.delete(chatId);
  };
}

export type UiActionLifetime = { runId?: string | null; expiresAt?: number };

export function uiActionGuard(action: UiActionLifetime): () => void {
  return () => {
    if (action.runId != null && !active.has(action.runId)) {
      throw new Error("AI turn ended or was cancelled; late UI action rejected.");
    }
    if (action.expiresAt !== undefined && (!Number.isFinite(action.expiresAt) || Date.now() >= action.expiresAt)) {
      throw new Error("UI action expired before execution; retry the tool.");
    }
  };
}
