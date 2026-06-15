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

  lspProbe: (cmd: string): Promise<boolean> => invoke<boolean>("lsp_probe", { cmd }),
  lspStart: (
    serverId: string,
    cmd: string,
    args: string[],
    root: string,
  ): Promise<void> => invoke("lsp_start", { serverId, cmd, args, root }),
  lspSend: (serverId: string, message: string): Promise<void> =>
    invoke("lsp_send", { serverId, message }),
  lspStop: (serverId: string): Promise<void> => invoke("lsp_stop", { serverId }),

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

  providerKeySet: (keyRef: string, key: string): Promise<void> =>
    invoke("provider_key_set", { keyRef, key }),
  providerKeyClear: (keyRef: string): Promise<void> =>
    invoke("provider_key_clear", { keyRef }),
  providerKeyStatus: (keyRef: string): Promise<boolean> =>
    invoke("provider_key_status", { keyRef }),

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
    systemAppend: string | null = null,
    allowedTools: string[] | null = null,
  ): Promise<void> =>
    invoke("claude_send", {
      chatId,
      prompt,
      projectRoot,
      sessionId,
      imagePath,
      model,
      systemAppend,
      allowedTools,
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

  // Learn section — one-shot subscription-CLI call. `allowWeb=true` enables
  // WebSearch so the model can find real links; `allowWeb=false` (default) is
  // tool-less and faster (graph/lesson/grade generation).
  learnClaudeCall: (
    prompt: string,
    model: string,
    allowWeb = false,
  ): Promise<{ result: string; cost: number; model: string }> =>
    invoke("learn_claude_call", { prompt, model, allowWeb }),

  // RepoLens — JSON-envelope claude call (model-parameterized), public-registry
  // fetchers, and an optional GitHub token (keychain) for higher rate limits.
  repolensClaudeCall: (
    prompt: string,
    model: string,
  ): Promise<{ result: string; cost: number; model: string }> =>
    invoke("repolens_claude_call", { prompt, model }),
  repolensFetchRepo: (
    platform: string,
    repoId: string,
  ): Promise<import("@/apps/archives/repolens/types").RepoData> =>
    invoke("repolens_fetch_repo", { platform, repoId }),
  repolensFetchSource: (
    repoId: string,
  ): Promise<import("@/apps/archives/repolens/types").RepoSource> =>
    invoke("repolens_fetch_source", { repoId }),
  githubTokenSet: (token: string): Promise<void> =>
    invoke("github_token_set", { token }),
  githubTokenClear: (): Promise<void> => invoke("github_token_clear"),
  githubTokenStatus: (): Promise<boolean> => invoke("github_token_status"),

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

  // RepoLens website rip — kick off a rip (returns the rip id); progress
  // arrives via events. Cancel/continue/delete operate on the rip id.
  repolensWebsiteRip: (
    url: string,
    model: string | null = null,
  ): Promise<string> =>
    invoke<string>("repolens_website_rip", { url, model }),
  repolensWebsiteCancel: (id: string): Promise<void> =>
    invoke("repolens_website_cancel", { id }),
  repolensWebsiteContinue: (id: string): Promise<void> =>
    invoke("repolens_website_continue", { id }),
  repolensWebsiteDelete: (id: string): Promise<void> =>
    invoke("repolens_website_delete", { id }),
  repolensWebsiteExtractDesign: (
    id: string,
    model: string | null = null,
  ): Promise<string> =>
    invoke<string>("repolens_website_extract_design", { id, model }),

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

export const learnClaudeCall = (
  prompt: string,
  model: string,
  allowWeb = false,
): Promise<{ result: string; cost: number; model: string }> =>
  ipc.learnClaudeCall(prompt, model, allowWeb);
