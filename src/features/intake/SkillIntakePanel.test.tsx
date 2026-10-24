// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ open: vi.fn(), discover: vi.fn(), inspect: vi.fn(), discoverRepo: vi.fn(), inspectRepo: vi.fn(), reviewRepo: vi.fn(), cancelRepo: vi.fn(), list: vi.fn(), stage: vi.fn(), release: vi.fn(), discard: vi.fn(), read: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: m.open }));
vi.mock("./api", () => ({ intake: m }));
import { SkillIntakePanel } from "./SkillIntakePanel";
import { candidateFixture, discoveryFixture } from "./testFixture";
import { useIntakeCollection } from "./collectionStore";
import { useSkillsStore } from "@/store/skillsStore";
const repository = { url: "https://github.com/owner/repo", requestedRef: "HEAD", commit: "a".repeat(40), tree: "b".repeat(40) };
let host: HTMLDivElement, root: Root;
const tick = () => new Promise((r) => setTimeout(r, 0));
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
const click = async (text: string) => act(async () => { expect(button(text)).toBeDefined(); button(text)!.click(); await tick(); });
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  useIntakeCollection.setState({ items: [], loaded: false, error: null });
  useSkillsStore.setState({ skills: new Map(), packages: new Map(), loaded: true, error: null, mutating: false });
  m.discoverRepo.mockResolvedValue({ ...discoveryFixture, repository });
  m.inspectRepo.mockResolvedValue({ ...candidateFixture, repository }); m.cancelRepo.mockResolvedValue(undefined);
  m.open.mockResolvedValue("/physical/fixture"); m.discover.mockResolvedValue(discoveryFixture);
  m.inspect.mockResolvedValue(candidateFixture); m.list.mockResolvedValue([]); m.release.mockResolvedValue(undefined); m.discard.mockResolvedValue(undefined);
  m.stage.mockResolvedValue(candidateFixture); m.read.mockResolvedValue('<img src="https://invalid.test/track" onerror="alert(1)">');
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<SkillIntakePanel />); await tick(); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("inspects only after selection and stages only after explicit review", async () => {
  await click("Choose folder"); expect(m.inspect).not.toHaveBeenCalled(); expect(m.stage).not.toHaveBeenCalled();
  await click("Inspect selected skill"); expect(m.inspect).toHaveBeenCalledWith(discoveryFixture.id, "SKILL.md", []);
  expect(host.textContent).toContain("Tool grantsNone"); expect(m.stage).not.toHaveBeenCalled();
  await click("Keep staged snapshot"); expect(m.stage).toHaveBeenCalledWith(candidateFixture.id, candidateFixture.artifactHash);
  expect(host.textContent).toContain("Saved for review only");
});
it("renders source as escaped text with no external assets", async () => {
  await click("Choose folder"); await click("Inspect selected skill"); await click("example/DESIGN.md");
  expect(host.querySelector("pre")?.textContent).toContain("<img"); expect(host.querySelector("img")).toBeNull();
});
it("retains failed staging preview for idempotent retry", async () => {
  m.stage.mockRejectedValueOnce(new Error("Commit uncertain; reload or retry"));
  await click("Choose folder"); await click("Inspect selected skill"); await click("Keep staged snapshot");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Commit uncertain");
  expect(host.textContent).not.toContain("Saved for review only");
  await click("Keep staged snapshot"); expect(m.stage.mock.calls[0]).toEqual(m.stage.mock.calls[1]);
});
it("blocks staging while collection hydration failed and supports retry", async () => {
  m.list.mockRejectedValueOnce(new Error("Unsupported schema")); await click("Reload staged skills");
  expect(button("Choose folder")?.disabled).toBe(true);
  await click("Reload staged skills"); expect(button("Choose folder")?.disabled).toBe(false);
});
it("ignores and releases a discovery returned after cancellation", async () => {
  let finish!: (v: unknown) => void; m.discover.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await click("Choose folder"); await click("Cancel inspection");
  await act(async () => { finish(discoveryFixture); await tick(); });
  expect(button("Inspect selected skill")).toBeUndefined(); expect(m.release).toHaveBeenCalledWith(discoveryFixture.id);
});
it("cancelled picker/inspection retains its lock until settling and never opens overlapping dialogs", async () => {
  let finish!: (v: string) => void; m.open.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await click("Choose folder"); await click("Cancel inspection");
  expect(button("Choose folder")?.disabled).toBe(true); expect(button("Reload staged skills")?.disabled).toBe(true); expect(host.textContent).toContain("no overlapping inspection");
  await click("Choose folder"); expect(m.open).toHaveBeenCalledOnce();
  await act(async () => { finish("/cancelled"); await tick(); }); expect(m.discover).not.toHaveBeenCalled(); expect(button("Choose folder")?.disabled).toBe(false);
  await click("Choose folder"); expect(m.open).toHaveBeenCalledTimes(2); expect(m.discover).toHaveBeenCalledOnce();
});
it("ignores stale picker result before native access", async () => {
  let finish!: (v: string) => void; m.open.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await click("Choose folder"); await click("Cancel inspection");
  await act(async () => { finish("/late/path"); await tick(); }); expect(m.discover).not.toHaveBeenCalled();
});
it("releases late inspected snapshots on unmount without persisting them", async () => {
  let finish!: (v: unknown) => void; m.inspect.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await click("Choose folder"); await click("Inspect selected skill");
  await act(async () => { root.render(<div />); finish(candidateFixture); await tick(); });
  expect(m.release).toHaveBeenCalledWith(candidateFixture.id); expect(m.stage).not.toHaveBeenCalled();
});
it("restores saved resource previews and retains failed discards", async () => {
  m.list.mockResolvedValue([candidateFixture]); await click("Reload staged skills"); await click("example");
  await click("example/DESIGN.md"); expect(m.read).toHaveBeenCalledWith(candidateFixture.id, "example/DESIGN.md");
  m.discard.mockRejectedValueOnce(new Error("Disk unavailable")); await click("Discard snapshot");
  expect(button("Discard snapshot")).toBeDefined();
  await click("Discard snapshot"); expect(button("Discard snapshot")).toBeUndefined();
});

async function setUrl(url = "https://github.com/owner/repo.git") {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="url"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, url);
    input.dispatchEvent(new Event("input", { bubbles: true })); await tick();
  });
}
async function dropLink(text: string) {
  await act(async () => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { getData: (type: string) => type === "text/uri-list" ? text : "" } });
    host.querySelector("section")!.dispatchEvent(event); await tick();
  });
}
it("pastes a repo without fetching until explicit inspect and shows the pinned revision", async () => {
  await setUrl(); expect(m.discoverRepo).not.toHaveBeenCalled();
  await click("Inspect repository"); expect(m.discoverRepo).toHaveBeenCalledWith("https://github.com/owner/repo.git", expect.any(String));
  expect(host.textContent).toContain(repository.commit); expect(m.inspectRepo).not.toHaveBeenCalled();
  await click("Inspect selected skill"); expect(m.inspectRepo).toHaveBeenCalledWith(discoveryFixture.id, "SKILL.md", [], expect.any(String));
  expect(m.inspect).not.toHaveBeenCalled(); expect(m.stage).not.toHaveBeenCalled();
});
it("offers document review instead of an install path for repositories without skills", async () => {
  m.discoverRepo.mockResolvedValue({ ...discoveryFixture, entries: [], repository, reviewFiles: [{ path: "README.md", bytes: 20 }] });
  await setUrl(); await click("Inspect repository");
  expect(host.textContent).toContain("No SKILL.md packages found"); expect(button("Inspect selected skill")).toBeUndefined();
  expect(button("Fetch selected documents")?.disabled).toBe(true); expect(m.reviewRepo).not.toHaveBeenCalled(); expect(m.stage).not.toHaveBeenCalled();
});
it("routes the known 2048 repository to its fixed recipe without fetching or converting the inspected revision", async () => {
  m.discoverRepo.mockResolvedValue({ ...discoveryFixture, entries: [], repository: { ...repository, url: "https://github.com/gabrielecirulli/2048" } });
  await setUrl("https://github.com/gabrielecirulli/2048"); await click("Inspect repository");
  expect(host.textContent).toContain("not necessarily this resolved commit"); const target = button("Go to pinned 2048")!.getAttribute("aria-controls")!;
  const destination = [...host.querySelectorAll<HTMLDivElement>("div[id]")].find((d) => d.id === target)!;
  await click("Go to pinned 2048"); expect(destination.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(false);
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Apps");
  expect(m.inspectRepo).not.toHaveBeenCalled(); expect(m.stage).not.toHaveBeenCalled(); expect(m.reviewRepo).not.toHaveBeenCalled();
});
it("accepts a dropped URI-list and rejects multiple/hostile links before native access", async () => {
  await dropLink("https://evil.test/repo"); expect(m.discoverRepo).not.toHaveBeenCalled();
  await dropLink("https://github.com/a/b\nhttps://github.com/c/d"); expect(m.discoverRepo).not.toHaveBeenCalled();
  await dropLink("# browser link\nhttps://github.com/owner/repo.git\r\n"); expect(m.discoverRepo).toHaveBeenCalledOnce();
  expect(m.discover).not.toHaveBeenCalled();
});
it("cancels a repository request and releases any late result", async () => {
  let finish!: (value: unknown) => void; m.discoverRepo.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await setUrl(); await click("Inspect repository"); const job = m.discoverRepo.mock.calls[0]![1];
  await click("Cancel inspection"); expect(m.cancelRepo).toHaveBeenCalledWith(job);
  await act(async () => { finish({ ...discoveryFixture, repository }); await tick(); });
  expect(button("Inspect selected skill")).toBeUndefined(); expect(m.release).toHaveBeenCalledWith(discoveryFixture.id);
});
it("cancels selected-resource downloads when Incubator closes", async () => {
  let finish!: (value: unknown) => void; m.inspectRepo.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await setUrl(); await click("Inspect repository"); await click("Inspect selected skill");
  const job = m.inspectRepo.mock.calls[0]![3];
  await act(async () => { root.render(<div />); await tick(); });
  expect(m.cancelRepo).toHaveBeenCalledWith(job);
  await act(async () => { finish({ ...candidateFixture, repository }); await tick(); });
  expect(m.release).toHaveBeenCalledWith(candidateFixture.id); expect(m.stage).not.toHaveBeenCalled();
});
it("offers one visible inert-safe workspace and navigation never acquires or installs sources", async () => {
  const panels = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')]; expect(panels).toHaveLength(4);
  const tabList = host.querySelector('[role="tablist"]')!;
  expect(tabList.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  for (const label of ["Apps", "Installed skills", "Saved reviews", "Skills & repositories"]) {
    await click(label); const tab = host.querySelector('[role="tab"][aria-selected="true"]')!;
    expect(tab.textContent).toBe(label); expect(panels.filter((p) => !p.hidden)).toHaveLength(1);
    expect(panels.every((p) => p.hidden === p.hasAttribute("inert"))).toBe(true);
    expect(host.querySelector(`[id="${tab.getAttribute("aria-controls")}"]`)?.getAttribute("aria-labelledby")).toBe(tab.id);
  }
  expect(m.open).not.toHaveBeenCalled(); expect(m.discoverRepo).not.toHaveBeenCalled(); expect(m.inspect).not.toHaveBeenCalled(); expect(m.stage).not.toHaveBeenCalled();
});
it("supports roving keyboard navigation with wrapping, Home and End", async () => {
  const key = async (value: string) => act(async () => {
    host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })); await tick();
  });
  await key("ArrowLeft"); expect(document.activeElement?.textContent).toBe("Saved reviews");
  await key("Home"); expect(document.activeElement?.textContent).toBe("Skills & repositories");
  await key("ArrowRight"); expect(document.activeElement?.textContent).toBe("Apps");
  await key("End"); expect(document.activeElement?.textContent).toBe("Saved reviews");
  expect(m.discoverRepo).not.toHaveBeenCalled(); expect(m.stage).not.toHaveBeenCalled();
});
it("keeps inspected bytes, selected resource preview and discovery alive across workspace switches", async () => {
  await click("Choose folder"); await click("Inspect selected skill"); await click("example/DESIGN.md");
  const preview = host.querySelector('[aria-label="Resource text"]'); const releaseCount = m.release.mock.calls.length;
  await click("Apps"); expect(preview?.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(true);
  await click("Skills & repositories"); expect(host.querySelector('[aria-label="Resource text"]')).toBe(preview);
  expect(m.inspect).toHaveBeenCalledOnce(); expect(m.read).toHaveBeenCalledOnce(); expect(m.release).toHaveBeenCalledTimes(releaseCount); expect(m.stage).not.toHaveBeenCalled();
});
it("does not hide a parent inspection or its cancellation while switching workflows", async () => {
  let finish!: (v: string | null) => void; m.open.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await click("Choose folder"); await click("Apps");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Skills & repositories");
  expect(host.textContent).toContain("Finish or cancel the current operation"); expect(button("Cancel inspection")).toBeDefined();
  await click("Cancel inspection"); await click("Apps");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Skills & repositories");
  await act(async () => { finish(null); await tick(); }); await click("Apps");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Apps");
});
it("keeps a nested SDK picker visible until its dismissed native dialog settles", async () => {
  let finish!: (v: string | null) => void; m.open.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await click("Apps"); await click("Choose package folder"); await click("Skills & repositories");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Apps");
  expect(host.querySelector('[aria-label="Local app package intake"]')?.getAttribute("aria-busy")).toBe("true");
  await click("Dismiss inspection"); await click("Installed skills");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Apps");
  await act(async () => { finish(null); await tick(); }); await click("Installed skills");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Installed skills");
});
it("rejects source drops outside the source workflow without contacting GitHub", async () => {
  await click("Saved reviews"); await dropLink("https://github.com/owner/repo");
  expect(m.discoverRepo).not.toHaveBeenCalled(); expect(host.textContent).toContain("Open Skills & repositories");
  await click("Skills & repositories"); await dropLink("https://github.com/owner/repo"); expect(m.discoverRepo).toHaveBeenCalledOnce();
});
it("keeps Incubator and Settings on the same collection with distinct accessible IDs", async () => {
  await act(async () => { root.render(<div><SkillIntakePanel /><SkillIntakePanel /></div>); await tick(); });
  const ids = Array.from(host.querySelectorAll("[id]")).map((e) => e.id); expect(new Set(ids).size).toBe(ids.length);
  await click("Choose folder"); await click("Inspect selected skill"); await click("Keep staged snapshot");
  expect(Array.from(host.querySelectorAll("button")).filter((b) => b.textContent === "Discard snapshot")).toHaveLength(2);
  await click("Discard snapshot");
  expect(Array.from(host.querySelectorAll("button")).filter((b) => b.textContent === "Discard snapshot")).toHaveLength(0);
});
