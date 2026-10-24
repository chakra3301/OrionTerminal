// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), close: vi.fn() }));
vi.mock("@/store/skillsStore", () => ({ useSkillsStore: (select: (s: unknown) => unknown) => select(m) }));
vi.mock("@/store/mcpServersStore", () => ({ useMcpServers: (select: (s: unknown) => unknown) => select({ servers: [] }) }));
vi.mock("./SkillEmblem", () => ({ SkillEmblem: () => null }));
import { SkillEditor } from "./SkillEditor";
let host: HTMLDivElement, root: Root;
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = async (label: string) => act(async () => { Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)!.click(); await tick(); });
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); host = document.createElement("div"); root = createRoot(host); document.body.append(host);
  await act(async () => root.render(<SkillEditor skill={{ id: "old", name: "Original", instructions: "Keep", tools: [], icon: "", accent: "", builtin: false }} onClose={m.close} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("waits for save confirmation before closing", async () => {
  let finish!: () => void; m.save.mockImplementation(() => new Promise<void>((r) => { finish = r; }));
  await click("Save skill"); expect(m.close).not.toHaveBeenCalled(); expect(host.querySelector("fieldset")?.disabled).toBe(true);
  await act(async () => { finish(); await tick(); }); expect(m.close).toHaveBeenCalledOnce();
});
it("keeps the draft on failed persistence and allows retry", async () => {
  m.remove.mockRejectedValueOnce(new Error("Disk unavailable")); await click("Delete");
  expect(m.close).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBe("Disk unavailable");
  m.save.mockResolvedValue(undefined); await click("Save skill"); expect(m.close).toHaveBeenCalledOnce();
});
