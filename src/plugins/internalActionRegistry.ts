import { OwnerRegistry } from "@/plugins/ownerRegistry";
import type { Disposable } from "@/plugins/contracts";

export type InternalActionContribution = {
  id: string;
  handle: (payload: unknown) => unknown | Promise<unknown>;
};

export type InternalActionResult =
  | { handled: false }
  | { handled: true; value: unknown };

class InternalActionRegistry {
  private readonly entries = new OwnerRegistry<InternalActionContribution>("internal action");

  register(ownerId: string, contribution: InternalActionContribution): Disposable {
    return this.entries.register(ownerId, contribution);
  }

  async dispatch(action: string, payload: unknown): Promise<InternalActionResult> {
    const contribution = this.entries.get(action);
    if (!contribution) return { handled: false };
    return { handled: true, value: await contribution.handle(payload) };
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

export const internalActionRegistry = new InternalActionRegistry();
