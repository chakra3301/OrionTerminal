import type { CcEvent } from "@/apps/command/ccRun";
import { internalEventRegistry } from "@/plugins/internalEventRegistry";
import type { DisposableScope } from "@/plugins/contracts";
import { useCommand } from "@/store/commandStore";
import { log } from "@/lib/log";

export const COMMAND_CENTER_EVENT_IDS = {
  stream: "command-center.event.stream",
  exit: "command-center.event.exit",
} as const;

type CcEventPayload = { runId: string; event: CcEvent };
type CcExitPayload = { runId: string; code: number | null; error: string | null };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ccEvent(value: unknown): CcEvent | null {
  const event = record(value);
  if (!event || typeof event.kind !== "string") return null;
  switch (event.kind) {
    case "init":
      return typeof event.sessionId === "string"
        ? { kind: "init", sessionId: event.sessionId }
        : null;
    case "assistant":
      return typeof event.text === "string"
        ? { kind: "assistant", text: event.text }
        : null;
    case "tool_use":
      return typeof event.id === "string" && typeof event.name === "string"
        ? { kind: "tool_use", id: event.id, name: event.name, input: event.input }
        : null;
    case "tool_result":
      return typeof event.id === "string" &&
        typeof event.content === "string" &&
        typeof event.isError === "boolean"
        ? {
            kind: "tool_result",
            id: event.id,
            content: event.content,
            isError: event.isError,
          }
        : null;
    case "result":
      return typeof event.sessionId === "string" &&
        typeof event.cost === "number" &&
        Number.isFinite(event.cost)
        ? { kind: "result", sessionId: event.sessionId, cost: event.cost }
        : null;
    default:
      return null;
  }
}

function ccEventPayload(value: unknown): CcEventPayload | null {
  const payload = record(value);
  if (!payload || typeof payload.runId !== "string") return null;
  const event = ccEvent(payload.event);
  return event ? { runId: payload.runId, event } : null;
}

function ccExitPayload(value: unknown): CcExitPayload | null {
  const payload = record(value);
  if (!payload || typeof payload.runId !== "string") return null;
  if (payload.code !== null && typeof payload.code !== "number") return null;
  if (payload.error !== null && typeof payload.error !== "string") return null;
  return {
    runId: payload.runId,
    code: payload.code,
    error: payload.error,
  };
}

export function registerCommandCenterEventContributions(
  ownerId: string,
  subscriptions: DisposableScope,
): void {
  subscriptions.add(
    internalEventRegistry.register(ownerId, {
      id: COMMAND_CENTER_EVENT_IDS.stream,
      event: "cc:event",
      handle: (value) => {
        const payload = ccEventPayload(value);
        if (!payload) {
          log.warn("ignored malformed Command Center stream event");
          return;
        }
        useCommand.getState().applyRunEvent(payload.runId, payload.event);
      },
    }),
  );
  subscriptions.add(
    internalEventRegistry.register(ownerId, {
      id: COMMAND_CENTER_EVENT_IDS.exit,
      event: "cc:exit",
      handle: (value) => {
        const payload = ccExitPayload(value);
        if (!payload) {
          log.warn("ignored malformed Command Center exit event");
          return;
        }
        return useCommand
          .getState()
          .finishRun(payload.runId, payload.error ?? undefined);
      },
    }),
  );
}
