export type CommandGroup =
  | "File"
  | "View"
  | "Claude"
  | "Notes"
  | "Assets"
  | "Dev";

export type CommandContext = Record<string, never>;

export type Command = {
  id: string;
  label: string;
  keywords?: string[];
  hotkey?: string;
  group?: CommandGroup;
  when?: () => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
};

type Listener = () => void;

class Registry {
  private commands = new Map<string, Command>();
  private listeners = new Set<Listener>();
  private listSnapshot: Command[] = [];
  private hotkeysSnapshot: Array<{ id: string; hotkey: string }> = [];

  register(cmd: Command): () => void {
    if (this.commands.has(cmd.id)) {
      throw new Error(`command already registered: ${cmd.id}`);
    }
    this.commands.set(cmd.id, cmd);
    this.rebuildSnapshots();
    this.notify();
    return () => this.unregister(cmd.id);
  }

  unregister(id: string): void {
    if (this.commands.delete(id)) {
      this.rebuildSnapshots();
      this.notify();
    }
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
      .filter((c) => Boolean(c.hotkey))
      .map((c) => ({ id: c.id, hotkey: c.hotkey as string }));
  }

  /** Test-only — clears all registered commands. */
  _reset(): void {
    this.commands.clear();
    this.rebuildSnapshots();
    this.notify();
  }
}

export const registry = new Registry();
