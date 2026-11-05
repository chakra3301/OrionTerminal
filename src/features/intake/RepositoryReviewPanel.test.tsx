// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ reviewRepo: vi.fn(), cancelRepo: vi.fn(), call: vi.fn() }));
vi.mock("./api", () => ({ intake: m }));
vi.mock("@/features/agents/textCall", () => ({ runExplicitModelAnalysis: m.call }));
import { RepositoryReviewPanel } from "./RepositoryReviewPanel";
import { repositoryFixture } from "./testFixture";
let host: HTMLDivElement, root: Root, fixture: Awaited<ReturnType<typeof repositoryFixture>>;
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;
const settle = () => new Promise((r) => setTimeout(r, 30));
async function click(label: string) { await act(async () => { button(label).click(); await settle(); }); }
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubGlobal("crypto", webcrypto);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture = await repositoryFixture('<img src="https://invalid.test/track">');
  m.reviewRepo.mockResolvedValue(fixture.packet); m.cancelRepo.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<RepositoryReviewPanel discovery={fixture.discovery} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function select() { await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); }
it("does not fetch on discovery or contact AI on document acquisition", async () => {
  expect(m.reviewRepo).not.toHaveBeenCalled(); expect(button("Fetch selected").disabled).toBe(true);
  await select(); await click("Fetch selected");
  expect(m.reviewRepo).toHaveBeenCalledWith(fixture.discovery.id, ["README.md"], expect.any(String));
  expect(host.querySelector("pre")?.textContent).toContain("<img"); expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("These documents cannot be installed or activated"); expect(m.call).not.toHaveBeenCalled();
});
it("shows script declarations locally as escaped inert text before any AI request", async () => {
  fixture = await repositoryFixture(JSON.stringify({ engines: { node: ">=22" }, scripts: { install: '<img src="https://invalid.test/track">' } }));
  fixture.discovery.reviewFiles![0]!.path = "package.json"; fixture.packet.files[0]!.path = "package.json";
  m.reviewRepo.mockResolvedValue(fixture.packet);
  await act(async () => root.render(<RepositoryReviewPanel discovery={fixture.discovery} />));
  await select(); await click("Fetch selected");
  expect(host.textContent).toContain("Manifest declarations · local extraction"); expect(host.textContent).toContain("scripts.install");
  expect(host.textContent).toContain("not inferred by AI"); expect(host.querySelector("img")).toBeNull(); expect(m.call).not.toHaveBeenCalled();
});
it("ignores cancelled late acquisitions", async () => {
  let finish!: (v: unknown) => void; m.reviewRepo.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await select(); await click("Fetch selected"); const id = m.reviewRepo.mock.calls[0]![2]; await click("Cancel document fetch");
  expect(m.cancelRepo).toHaveBeenCalledWith(id);
  await act(async () => { finish(fixture.packet); await settle(); });
  expect(host.querySelector('[aria-label="Advisory source analysis"]')).toBeNull(); expect(m.call).not.toHaveBeenCalled();
});
it("cancelled document acquisition cannot overlap a retry while its native request is settling", async () => {
  let finish!: (v: unknown) => void; m.reviewRepo.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await select(); await click("Fetch selected"); await click("Cancel document fetch"); expect(button("Fetch selected").disabled).toBe(true); expect(host.textContent).toContain("Stopping document fetch");
  await click("Fetch selected"); expect(m.reviewRepo).toHaveBeenCalledOnce();
  await act(async () => { finish(fixture.packet); await settle(); }); expect(button("Fetch selected").disabled).toBe(false); expect(host.querySelector('[aria-label="Advisory source analysis"]')).toBeNull();
  await click("Fetch selected"); expect(m.reviewRepo).toHaveBeenCalledTimes(2);
});
it("cancels on unmount and never mounts a late analysis view", async () => {
  let finish!: (v: unknown) => void; m.reviewRepo.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await select(); await click("Fetch selected");
  await act(async () => { root.render(<div />); await settle(); });
  expect(m.cancelRepo).toHaveBeenCalledWith(m.reviewRepo.mock.calls[0]![2]);
  await act(async () => { finish(fixture.packet); await settle(); }); expect(host.querySelector("pre")).toBeNull();
});
it("changing document selection removes the prior source and consent UI", async () => {
  await select(); await click("Fetch selected"); expect(host.querySelector('[aria-label="Advisory source analysis"]')).not.toBeNull();
  await select(); expect(host.querySelector('[aria-label="Advisory source analysis"]')).toBeNull(); expect(m.call).not.toHaveBeenCalled();
});
