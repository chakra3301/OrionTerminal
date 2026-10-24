// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SidebarSearch } from "./SidebarSearch";
const m = vi.hoisted(() => ({ keyword: vi.fn(), semantic: vi.fn(), route: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db", () => ({ searchArchive: m.keyword, getDb: vi.fn() }));
vi.mock("@/lib/semanticSearch", () => ({ semanticSearch: m.semantic }));
vi.mock("@/plugins/appRegistry", () => ({ appRegistry: { has: (id: string) => id === "orion" } }));
vi.mock("@/apps/archives/useArchives", () => ({ useArchives: (selector: (s: unknown) => unknown) => selector({ searchQuery: "quasar", setSearchQuery: m.query }) }));
vi.mock("@/store/assetsStore", () => ({ useAssetsStore: (selector: (s: unknown) => unknown) => selector({ assets: new Map() }) }));
vi.mock("@/apps/archives/searchNav", () => ({ routeToSearchHit: m.route }));
let host: HTMLDivElement; let root: Root;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); m.keyword.mockReset().mockResolvedValue([
    { entityId: "hidden", entityType: "chat", title: "Disabled XDesign secret", snippet: "not visible", chatOrigin: "xdesign" },
    { entityId: "shown", entityType: "chat", title: "Enabled Orion hit", snippet: "quasar", chatOrigin: "orion" },
  ]); m.semantic.mockReset().mockResolvedValue([]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<SidebarSearch />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
describe("Archives keyword-only mode", () => {
  it("does not load semantic embeddings and preserves disabled-app filtering", async () => {
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    expect(m.keyword).toHaveBeenCalled(); expect(m.semantic).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Enabled Orion hit"); expect(host.textContent).not.toContain("Disabled XDesign secret");
  });
  it("retains semantic matching as an explicit opt-in", async () => {
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    expect(m.semantic).toHaveBeenCalledWith("quasar",24,expect.any(Number));
    expect(host.textContent).toContain("Semantic matching enabled");
  });
});
