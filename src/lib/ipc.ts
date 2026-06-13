import { invoke } from "@tauri-apps/api/core";

export type TreeNode = {
  name: string;
  path: string;
  is_dir: boolean;
  children: TreeNode[] | null;
};

export type GitFileStatus = {
  path: string;
  index: string;
  worktree: string;
};

export type GitStatus = {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  is_repo: boolean;
};

export type SearchMatch = {
  line: number;
  column: number;
  preview: string;
};

export type FileMatches = {
  path: string;
  matches: SearchMatch[];
};

export type InlineEditCtxPayload = {
  path: string;
  language: string;
  selectionText: string;
  contextBefore: string;
  contextAfter: string;
  /** Cross-file snippets from the codebase semantic index. */
  extraContext?: string;
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
  searchInFiles: (
    root: string,
    query: string,
    caseSensitive = false,
    maxResults = 2000,
  ): Promise<FileMatches[]> =>
    invoke<FileMatches[]>("search_in_files", {
      root,
      query,
      caseSensitive,
      maxResults,
    }),
  createPath: (path: string, isDir: boolean): Promise<void> =>
    invoke("create_path", { path, isDir }),
  renamePath: (from: string, to: string): Promise<void> =>
    invoke("rename_path", { from, to }),
  deletePath: (path: string): Promise<void> =>
    invoke("delete_path", { path }),
  revealInOs: (path: string): Promise<void> =>
    invoke("reveal_in_os", { path }),

  gitWorkingDiff: (root: string): Promise<string> =>
    invoke<string>("git_working_diff", { root }),
  gitStatus: (root: string): Promise<GitStatus> =>
    invoke<GitStatus>("git_status", { root }),
  gitHeadContent: (root: string, path: string): Promise<string> =>
    invoke<string>("git_head_content", { root, path }),
  gitStage: (root: string, paths: string[]): Promise<void> =>
    invoke("git_stage", { root, paths }),
  gitUnstage: (root: string, paths: string[]): Promise<void> =>
    invoke("git_unstage", { root, paths }),
  gitDiscard: (root: string, paths: string[]): Promise<void> =>
    invoke("git_discard", { root, paths }),
  gitCommit: (root: string, message: string): Promise<string> =>
    invoke<string>("git_commit", { root, message }),
  gitPush: (root: string): Promise<string> => invoke<string>("git_push", { root }),
  gitBranches: (root: string): Promise<{ current: string; branches: string[] }> =>
    invoke("git_branches", { root }),
  gitCheckout: (root: string, branch: string): Promise<string> =>
    invoke<string>("git_checkout", { root, branch }),
  gitFileDiff: (root: string, path: string): Promise<string> =>
    invoke<string>("git_file_diff", { root, path }),
  gitBlameLine: (
    root: string,
    path: string,
    line: number,
  ): Promise<{ author: string; time: number; summary: string; sha: string } | null> =>
    invoke("git_blame_line", { root, path, line }),

  autocompleteRun: (ctx: {
    path: string;
    language: string;
    prefix: string;
    suffix: string;
    diagnostics?: string;
    recentEdits?: string;
  }): Promise<string> => invoke<string>("autocomplete_run", { ctx }),

  apiKeySet: (key: string): Promise<void> => invoke("api_key_set", { key }),
  apiKeyClear: (): Promise<void> => invoke("api_key_clear"),
  apiKeyStatus: (): Promise<boolean> => invoke<boolean>("api_key_status"),

  inlineEditRun: (
    streamId: string,
    prompt: string,
    ctx: InlineEditCtxPayload,
    mode?: "edit" | "ask",
  ): Promise<void> =>
    invoke("inline_edit_run", { streamId, prompt, ctx, mode: mode ?? null }),
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
    model: string | null = null,
  ): Promise<void> =>
    invoke("claude_send", {
      chatId,
      prompt,
      projectRoot,
      sessionId,
      imagePath,
      model,
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
  hermesContinueAgent: (
    agentId: string,
    projectRoot: string | null,
  ): Promise<void> =>
    invoke("hermes_continue_agent", { agentId, projectRoot }),
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

  systemStats: (): Promise<SystemStats> => invoke("system_stats"),
  claudeUsage: (): Promise<ClaudeUsage> => invoke("claude_usage"),
};

export type SystemStats = {
  cpu_percent: number;
  mem_used: number;
  mem_total: number;
  cpu_count: number;
};

export type UsageWindow = {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  cost_usd: number;
  messages: number;
};

export type ClaudeUsage = {
  block: UsageWindow;
  block_start_ms: number;
  last_24h: UsageWindow;
};
