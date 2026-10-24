// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import source from "./__fixtures__/capture2048-summary.json";
import candidate from "./__fixtures__/prepared2048.json";
import { decodeText, fromBase64 } from "./hash";
const m = vi.hoisted(() => ({ sourceList: vi.fn(), fetch: vi.fn(), cancel: vi.fn(), sourceDiscard: vi.fn(), preparedList: vi.fn(), prepare: vi.fn(), read: vi.fn(), discard: vi.fn(), confirm: vi.fn(), install: vi.fn() }));
vi.mock("./capture", () => ({ staticCaptures: { list: m.sourceList, fetch: m.fetch, cancel: m.cancel, discard: m.sourceDiscard } }));
vi.mock("./prepared", () => ({ preparedApps: { list: m.preparedList, prepare: m.prepare, read: m.read, discard: m.discard } }));
vi.mock("@/components/ConfirmModal", () => ({ confirmAction: m.confirm }));
import { StaticAppPreparation } from "./StaticAppPreparation";
import { useCommunityPlugins } from "@/store/communityPluginStore";
const manifestFile = candidate.files.find((f) => f.path === "orion-plugin.json")!;
const manifest = JSON.parse(decodeText(fromBase64(manifestFile.dataBase64, manifestFile.bytes)));
const summary = { schemaVersion: 1 as const, id: candidate.candidateId, source, pluginId: candidate.pluginId, recipeHash: candidate.recipeHash, outputHash: candidate.outputHash, totalBytes: candidate.totalBytes, createdAt: 0, inspection: { manifest, fingerprint: "a".repeat(64), fileCount: 35, totalBytes: candidate.totalBytes } };
let root: Root, host: HTMLDivElement;
const tick = () => new Promise((r) => setTimeout(r, 0));
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
const click = async (text: string) => act(async () => { button(text).click(); await tick(); });
const mount = async (strict = false) => act(async () => { root.render(strict ? <StrictMode><StaticAppPreparation /></StrictMode> : <StaticAppPreparation />); await tick(); });
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.resetAllMocks(); m.sourceList.mockResolvedValue([]); m.preparedList.mockResolvedValue([]); m.fetch.mockResolvedValue({ summary: source }); m.cancel.mockResolvedValue(undefined); m.sourceDiscard.mockResolvedValue(undefined); m.discard.mockResolvedValue(undefined); m.prepare.mockResolvedValue(summary); m.read.mockResolvedValue({ summary, candidate }); m.confirm.mockResolvedValue(true); m.install.mockResolvedValue(true); useCommunityPlugins.setState({ installed: [], hydrated: true, recoveryBlocked: false, busyIds: [], error: null, installPrepared: m.install }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("explains source and candidate capacity without eviction or automatic work", async () => {
  m.sourceList.mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ ...source, id: `source-${i}` })));
  m.preparedList.mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ ...summary, id: `candidate-${i}` })));
  await mount(); expect(host.textContent).toContain("Saved sources · 8/8"); expect(host.textContent).toContain("Source storage is full"); expect(host.textContent).toContain("Candidate storage is full");
  expect(button("Fetch pinned").disabled).toBe(true); expect(button("Prepare and save").disabled).toBe(true);
  expect(m.fetch).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.discard).not.toHaveBeenCalled();
});
it("mount reads saved records only; explicit consent precedes the pinned source fetch", async () => {
  await mount(); expect(m.fetch).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); expect(button("Fetch pinned").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await click("Fetch pinned");
  expect(m.fetch).toHaveBeenCalledOnce(); expect(m.prepare).not.toHaveBeenCalled(); expect(host.textContent).toContain("Nothing was prepared, installed or run");
});
it("saved source prepares only on explicit action, with separate saved-byte review", async () => {
  m.sourceList.mockResolvedValue([source]); await mount(); expect(m.prepare).not.toHaveBeenCalled(); await click("Prepare and save"); expect(m.prepare).toHaveBeenCalledOnce(); expect(m.read).not.toHaveBeenCalled(); await click("Review candidate"); expect(m.read).toHaveBeenCalledOnce(); expect(host.textContent).toContain("Native package fingerprint"); expect(host.textContent).toContain("installed status comes from Plugin Manager"); expect(host.querySelector("iframe")).toBeNull(); expect(host.querySelector("script")).toBeNull();
});
it("escaped code preview never executes the actual retained game scripts", async () => {
  m.sourceList.mockResolvedValue([source]); m.preparedList.mockResolvedValue([summary]); await mount(); await click("Review candidate"); await click("ui.html"); expect(host.querySelector("pre")!.textContent).toContain("<script>"); expect(host.querySelector("script")).toBeNull(); expect(host.querySelector("iframe")).toBeNull(); expect(host.textContent).toContain("no startup, background execution or workspace grants");
});
it("failed/future hydration blocks writes and explicit reload is required", async () => {
  m.preparedList.mockRejectedValueOnce(new Error("Unsupported saved version")); await mount(); expect(host.textContent).toContain("Unsupported saved version"); expect(button("Fetch pinned").disabled).toBe(true); expect(m.fetch).not.toHaveBeenCalled(); await click("Reload preparation records"); expect(host.textContent).toContain("No captured source yet");
});
it("stop cancels the exact job, ignores late results and prevents overlapping fetch", async () => {
  let finish!: (v: unknown) => void; m.fetch.mockImplementationOnce(() => new Promise((r) => { finish = r; })); await mount(); await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await click("Fetch pinned"); const job = m.fetch.mock.calls[0]![0]; await click("Stop local review"); expect(m.cancel).toHaveBeenCalledWith(job); expect(button("Reload preparation").disabled).toBe(true);
  await act(async () => { finish({ summary: source }); await tick(); }); expect(host.textContent).not.toContain(source.id); expect(host.textContent).toContain("Reload records before"); expect(m.prepare).not.toHaveBeenCalled();
});
it("unmount cancels active acquisition and never prepares from its late callback", async () => {
  let finish!: (v: unknown) => void; m.fetch.mockImplementationOnce(() => new Promise((r) => { finish = r; })); await mount(); await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await click("Fetch pinned"); await act(async () => root.render(null)); expect(m.cancel).toHaveBeenCalledWith(m.fetch.mock.calls[0]![0]); await act(async () => { finish({ summary: source }); await tick(); }); expect(m.prepare).not.toHaveBeenCalled(); expect(host.textContent).toBe("");
});
it("stopped preparation loses its publication lease; no late candidate enters review", async () => {
  let finish!: (v: unknown) => void; m.sourceList.mockResolvedValue([source]); m.prepare.mockImplementationOnce(() => new Promise((r) => { finish = r; })); await mount(); await click("Prepare and save"); const lease = m.prepare.mock.calls[0]![1]; expect(lease()).toBe(true); await click("Stop local review"); expect(lease()).toBe(false); await act(async () => { finish(summary); await tick(); }); expect(host.textContent).not.toContain("Saved candidates · 1/8"); expect(m.read).not.toHaveBeenCalled();
});
it("committed saves have no Stop action and uncertain save requires reload", async () => {
  let reject!: (e: Error) => void; m.sourceList.mockResolvedValue([source]); m.prepare.mockImplementationOnce((_s, _current, commit) => { commit(); return new Promise((_r, j) => { reject = j; }); }); await mount(); await click("Prepare and save"); expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("Stop local"))).toBe(false); await act(async () => { reject(new Error("commit unconfirmed")); await tick(); }); expect(button("Prepare and save").disabled).toBe(true); expect(host.textContent).toContain("commit unconfirmed");
});
it("discard Cancel changes nothing; separate confirmation preserves source and unrelated package lifecycle", async () => {
  m.sourceList.mockResolvedValue([source]); m.preparedList.mockResolvedValue([summary]); await mount(); expect(button("Discard source").disabled).toBe(true); m.confirm.mockResolvedValueOnce(false); await click("Discard candidate"); expect(m.discard).not.toHaveBeenCalled(); await click("Discard candidate"); expect(m.discard).toHaveBeenCalledWith(summary); expect(m.sourceDiscard).not.toHaveBeenCalled(); expect(host.textContent).toContain(source.id);
});
const approveInstall = async () => act(async () => { host.querySelector<HTMLInputElement>('[aria-label="Prepared app review"] input')!.click(); });
it("requires separate rights/permission acknowledgement and fresh revalidation before disabled installation", async () => {
  m.sourceList.mockResolvedValue([source]); m.preparedList.mockResolvedValue([summary]); await mount(); await click("Review candidate"); expect(button("Install disabled").disabled).toBe(true); await click("Install disabled"); expect(m.install).not.toHaveBeenCalled();
  await approveInstall(); await click("Install disabled"); expect(m.read).toHaveBeenCalledTimes(2); expect(m.install).toHaveBeenCalledWith({ id: summary.id, outputHash: summary.outputHash, captureHash: source.captureHash, inspection: summary.inspection }, true, expect.any(Function)); expect(host.textContent).toContain("Installed disabled. Enable explicitly in Plugin Manager");
});
it("closing/reopening candidate review resets installation acknowledgement", async () => {
  m.sourceList.mockResolvedValue([source]); m.preparedList.mockResolvedValue([summary]); await mount(); await click("Review candidate"); await approveInstall(); await click("Close candidate review"); await click("Review candidate"); expect(button("Install disabled").disabled).toBe(true); expect(m.install).not.toHaveBeenCalled();
});
it("Manager hydration/recovery/busy and installed identity are authoritative installation gates", async () => {
  m.preparedList.mockResolvedValue([summary]); await mount(); await click("Review candidate"); await act(async () => useCommunityPlugins.setState({ hydrated: false })); expect(button("Install disabled").disabled).toBe(true); expect(host.textContent).toContain("Reload Plugin Manager");
  await act(async () => useCommunityPlugins.setState({ hydrated: true, busyIds: ["other"] })); expect(button("Install disabled").disabled).toBe(true);
  await act(async () => useCommunityPlugins.setState({ busyIds: [], installed: [{ manifest, enabled: false, grantedPermissions: ["storage.plugin"], fingerprint: summary.inspection.fingerprint, installedAt: 1, quarantined: false, quarantineReason: null, workspaceHandles: [] }] })); expect(host.textContent).toContain("already installed disabled"); expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Install disabled")).toBe(false); expect(m.install).not.toHaveBeenCalled();
});
it("Stop or unmount during installation revalidation prevents native handoff of late bytes", async () => {
  m.preparedList.mockResolvedValue([summary]); await mount(); await click("Review candidate"); await approveInstall(); let finish!: (v: unknown) => void; m.read.mockImplementationOnce(() => new Promise((r) => { finish = r; })); await click("Install disabled"); await click("Stop local review"); await act(async () => { finish({ summary, candidate }); await tick(); }); expect(m.install).not.toHaveBeenCalled();
  await click("Reload preparation records"); await click("Review candidate"); await approveInstall(); m.read.mockImplementationOnce(() => new Promise((r) => { finish = r; })); await click("Install disabled"); await act(async () => root.render(null)); await act(async () => { finish({ summary, candidate }); await tick(); }); expect(m.install).not.toHaveBeenCalled();
});
it("committed disabled installation cannot be stopped/replayed; unmount suppresses only late UI callbacks", async () => {
  m.preparedList.mockResolvedValue([summary]); await mount(); await click("Review candidate"); await approveInstall(); let finish!: (v: boolean) => void; m.install.mockImplementationOnce(() => new Promise((r) => { finish = r; })); await click("Install disabled");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("Stop local"))).toBe(false); expect(button("Reload preparation").disabled).toBe(true); expect(host.textContent).toContain("Closing review cannot retract it"); await act(async () => root.render(null)); expect(m.install.mock.calls[0]![2]()).toBe(false); await act(async () => { finish(true); await tick(); }); expect(host.textContent).toBe(""); expect(m.install).toHaveBeenCalledOnce();
});
it("unconfirmed installation revokes review, blocks changes and requests Manager reload instead of retry", async () => {
  m.preparedList.mockResolvedValue([summary]); m.install.mockResolvedValueOnce(false); await mount(); await click("Review candidate"); await approveInstall(); await click("Install disabled"); expect(host.textContent).toContain("Reload Plugin Manager before retrying"); expect(button("Review candidate").disabled).toBe(true); expect(host.querySelector('[aria-label="Prepared app review"]')).toBeNull(); expect(m.install).toHaveBeenCalledOnce(); expect(button("Open Plugin Manager").disabled).toBe(false);
});
it("strict effect replay cannot let an obsolete reload unlock or overwrite the newer one", async () => {
  let finish!: (v: unknown) => void; m.sourceList.mockImplementationOnce(() => new Promise((r) => { finish = r; })).mockResolvedValueOnce([source]); await mount(true); expect(host.textContent).toContain(source.id); await act(async () => { finish([]); await tick(); }); expect(host.textContent).toContain(source.id); expect(button("Prepare and save").disabled).toBe(false);
});
