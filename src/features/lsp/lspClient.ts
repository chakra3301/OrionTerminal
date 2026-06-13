import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

/** Minimal JSON-RPC 2.0 client over the Rust LSP pipe (one per server).
 * Owns request/response correlation and forwards server-initiated
 * notifications (diagnostics) + requests to a handler. */
export type LspNotificationHandler = (method: string, params: unknown) => void;
export type LspServerRequestHandler = (
  method: string,
  params: unknown,
) => unknown | Promise<unknown>;

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 8000;

export class LspClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private unlistenMsg: UnlistenFn | null = null;
  private unlistenExit: UnlistenFn | null = null;
  private alive = true;

  constructor(
    readonly serverId: string,
    private onNotification: LspNotificationHandler,
    private onServerRequest: LspServerRequestHandler,
    private onExit: () => void,
  ) {}

  async attach(): Promise<void> {
    this.unlistenMsg = await listen<{ serverId: string; message: string }>(
      "lsp:message",
      (e) => {
        if (e.payload.serverId !== this.serverId) return;
        this.handleMessage(e.payload.message);
      },
    );
    this.unlistenExit = await listen<{ serverId: string }>("lsp:exit", (e) => {
      if (e.payload.serverId !== this.serverId) return;
      this.dispose();
      this.onExit();
    });
  }

  private handleMessage(raw: string): void {
    let msg: {
      id?: number | string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Response to one of our requests.
    if (msg.id !== undefined && msg.method === undefined) {
      const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? "LSP error"));
      else p.resolve(msg.result);
      return;
    }

    // Server-initiated request (expects a response; handler may be async).
    if (msg.id !== undefined && msg.method !== undefined) {
      const id = msg.id;
      void Promise.resolve(this.onServerRequest(msg.method, msg.params))
        .then((result) => this.respond(id, result))
        .catch(() => this.respond(id, null));
      return;
    }

    // Notification.
    if (msg.method !== undefined) {
      this.onNotification(msg.method, msg.params);
    }
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!this.alive) return Promise.reject(new Error("LSP client disposed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      void ipc.lspSend(this.serverId, payload).catch((e) => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.alive) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    void ipc.lspSend(this.serverId, payload).catch((e) =>
      log.warn(`lsp notify ${method} failed`, e),
    );
  }

  private async respond(id: number | string, result: unknown): Promise<void> {
    const payload = JSON.stringify({ jsonrpc: "2.0", id, result });
    await ipc.lspSend(this.serverId, payload).catch(() => {});
  }

  dispose(): void {
    this.alive = false;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("LSP client disposed"));
    }
    this.pending.clear();
    this.unlistenMsg?.();
    this.unlistenExit?.();
    this.unlistenMsg = null;
    this.unlistenExit = null;
  }
}
