import { OwnerRegistry } from "@/plugins/ownerRegistry";
import type { Disposable } from "@/plugins/contracts";

export type InternalEventContribution = {
  id: string;
  event: string;
  handle: (payload: unknown) => void | Promise<void>;
};

class InternalEventRegistry {
  private readonly entries = new OwnerRegistry<InternalEventContribution>("internal event");

  register(ownerId: string, contribution: InternalEventContribution): Disposable {
    const event = contribution.event.trim();
    if (!event) throw new Error("internal event name must not be empty");
    return this.entries.register(ownerId, { ...contribution, event });
  }

  dispatch(event: string, payload: unknown): void {
    for (const contribution of this.entries.list()) {
      if (contribution.event !== event) continue;
      try {
        void Promise.resolve(contribution.handle(payload)).catch(report);
      } catch (error) {
        report(error);
      }
    }
  }

  ownerOf(id: string): string | undefined {
    return this.entries.ownerOf(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  clear(): void {
    this.entries.clear();
  }
}

function report(error: unknown): void {
  if (typeof globalThis.reportError === "function") globalThis.reportError(error);
}

export const internalEventRegistry = new InternalEventRegistry();
