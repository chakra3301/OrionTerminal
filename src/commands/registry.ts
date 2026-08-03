import { assertContributionId, assertPluginId } from "@/plugins/contracts";

export const KERNEL_PLUGIN_ID = "@orion/kernel";

export type CommandGroup =
  | "File"
  | "View"
  | "Claude"
  | "Notes"
  | "Assets"
  | "Media"
  | "Dev";

export type CommandContext = Record<string, never>;

export type Command = {
  id: string;
  label: string;
  keywords?: string[];
  hotkey?: string;
  /** When true, `hotkey` is shown in Spotlight as a hint but NOT bound by the
   * in-app HotkeyHost — an OS-level global shortcut owns it instead (so it
   * works app-unfocused, without double-firing when focused). */
  globalOnly?: boolean;
  group?: CommandGroup;
  when?: () => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
};

type Listener = () => void;

class Registry {
  private commands = new Map<string, Command>();
  private owners = new Map<string, string>();
  private tokens = new Map<string, symbol>();
  private listeners = new Set<Listener>();
  private listSnapshot: Command[] = [];
  private hotkeysSnapshot: Array<{ id: string; hotkey: string }> = [];

  register(cmd: Command, ownerId = KERNEL_PLUGIN_ID): () => void {
    assertPluginId(ownerId);
    assertContributionId(cmd.id);
    if (this.commands.has(cmd.id)) {
      throw new Error(
        `command already registered: ${cmd.id} (owned by ${this.owners.get(cmd.id)})`,
      );
    }
    const token = Symbol(cmd.id);
    this.commands.set(cmd.id, cmd);
    this.owners.set(cmd.id, ownerId);
    this.tokens.set(cmd.id, token);
    this.rebuildSnapshots();
    this.notify();
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.tokens.get(cmd.id) === token) this.unregister(cmd.id);
    };
  }

  unregister(id: string): void {
    if (!this.commands.delete(id)) return;
    this.owners.delete(id);
    this.tokens.delete(id);
    this.rebuildSnapshots();
    this.notify();
  }

  disposeOwner(ownerId: string): number {
    const ids = Array.from(this.owners)
      .filter(([, owner]) => owner === ownerId)
      .map(([id]) => id);
    if (ids.length === 0) return 0;
    for (const id of ids) {
      this.commands.delete(id);
      this.owners.delete(id);
      this.tokens.delete(id);
    }
    this.rebuildSnapshots();
    this.notify();
    return ids.length;
  }

  ownerOf(id: string): string | undefined {
    return this.owners.get(id);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  list(): Command[] {
    return this.listSnapshot;
  }

  async run(id: string, ctx: CommandContext = {} as CommandContext): Promise<void> {
    const cmd = this.commands.get(id);
    if (!cmd) throw new Error(`unknown command: ${id}`);
    if (cmd.when && !cmd.when()) {
      throw new Error(`command not available: ${id}`);
    }
    await cmd.run(ctx);
  }

  hotkeys(): Array<{ id: string; hotkey: string }> {
    return this.hotkeysSnapshot;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private rebuildSnapshots(): void {
    this.listSnapshot = Array.from(this.commands.values());
    this.hotkeysSnapshot = this.listSnapshot
      .filter((c) => Boolean(c.hotkey) && !c.globalOnly)
      .map((c) => ({ id: c.id, hotkey: c.hotkey as string }));
  }

  /** Test-only — clears all registered commands. */
  _reset(): void {
    this.commands.clear();
    this.owners.clear();
    this.tokens.clear();
    this.rebuildSnapshots();
    this.notify();
  }
}

export const registry = new Registry();
