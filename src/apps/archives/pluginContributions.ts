import { lazy } from "react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import type { Command } from "@/commands/registry";
import { registry } from "@/commands/registry";
import type { DisposableScope } from "@/plugins/contracts";
import { overlayRegistry } from "@/plugins/overlayRegistry";
import { internalActionRegistry } from "@/plugins/internalActionRegistry";
import { internalEventRegistry } from "@/plugins/internalEventRegistry";
import { useShell } from "@/shell/store/useShell";
import {
  activeTabInFocusedPanel,
  allTabs,
  useWorkspace,
} from "@/components/workspace/workspaceStore";
import { useNotesStore } from "@/store/notesStore";
import { useAssetsStore } from "@/store/assetsStore";
import { useMoodBoardsStore } from "@/store/moodBoardsStore";
import { useCollectionsStore } from "@/store/collectionsStore";
import { useStatusStore } from "@/store/statusStore";
import { useAppChat } from "@/store/appChatStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useQuickCapture } from "@/features/notes/quickCapture";
import { useAskArchive } from "@/features/notes/askArchive";
import { useTemplatePicker } from "@/features/notes/templates";
import {
  LinkInsertPalette,
  useLinkPaletteStore,
} from "@/features/notes/LinkInsertPalette";
import { getActiveNoteEditor } from "@/features/notes/editorBridge";
import {
  noteAutoTagBusy,
  setNoteAutoTagEnabled,
} from "@/features/notes/noteAutoTag";
import {
  runEmbeddingBackfill,
  setArchivesEmbeddingEnabled,
} from "@/lib/embeddingIndexer";
import { countNotes } from "@/lib/db";
import {
  isOrionAssetWriteTool,
  isOrionMoodWriteTool,
  isOrionNoteWriteTool,
} from "@/lib/orionToolMatch";
import type { WebsiteStatus } from "@/apps/archives/repolens/repolensWebsitesDb";
import {
  archivesActivityReason,
  clearArchivesActivities,
  setArchivesActivity,
} from "@/apps/archives/runtimeActivity";
import { log } from "@/lib/log";

export const ARCHIVES_CONTRIBUTION_IDS = {
  openNoteAction: "open_note",
  toolResultEvent: "archives.event.tool-result",
  websiteEvent: "archives.event.repolens-website",
  quickCaptureOverlay: "archives.overlay.quick-capture",
  templateOverlay: "archives.overlay.template-picker",
  askOverlay: "archives.overlay.ask",
  linkOverlay: "archives.overlay.link-insert",
} as const;

const QuickCaptureHost = lazy(() =>
  import("@/apps/archives/QuickCapture").then((module) => ({
    default: module.QuickCaptureHost,
  })),
);
const TemplatePickerHost = lazy(() =>
  import("@/apps/archives/TemplatePicker").then((module) => ({
    default: module.TemplatePickerHost,
  })),
);
const AskArchiveHost = lazy(() =>
  import("@/apps/archives/AskArchive").then((module) => ({
    default: module.AskArchiveHost,
  })),
);
let notesRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let moodRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let assetsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let backfillTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNotesRefresh(): void {
  if (notesRefreshTimer) clearTimeout(notesRefreshTimer);
  notesRefreshTimer = setTimeout(() => {
    notesRefreshTimer = null;
    void useNotesStore.getState().load();
    void countNotes()
      .then((notes) => useArchives.getState().setCounts({ notes }))
      .catch(() => undefined);
  }, 250);
}

function scheduleMoodRefresh(): void {
  if (moodRefreshTimer) clearTimeout(moodRefreshTimer);
  moodRefreshTimer = setTimeout(() => {
    moodRefreshTimer = null;
    void useMoodBoardsStore.getState().load();
  }, 250);
}

function scheduleAssetsRefresh(): void {
  if (assetsRefreshTimer) clearTimeout(assetsRefreshTimer);
  assetsRefreshTimer = setTimeout(() => {
    assetsRefreshTimer = null;
    void useAssetsStore.getState().load();
  }, 250);
}

function clearBackgroundTimers(): void {
  for (const timer of [
    notesRefreshTimer,
    moodRefreshTimer,
    assetsRefreshTimer,
    backfillTimer,
  ]) {
    if (timer) clearTimeout(timer);
  }
  notesRefreshTimer = null;
  moodRefreshTimer = null;
  assetsRefreshTimer = null;
  backfillTimer = null;
}

function focusedNoteTab() {
  const workspace = useWorkspace.getState();
  return activeTabInFocusedPanel(workspace.root, workspace.focusedPanelId);
}

function archiveCommands(): Command[] {
  return [
    {
      id: "note.quickCapture",
      label: "Quick Capture",
      hotkey: "mod+shift+n",
      keywords: ["capture", "inbox", "jot", "note", "quick", "scratch"],
      group: "Notes",
      run: () => useQuickCapture.getState().show(),
    },
    {
      id: "note.askArchive",
      label: "Ask your Archive",
      hotkey: "mod+shift+a",
      keywords: ["ask", "search", "rag", "question", "find", "recall", "ai"],
      group: "Notes",
      run: () => useAskArchive.getState().show(),
    },
    {
      id: "note.newFromTemplate",
      label: "New from Template…",
      keywords: ["template", "new", "meeting", "daily", "project", "reading", "boilerplate"],
      group: "Notes",
      run: () => useTemplatePicker.getState().show(),
    },
    {
      id: "note.exportPdf",
      label: "Export Note to PDF",
      keywords: ["pdf", "export", "print", "save", "share"],
      group: "Notes",
      run: () => void import("@/features/notes/exportPdf").then((module) => module.exportOpenNoteToPdf()),
    },
    {
      id: "note.dailyNote",
      label: "Open Today's Note",
      hotkey: "mod+shift+d",
      keywords: ["daily", "today", "journal", "diary", "log"],
      group: "Notes",
      run: () => void import("@/features/notes/dailyNote").then((module) => module.openDailyNote()),
    },
    {
      id: "note.new",
      label: "New Note",
      hotkey: "mod+n",
      keywords: ["note", "new", "create", "archive"],
      group: "Notes",
      run: async () => {
        const note = await useNotesStore.getState().create(null, "note");
        useShell.getState().openApp("archives");
        useArchives.getState().setView("notes");
        useArchives.getState().setOpenNoteId(note.id);
        useStatusStore.getState().setHint("[ NEW NOTE ]", 1500);
      },
    },
    {
      id: "note.newJournal",
      label: "New Journal Entry",
      keywords: ["journal", "new", "entry", "diary", "archive"],
      group: "Notes",
      run: async () => {
        const note = await useNotesStore.getState().create(null, "journal");
        useShell.getState().openApp("archives");
        useArchives.getState().setView("journal");
        useArchives.getState().setSelectedNoteId(note.id);
        useStatusStore.getState().setHint("[ NEW JOURNAL ENTRY ]", 1500);
      },
    },
    {
      id: "note.newProject",
      label: "New Project",
      keywords: ["project", "new", "page", "notion", "archive"],
      group: "Notes",
      run: async () => {
        const note = await useNotesStore.getState().create(null, "project");
        useShell.getState().openApp("archives");
        useArchives.getState().setView("projects");
        useArchives.getState().setOpenProjectId(note.id);
        useStatusStore.getState().setHint("[ NEW PROJECT ]", 1500);
      },
    },
    {
      id: "archives.brain",
      label: "Open Brain Graph",
      keywords: ["brain", "graph", "knowledge", "links", "obsidian", "map", "archive"],
      group: "Notes",
      run: () => {
        useShell.getState().openApp("archives");
        useArchives.getState().setView("brain");
        useStatusStore.getState().setHint("[ BRAIN ]", 1500);
      },
    },
    {
      id: "mood.newBoard",
      label: "New Mood Board",
      keywords: ["mood", "board", "new", "pinterest", "archive"],
      group: "Notes",
      run: async () => {
        const board = await useMoodBoardsStore.getState().create("Untitled board");
        useShell.getState().openApp("archives");
        useArchives.getState().setView("mood");
        useArchives.getState().setOpenBoardId(board.id);
        useStatusStore.getState().setHint("[ NEW MOOD BOARD ]", 1500);
      },
    },
    {
      id: "note.delete",
      label: "Delete Note",
      keywords: ["note", "delete", "remove"],
      group: "Notes",
      when: () => focusedNoteTab()?.descriptor.kind === "note",
      run: async () => {
        const tab = focusedNoteTab();
        if (!tab || tab.descriptor.kind !== "note") return;
        const note = useNotesStore.getState().get(tab.descriptor.noteId);
        const approved = await confirmDialog(
          `Delete "${note?.title || "Untitled"}"? This cannot be undone.`,
          { title: "Delete note", kind: "warning" },
        );
        if (approved) await useNotesStore.getState().remove(tab.descriptor.noteId);
      },
    },
    {
      id: "note.linkInsert",
      label: "Insert Note Link",
      hotkey: "mod+p",
      keywords: ["link", "note", "reference"],
      group: "Notes",
      when: () => focusedNoteTab()?.descriptor.kind === "note",
      run: async () => {
        const handle = getActiveNoteEditor();
        if (!handle) return;
        const result = await useLinkPaletteStore.getState().show(handle.id);
        if (result) handle.handle.insertLink(result.href, result.text);
      },
    },
  ];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function openNoteAction(value: unknown): Promise<void> {
  const payload = record(value);
  const id = typeof payload?.id === "string" ? payload.id.trim() : "";
  if (!id || id.length > 128) throw new Error("open_note: invalid id");
  const rawKind = payload?.kind;
  const kind = rawKind === "journal" || rawKind === "project" || rawKind === "note"
    ? rawKind
    : undefined;
  await useNotesStore.getState().load();
  useShell.getState().openApp("archives");
  const archives = useArchives.getState();
  const resolvedKind = kind ?? useNotesStore.getState().notes.get(id)?.kind ?? "note";
  if (resolvedKind === "project") {
    archives.setView("projects");
    archives.setOpenProjectId(id);
  } else if (resolvedKind === "journal") {
    archives.setView("journal");
    archives.setSelectedNoteId(id);
  } else {
    archives.setView("notes");
    archives.setOpenNoteId(id);
  }
}

const WEBSITE_STATUSES = new Set<WebsiteStatus>([
  "queued",
  "running",
  "done",
  "error",
  "cancelled",
  "paused",
]);

async function websiteEvent(value: unknown): Promise<void> {
  const payload = record(value);
  if (
    !payload ||
    typeof payload.id !== "string" ||
    typeof payload.status !== "string" ||
    !WEBSITE_STATUSES.has(payload.status as WebsiteStatus) ||
    typeof payload.phase !== "string"
  ) {
    log.warn("ignored malformed RepoLens website event");
    return;
  }
  const { useRepoLensWebsites } = await import(
    "@/apps/archives/repolens/useRepoLensWebsites"
  );
  useRepoLensWebsites.getState().applyEvent({
    id: payload.id,
    status: payload.status as WebsiteStatus,
    phase: payload.phase,
    ...(typeof payload.logDelta === "string" ? { logDelta: payload.logDelta } : {}),
    ...(typeof payload.thumbnailPath === "string" ? { thumbnailPath: payload.thumbnailPath } : {}),
    ...(typeof payload.sessionId === "string" || payload.sessionId === null
      ? { sessionId: payload.sessionId }
      : {}),
  });
}

function toolResultEvent(value: unknown): void {
  const payload = record(value);
  const toolName = typeof payload?.toolName === "string" ? payload.toolName : "";
  if (!toolName) return;
  if (isOrionNoteWriteTool(toolName)) scheduleNotesRefresh();
  if (isOrionMoodWriteTool(toolName)) scheduleMoodRefresh();
  if (isOrionAssetWriteTool(toolName)) scheduleAssetsRefresh();
}

function closeNoteTabs(): void {
  const workspace = useWorkspace.getState();
  for (const tab of allTabs(workspace.root)) {
    if (tab.descriptor.kind === "note") workspace.closeTab(tab.id);
  }
}

function disposeArchivesRuntime(): void {
  clearBackgroundTimers();
  clearArchivesActivities();
  setArchivesEmbeddingEnabled(false);
  setNoteAutoTagEnabled(false);
  useQuickCapture.getState().hide();
  useAskArchive.getState().hide();
  useTemplatePicker.getState().hide();
  useLinkPaletteStore.getState().cancel();
  closeNoteTabs();
}

export function archivesDisableReason(): string | null {
  if (useAppChat.getState().threads.archives.running) {
    return "Wait for the Archives Claude response to finish before disabling the plugin.";
  }
  if (useAskArchive.getState().loading) {
    return "Wait for Ask your Archive to finish before disabling the plugin.";
  }
  if (useNotesStore.getState().pendingWrites.size > 0 || noteAutoTagBusy()) {
    return "Wait for Archives note saves and automatic tagging to finish before disabling the plugin.";
  }
  if (useAssetsStore.getState().taggingIds.size > 0) {
    return "Wait for Archives asset tagging to finish before disabling the plugin.";
  }
  return archivesActivityReason();
}

export async function refreshArchivesPluginData(): Promise<void> {
  await Promise.all([
    useNotesStore.getState().load(),
    useAssetsStore.getState().load(),
    useMoodBoardsStore.getState().load(),
    useCollectionsStore.getState().load(),
  ]);
  useArchives.getState().setCounts({
    notes: useNotesStore.getState().notes.size,
    assets: useAssetsStore.getState().assets.size,
  });
}

export async function loadArchivesPluginData(): Promise<void> {
  await refreshArchivesPluginData();
  if (backfillTimer) clearTimeout(backfillTimer);
  backfillTimer = setTimeout(() => {
    backfillTimer = null;
    void runEmbeddingBackfill().catch((error) =>
      log.warn("embedding backfill rejected", error),
    );
  }, 1500);
}

function registerActivitySources(subscriptions: DisposableScope): void {
  void Promise.all([
    import("@/apps/archives/repolens/useRepoLens"),
    import("@/apps/archives/repolens/useRepoLensWebsites"),
    import("@/apps/archives/learn/useLearn"),
  ])
    .then(([repoLensModule, websitesModule, learnModule]) => {
      if (subscriptions.isDisposed()) return;
      const syncRepoLens = () => {
        const state = repoLensModule.useRepoLens.getState();
        setArchivesActivity(
          "repolens",
          Boolean(
            state.running ||
              state.jobs.some(
                (job) => job.status === "queued" || job.status === "running",
              ),
          ),
          "Wait for RepoLens analysis to finish before disabling the plugin.",
        );
      };
      const syncWebsites = () => {
        const state = websitesModule.useRepoLensWebsites.getState();
        setArchivesActivity(
          "repolens-websites",
          state.extracting.size > 0 ||
            state.rips.some(
              (rip) => rip.status === "queued" || rip.status === "running",
            ),
          "Stop or finish RepoLens website work before disabling the plugin.",
        );
      };
      const syncLearn = () => {
        const state = learnModule.useLearn.getState();
        setArchivesActivity(
          "learn",
          state.generatingGraph || state.generatingLesson,
          "Wait for Archives Learn generation to finish before disabling the plugin.",
        );
      };
      syncRepoLens();
      syncWebsites();
      syncLearn();
      subscriptions.add(repoLensModule.useRepoLens.subscribe(syncRepoLens));
      subscriptions.add(websitesModule.useRepoLensWebsites.subscribe(syncWebsites));
      subscriptions.add(learnModule.useLearn.subscribe(syncLearn));
    })
    .catch((error) => log.warn("archives activity sources failed to load", error));
}

export function registerArchivesContributions(
  ownerId: string,
  subscriptions: DisposableScope,
): void {
  setArchivesEmbeddingEnabled(true);
  setNoteAutoTagEnabled(true);
  subscriptions.add(disposeArchivesRuntime);
  registerActivitySources(subscriptions);

  for (const command of archiveCommands()) {
    subscriptions.add(registry.register(command, ownerId));
  }

  const overlays = [
    { id: ARCHIVES_CONTRIBUTION_IDS.quickCaptureOverlay, order: 100, component: QuickCaptureHost },
    { id: ARCHIVES_CONTRIBUTION_IDS.templateOverlay, order: 110, component: TemplatePickerHost },
    { id: ARCHIVES_CONTRIBUTION_IDS.askOverlay, order: 120, component: AskArchiveHost },
    { id: ARCHIVES_CONTRIBUTION_IDS.linkOverlay, order: 130, component: LinkInsertPalette },
  ];
  for (const overlay of overlays) {
    subscriptions.add(overlayRegistry.register(ownerId, overlay));
  }

  subscriptions.add(
    internalActionRegistry.register(ownerId, {
      id: ARCHIVES_CONTRIBUTION_IDS.openNoteAction,
      handle: openNoteAction,
    }),
  );
  subscriptions.add(
    internalEventRegistry.register(ownerId, {
      id: ARCHIVES_CONTRIBUTION_IDS.toolResultEvent,
      event: "claude:tool-result",
      handle: toolResultEvent,
    }),
  );
  subscriptions.add(
    internalEventRegistry.register(ownerId, {
      id: ARCHIVES_CONTRIBUTION_IDS.websiteEvent,
      event: "repolens:website",
      handle: websiteEvent,
    }),
  );
}
