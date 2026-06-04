import { create } from "zustand";
import { ulid } from "ulid";
import { getAppState, setAppState } from "@/lib/db";
import { safeMcpName } from "@/lib/mcpName";
import { log } from "@/lib/log";

/** A claude-code MCP server config, in the shape claude expects under
 * `mcpServers[name]`. We store it verbatim so the Rust config writer can
 * merge it without translation. stdio servers use command/args/env; http
 * servers use {type:"http", url, headers}. */
export type McpServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

export type McpServer = {
  id: string;
  /** Key used in the generated mcpServers map. Must be unique + claude-safe
   * (letters/digits/underscores). */
  name: string;
  enabled: boolean;
  config: McpServerConfig;
};

type McpServersState = {
  servers: McpServer[];
  loaded: boolean;
  load: () => Promise<void>;
  addStdio: (
    name: string,
    command: string,
    args: string[],
    env: Record<string, string>,
  ) => void;
  addHttp: (name: string, url: string, headers: Record<string, string>) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
};

function persist(servers: McpServer[]): void {
  void setAppState("mcp.servers", servers).catch((e) =>
    log.warn("persist mcp servers failed", e),
  );
}

export const useMcpServers = create<McpServersState>((set, get) => ({
  servers: [],
  loaded: false,

  load: async () => {
    try {
      const rows = await getAppState<McpServer[]>("mcp.servers");
      set({ servers: Array.isArray(rows) ? rows : [], loaded: true });
    } catch (e) {
      log.warn("load mcp servers failed", e);
      set({ loaded: true });
    }
  },

  addStdio: (name, command, args, env) => {
    const n = safeMcpName(name) || `server_${get().servers.length + 1}`;
    const server: McpServer = {
      id: ulid(),
      name: n,
      enabled: true,
      config: {
        command: command.trim(),
        ...(args.length ? { args } : {}),
        ...(Object.keys(env).length ? { env } : {}),
      },
    };
    const next = [...get().servers, server];
    set({ servers: next });
    persist(next);
  },

  addHttp: (name, url, headers) => {
    const n = safeMcpName(name) || `server_${get().servers.length + 1}`;
    const server: McpServer = {
      id: ulid(),
      name: n,
      enabled: true,
      config: {
        type: "http",
        url: url.trim(),
        ...(Object.keys(headers).length ? { headers } : {}),
      },
    };
    const next = [...get().servers, server];
    set({ servers: next });
    persist(next);
  },

  toggle: (id) => {
    const next = get().servers.map((s) =>
      s.id === id ? { ...s, enabled: !s.enabled } : s,
    );
    set({ servers: next });
    persist(next);
  },

  remove: (id) => {
    const next = get().servers.filter((s) => s.id !== id);
    set({ servers: next });
    persist(next);
  },
}));
