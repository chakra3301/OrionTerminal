import { beforeEach, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ reason: vi.fn((): string | null => null), busyIds: [] as string[] }));
vi.mock("@/store/pluginManagerStore", () => ({ pluginDisableReason: deps.reason, usePluginManager: { getState: () => ({ busyIds: deps.busyIds }) } }));
vi.mock("@/plugins/builtinApps", () => ({ BUILTIN_APP_PLUGIN_IDS: { orion: "orion", archives: "archives", xdesign: "xdesign", hermes: "hermes", command: "command" } }));
vi.mock("@/lib/db", () => ({ updateNote: vi.fn(async () => { throw new Error("disk full"); }) }));
vi.mock("@/lib/embeddingIndexer", () => ({ scheduleReindex: vi.fn() }));
vi.mock("@/components/workspace/workspaceStore", () => ({ useWorkspace: { getState: () => ({ root: {} }) }, allTabs: () => [] }));
import { useNotesStore, type Note } from "@/store/notesStore";
import { useTabsStore } from "@/store/tabsStore";
import { useXDesignSaveState, setProjectNameDraft, markProjectDirty } from "@/apps/xdesign/saveState";
import { quitRisks } from "./quitRisks";
beforeEach(() => {
  deps.reason.mockReset().mockReturnValue(null); deps.busyIds = [];
  useNotesStore.setState({ notes: new Map(), pendingWrites: new Set(), drafts: new Map(), saving: new Set(), saveErrors: new Map() });
  useTabsStore.setState({ fileBuffers: {} }); useXDesignSaveState.setState({ documents: {}, names: {} });
});
it("reads actual staged and failed note state, even after save activity ends", async () => {
  const note: Note = { id: "a", title: "Old", blocks: [], plaintext: "", parentId: null, kind: "note", location: "", collectionId: null, favorite: false, tags: [], createdAt: 1, updatedAt: 1 };
  useNotesStore.setState({ notes: new Map([["a", note]]) }); useNotesStore.getState().stageTitle("a", "Draft");
  expect(quitRisks(true).join()).toContain("1 Archives note");
  await expect(useNotesStore.getState().flushNote("a")).rejects.toThrow("disk full");
  expect(useNotesStore.getState().saving.size).toBe(0); expect(quitRisks(true).join()).toContain("1 Archives note");
});
it("detects dirty file buffers without requiring an open tab", () => {
  useTabsStore.getState().markLoaded("fixture", "old"); useTabsStore.getState().updateBuffer("fixture", "draft");
  expect(quitRisks(true).join()).toContain("1 Orion file");
});
it("detects XDesign names and documents independent of active save tasks", () => {
  setProjectNameDraft("a", { value: "draft", saving: false }); expect(quitRisks(true).join()).toContain("XDesign");
  setProjectNameDraft("a", null); markProjectDirty("b"); expect(quitRisks(true).join()).toContain("XDesign");
});
it("warns during startup/plugin transitions and includes known runtime guards", () => {
  deps.busyIds = ["a"]; deps.reason.mockReturnValue("Wait before disabling the plugin.");
  const risks = quitRisks(false); expect(risks.join()).toContain("Startup"); expect(risks.join()).toContain("plugin change");
  expect(risks).toContain("Wait before quitting."); expect(deps.reason).toHaveBeenCalledTimes(5);
});
