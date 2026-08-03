import { useSyncExternalStore, type ComponentType } from "react";
import { OwnerRegistry } from "@/plugins/ownerRegistry";
import type { Disposable } from "@/plugins/contracts";

export type OverlayDescriptor = {
  id: string;
  order: number;
  component: ComponentType;
};

class OverlayRegistry {
  private readonly entries = new OwnerRegistry<OverlayDescriptor>(
    "overlay",
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );

  register(ownerId: string, descriptor: OverlayDescriptor): Disposable {
    return this.entries.register(ownerId, descriptor);
  }

  list(): readonly OverlayDescriptor[] {
    return this.entries.list();
  }

  ownerOf(id: string): string | undefined {
    return this.entries.ownerOf(id);
  }

  subscribe(listener: () => void): () => void {
    return this.entries.subscribe(listener);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const overlayRegistry = new OverlayRegistry();

export function useOverlayDescriptors(): readonly OverlayDescriptor[] {
  return useSyncExternalStore(
    (listener) => overlayRegistry.subscribe(listener),
    () => overlayRegistry.list(),
    () => overlayRegistry.list(),
  );
}
