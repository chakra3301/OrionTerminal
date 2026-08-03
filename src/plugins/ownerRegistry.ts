import {
  assertContributionId,
  assertPluginId,
  type Disposable,
} from "@/plugins/contracts";

export type OwnedContribution<T> = Readonly<{
  ownerId: string;
  id: string;
  value: T;
}>;

type Entry<T> = OwnedContribution<T> & { token: symbol };
type Listener = () => void;

export class OwnerRegistry<T extends { id: string }> {
  private entries = new Map<string, Entry<T>>();
  private listeners = new Set<Listener>();
  private valueSnapshot: readonly T[] = [];
  private ownedSnapshot: readonly OwnedContribution<T>[] = [];

  constructor(
    private readonly kind: string,
    private readonly compare?: (a: T, b: T) => number,
  ) {}

  register(ownerId: string, value: T): Disposable {
    assertPluginId(ownerId);
    assertContributionId(value.id);
    if (this.entries.has(value.id)) {
      const current = this.entries.get(value.id)!;
      throw new Error(
        `${this.kind} already registered: ${value.id} (owned by ${current.ownerId})`,
      );
    }
    const token = Symbol(value.id);
    this.entries.set(value.id, { ownerId, id: value.id, value, token });
    this.rebuild();
    this.notify();
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.unregisterToken(value.id, token);
      },
    };
  }

  unregister(id: string): boolean {
    if (!this.entries.delete(id)) return false;
    this.rebuild();
    this.notify();
    return true;
  }

  disposeOwner(ownerId: string): number {
    const ids = this.ownedSnapshot
      .filter((entry) => entry.ownerId === ownerId)
      .map((entry) => entry.id);
    if (ids.length === 0) return 0;
    for (const id of ids) this.entries.delete(id);
    this.rebuild();
    this.notify();
    return ids.length;
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.value;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  ownerOf(id: string): string | undefined {
    return this.entries.get(id)?.ownerId;
  }

  list(): readonly T[] {
    return this.valueSnapshot;
  }

  listOwned(): readonly OwnedContribution<T>[] {
    return this.ownedSnapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.rebuild();
    this.notify();
  }

  private unregisterToken(id: string, token: symbol): void {
    if (this.entries.get(id)?.token !== token) return;
    this.entries.delete(id);
    this.rebuild();
    this.notify();
  }

  private rebuild(): void {
    const entries = Array.from(this.entries.values());
    if (this.compare) entries.sort((a, b) => this.compare!(a.value, b.value));
    this.valueSnapshot = entries.map((entry) => entry.value);
    this.ownedSnapshot = entries.map(({ ownerId, id, value }) => ({
      ownerId,
      id,
      value,
    }));
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        if (typeof globalThis.reportError === "function") globalThis.reportError(error);
      }
    }
  }
}
