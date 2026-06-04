import { invoke } from "@tauri-apps/api/core";

export type TreeNode = {
  name: string;
  path: string;
  is_dir: boolean;
  children: TreeNode[] | null;
};

export type InlineEditCtxPayload = {
  path: string;
  language: string;
  selectionText: string;
  contextBefore: string;
  contextAfter: string;
};

export const ipc = {
  readDirTree: (path: string, maxDepth = 6): Promise<TreeNode> =>
    invoke<TreeNode>("read_dir_tree", { path, maxDepth }),
  readFile: (path: string): Promise<string> =>
    invoke<string>("read_file", { path }),
  readFileBase64: (path: string): Promise<string> =>
    invoke<string>("read_file_base64", { path }),
  countFiles: (path: string): Promise<number> =>
    invoke<number>("count_files", { path }),
  pathExists: (path: string): Promise<boolean> =>
    invoke<boolean>("path_exists", { path }),
  saveFileAtomic: (path: string, contents: string): Promise<void> =>
    invoke("save_file_atomic", { path, contents }),

  apiKeySet: (key: string): Promise<void> => invoke("api_key_set", { key }),
  apiKeyClear: (): Promise<void> => invoke("api_key_clear"),
  apiKeyStatus: (): Promise<boolean> => invoke<boolean>("api_key_status"),

  inlineEditRun: (
    streamId: string,
    prompt: string,
    ctx: InlineEditCtxPayload,
  ): Promise<void> => invoke("inline_edit_run", { streamId, prompt, ctx }),
  inlineEditCancel: (streamId: string): Promise<void> =>
    invoke("inline_edit_cancel", { streamId }),

  messagesChatRun: (
    chatId: string,
    system: string,
    messages: Array<{ role: "user" | "assistant"; content: unknown }>,
    tools?: unknown,
    model?: string,
  ): Promise<void> =>
    invoke("messages_chat_run", {
      chatId,
      system,
      messages,
      tools: tools ?? null,
      model: model ?? null,
    }),
  messagesChatCancel: (chatId: string): Promise<void> =>
    invoke("messages_chat_cancel", { chatId }),

  claudeSend: (
    chatId: string,
    prompt: string,
    projectRoot: string | null,
    sessionId: string | null,
    imagePath: string | null = null,
  ): Promise<void> =>
    invoke("claude_send", {
      chatId,
      prompt,
      projectRoot,
      sessionId,
      imagePath,
    }),
  claudeCancel: (chatId: string): Promise<void> =>
    invoke("claude_cancel", { chatId }),
  claudeOneshot: (prompt: string): Promise<string> =>
    invoke("claude_oneshot", { prompt }),
  claudeOneshotWithImage: (
    prompt: string,
    imagePath: string,
  ): Promise<string> =>
    invoke("claude_oneshot_with_image", { prompt, imagePath }),

  // Hermes — dispatch a task's swarm of parallel claude agents. Returns the
  // number of agents launched; progress arrives via `hermes:*` events.
  hermesDispatchTask: (
    taskId: string,
    projectRoot: string | null = null,
  ): Promise<number> =>
    invoke<number>("hermes_dispatch_task", { taskId, projectRoot }),
  hermesStopTask: (taskId: string): Promise<void> =>
    invoke("hermes_stop_task", { taskId }),
  hermesStopAgent: (agentId: string): Promise<void> =>
    invoke("hermes_stop_agent", { agentId }),

  terminalOpen: (
    ptyId: string,
    cwd: string,
    cols: number,
    rows: number,
  ): Promise<void> => invoke("terminal_open", { ptyId, cwd, cols, rows }),
  terminalOpenClaude: (
    ptyId: string,
    cwd: string,
    cols: number,
    rows: number,
  ): Promise<void> =>
    invoke("terminal_open_claude", { ptyId, cwd, cols, rows }),
  terminalWrite: (ptyId: string, data: string): Promise<void> =>
    invoke("terminal_write", { ptyId, data }),
  terminalResize: (ptyId: string, cols: number, rows: number): Promise<void> =>
    invoke("terminal_resize", { ptyId, cols, rows }),
  terminalKill: (ptyId: string): Promise<void> =>
    invoke("terminal_kill", { ptyId }),

  assetStoreFile: (
    sourcePath: string,
  ): Promise<{
    id: string;
    kind: "image" | "video" | "audio" | "doc" | "other";
    mimeType: string;
    sizeBytes: number;
    originalName: string;
    filePath: string;
  }> => invoke("asset_store_file", { sourcePath }),
  assetStoreBytes: (
    bytes: number[],
    suggestedName: string,
    mimeTypeHint: string,
  ): Promise<{
    id: string;
    kind: "image" | "video" | "audio" | "doc" | "other";
    mimeType: string;
    sizeBytes: number;
    originalName: string;
    filePath: string;
  }> =>
    invoke("asset_store_bytes", { bytes, suggestedName, mimeTypeHint }),
  assetDeleteFile: (filePath: string): Promise<void> =>
    invoke("asset_delete_file", { filePath }),
  xdesignSnapshotWrite: (bytes: number[]): Promise<string> =>
    invoke("xdesign_snapshot_write", { bytes }),
  fsWatchSetRoot: (path: string | null): Promise<void> =>
    invoke("fs_watch_set_root", { path }),
  uiBridgeRespond: (
    requestId: string,
    ok: boolean,
    data: unknown,
    error: string | null,
  ): Promise<void> =>
    invoke("ui_bridge_respond", { requestId, ok, data, error }),

  wallpaperStoreFile: (
    sourcePath: string,
  ): Promise<{ filePath: string; originalName: string }> =>
    invoke("wallpaper_store_file", { sourcePath }),
  wallpaperClearFile: (filePath: string): Promise<void> =>
    invoke("wallpaper_clear_file", { filePath }),
};
