// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn(), call: vi.fn(), save: vi.fn() }));
vi.mock("./api", () => ({ intake: { read: m.read } }));
vi.mock("@/features/agents/textCall", () => ({ runExplicitModelAnalysis: m.call }));
vi.mock("@/lib/db", () => ({ getAppState: async () => null, setAppState: m.save }));
import { PackageAnalysisPanel } from "./PackageAnalysisPanel";
import { candidateFixture } from "./testFixture";
import type { IntakeCandidate } from "./contracts";
import { useIntakeCollection } from "./collectionStore";
import { useAnalysisHistory } from "./analysisHistory";
import { useProvidersStore } from "@/store/providersStore";
import { sha256 } from "@/features/repoAnalysis/sourceText";
let host: HTMLDivElement, root: Root, candidate: IntakeCandidate;
const body = "Use DESIGN.md for layout guidance.";
const reply = { summary: '<img src="https://invalid.test/track">', mentalModel: "Text guidance", goalFit: "uncertain", strategy: "direct-skill", stackFit: "No executable runtime", integrationCost: "unknown", blockers: [], risks: [], nextSteps: ["Review manually"], limitations: ["Excerpt-only assessment"] };
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
const settle = () => new Promise((r) => setTimeout(r, 30));
const click = (text: string) => act(async () => { button(text).click(); await settle(); });
async function configure() {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[placeholder="What should this add to Orion?"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Improve design"); input.dispatchEvent(new Event("input", { bubbles: true }));
    const select = host.querySelector("select")!; select.value = "provider:chosen/model"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubGlobal("crypto", webcrypto);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  candidate = { ...candidateFixture, totalBytes: body.length, files: [{ ...candidateFixture.files[0]!, bytes: body.length, sha256: await sha256(body) }] };
  m.read.mockResolvedValue(body); m.call.mockResolvedValue(JSON.stringify(reply)); m.save.mockResolvedValue(undefined);
  useProvidersStore.setState({ providers: [{ id: "chosen", name: "Chosen", kind: "openai_compat", baseUrl: "https://chosen.invalid/v1", keyRef: "test", models: [{ id: "model", label: "Model" }], enabled: true, builtin: false }] });
  useIntakeCollection.setState({ items: [candidate], loaded: true, error: null }); useAnalysisHistory.setState({ items: [], loaded: true, error: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<PackageAnalysisPanel candidate={candidate} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("requires a reviewed payload and explicit upload approval, then saves only on request", async () => {
  expect(m.read).not.toHaveBeenCalled(); expect(m.call).not.toHaveBeenCalled();
  await configure(); await click("Prepare upload preview");
  expect(m.read).toHaveBeenCalledOnce(); expect(m.call).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="Exact analysis upload"]')?.textContent).toContain(body);
  expect(host.textContent).toContain("https://chosen.invalid"); expect(button("Analyze reviewed payload").disabled).toBe(true);
  await act(async () => { const check = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!; check.click(); });
  await click("Analyze reviewed payload"); expect(m.call).toHaveBeenCalledOnce(); expect(m.save).not.toHaveBeenCalled();
  expect(host.querySelector("img")).toBeNull(); expect(host.textContent).toContain("not installation approval");
  await click("Save assessment locally"); expect(m.save).toHaveBeenCalledWith("intake.analysis", expect.objectContaining({ version: 1 }));
});
it("invalidates review when the provider configuration changes", async () => {
  await configure(); await click("Prepare upload preview");
  await act(async () => { useProvidersStore.setState({ providers: [] }); });
  expect(host.querySelector('[aria-label="Exact analysis upload"]')).toBeNull(); expect(m.call).not.toHaveBeenCalled();
});
it("cancelled preview preparation cannot overlap another read or expose stale consent", async () => {
  let finish!: (v: string) => void; m.read.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await configure(); await click("Prepare upload preview"); await click("Cancel analysis");
  expect(button("Prepare upload preview").matches(":disabled")).toBe(true); expect(host.textContent).toContain("Stopping analysis");
  await click("Prepare upload preview"); expect(m.read).toHaveBeenCalledOnce();
  await act(async () => { finish(body); await settle(); }); expect(button("Prepare upload preview").matches(":disabled")).toBe(false); expect(host.querySelector('[aria-label="Exact analysis upload"]')).toBeNull(); expect(m.call).not.toHaveBeenCalled();
  await click("Prepare upload preview"); expect(m.read).toHaveBeenCalledTimes(2);
});
it("external recipient changes keep committed assessment saves locked until acknowledged", async () => {
  await configure(); await click("Prepare upload preview"); await act(async () => { [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!.click(); }); await click("Analyze reviewed payload");
  let finish!: () => void; m.save.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; })); await click("Save assessment locally");
  await act(async () => useProvidersStore.setState({ providers: [] })); expect(host.textContent).toContain("committed save cannot be cancelled"); expect(button("Prepare upload preview").matches(":disabled")).toBe(true);
  await act(async () => { finish(); await settle(); }); expect(useAnalysisHistory.getState().items).toHaveLength(1); expect(m.call).toHaveBeenCalledOnce();
});
it("cancel discards late model replies without persisting anything", async () => {
  let finish!: (v: string) => void; m.call.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await configure(); await click("Prepare upload preview");
  await act(async () => { [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!.click(); });
  await click("Analyze reviewed payload"); await click("Cancel analysis");
  expect(m.call.mock.calls[0]![3].signal.aborted).toBe(true);
  await act(async () => { finish(JSON.stringify(reply)); await settle(); });
  expect(button("Save assessment locally")).toBeUndefined(); expect(m.save).not.toHaveBeenCalled();
});
