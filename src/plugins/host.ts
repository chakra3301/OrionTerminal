import {
  DisposableScope,
  assertPluginId,
  toDisposable,
  type InternalPlugin,
  type PluginContext,
} from "@/plugins/contracts";

export class InternalPluginHost {
  private active = new Map<string, DisposableScope>();

  activate(plugin: InternalPlugin): void {
    assertPluginId(plugin.id);
    if (this.active.has(plugin.id)) throw new Error(`plugin already active: ${plugin.id}`);
    const scope = new DisposableScope();
    const context: PluginContext = {
      pluginId: plugin.id,
      subscriptions: scope,
    };
    this.active.set(plugin.id, scope);
    try {
      const result = plugin.activate(context);
      if (result) scope.add(toDisposable(result));
    } catch (error) {
      scope.dispose();
      this.active.delete(plugin.id);
      throw error;
    }
  }

  deactivate(pluginId: string): readonly unknown[] {
    const scope = this.active.get(pluginId);
    if (!scope) return [];
    this.active.delete(pluginId);
    scope.dispose();
    return scope.errors();
  }

  isActive(pluginId: string): boolean {
    return this.active.has(pluginId);
  }

  activePluginIds(): readonly string[] {
    return Array.from(this.active.keys());
  }

  reset(): void {
    for (const id of this.activePluginIds()) this.deactivate(id);
  }
}

export const internalPluginHost = new InternalPluginHost();
