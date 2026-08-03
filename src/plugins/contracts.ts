export const PLUGIN_API_VERSION = "1" as const;

export const PLUGIN_PERMISSIONS = [
  "storage.plugin",
  "workspace.read",
  "workspace.write",
  "workspace.watch",
  "clipboard.read",
  "clipboard.write",
  "notifications",
  "ai.chat",
  "ai.tools.register",
  "process.git",
  "terminal.send",
  "assets.read",
  "assets.write",
] as const;

export type StaticPluginPermission = (typeof PLUGIN_PERMISSIONS)[number];
export type NetworkPluginPermission = `network:${string}`;
export type PluginPermission = StaticPluginPermission | NetworkPluginPermission;

export type Disposable = {
  dispose: () => void;
};

export type PluginContext = {
  readonly pluginId: string;
  readonly subscriptions: DisposableScope;
};

export type InternalPlugin = {
  readonly id: string;
  readonly activate: (context: PluginContext) => void | Disposable | (() => void);
};

export function toDisposable(value: Disposable | (() => void)): Disposable {
  return typeof value === "function" ? { dispose: value } : value;
}

export class DisposableScope implements Disposable {
  private items: Disposable[] = [];
  private disposed = false;
  private failures: unknown[] = [];

  add<T extends Disposable | (() => void)>(value: T): T {
    const disposable = toDisposable(value);
    if (this.disposed) {
      try {
        disposable.dispose();
      } catch (error) {
        this.failures.push(error);
      }
      return value;
    }
    this.items.push(disposable);
    return value;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      try {
        this.items[i]!.dispose();
      } catch (error) {
        this.failures.push(error);
      }
    }
    this.items = [];
  }

  errors(): readonly unknown[] {
    return this.failures;
  }

  isDisposed(): boolean {
    return this.disposed;
  }
}

const PLUGIN_ID = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?)$/;
const CONTRIBUTION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;

export function assertPluginId(id: string): void {
  if (!PLUGIN_ID.test(id)) throw new Error(`invalid plugin id: ${id}`);
}

export function assertContributionId(id: string): void {
  if (!CONTRIBUTION_ID.test(id)) throw new Error(`invalid contribution id: ${id}`);
}
