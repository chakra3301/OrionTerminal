// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/db", () => ({ getAppState: m.get, setAppState: m.set }));
vi.mock("@/components/ConfirmModal", () => ({ confirmAction: m.confirm }));
vi.mock("@/plugins/appRegistry", () => ({ appRegistry: { list: () => [{ id: "orion" }] }, useAppDescriptors: () => [] }));
import { IntegrationPlanComposer, IntegrationPlansPanel } from "./IntegrationPlansPanel";
import { useIntegrationPlans } from "./integrationPlansStore";
import { useIntakeCollection } from "./collectionStore";
import { useSkillsStore } from "@/store/skillsStore";
import { planningEvidence as evidence } from "./planningTestFixture";
import { createPlan } from "./integrationPlan";
import { candidateFixture } from "./testFixture";
let root: Root, host: HTMLDivElement;
const tick = () => new Promise((r) => setTimeout(r, 0));
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); m.get.mockResolvedValue(null); m.set.mockResolvedValue(undefined); m.confirm.mockResolvedValue(false);
  useIntegrationPlans.setState({ items: [], loaded: false, error: null });
  useIntakeCollection.setState({ items: [candidateFixture], loaded: true }); useSkillsStore.setState({ packages: new Map(), loaded: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("requires separate local build and save; escapes data and removes only after confirmation", async () => {
  await act(async () => { root.render(<><IntegrationPlanComposer evidence={{ ...evidence, goal: "<img src=x onerror=alert(1)>" }} /><IntegrationPlansPanel /></>); await tick(); });
  expect(m.set).not.toHaveBeenCalled();
  await act(async () => button("Build review plan").click());
  expect(host.textContent).toContain("review-available"); expect(host.querySelector("img")).toBeNull(); expect(m.set).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Integration plan handoff"]')!.value).toContain("NOT EXECUTION AUTHORIZATION");
  await act(async () => { button("Save plan locally").click(); await tick(); });
  expect(m.set).toHaveBeenCalledOnce(); expect(host.textContent).toContain("Plan saved locally");
  await act(async () => { button("Remove saved plan").click(); await tick(); }); expect(m.set).toHaveBeenCalledOnce();
  m.confirm.mockResolvedValue(true); await act(async () => { button("Remove saved plan").click(); await tick(); });
  expect(useIntegrationPlans.getState().items).toEqual([]); expect(m.set).toHaveBeenCalledTimes(2);
});
it("failed save retains the draft and allows reload/retry instead of reporting success", async () => {
  await act(async () => { root.render(<><IntegrationPlanComposer evidence={evidence} /><IntegrationPlansPanel /></>); await tick(); });
  await act(async () => button("Build review plan").click());
  m.set.mockRejectedValueOnce(new Error("disk full")); await act(async () => { button("Save plan locally").click(); await tick(); });
  expect(host.textContent).toContain("disk full"); expect(button("Save plan locally").disabled).toBe(true);
  await act(async () => { button("Reload saved plans").click(); await tick(); });
  await act(async () => { button("Save plan locally").click(); await tick(); }); expect(host.textContent).toContain("Plan saved locally");
});
it("does not remove a plan after its view unmounts during confirmation", async () => {
  const p = createPlan(evidence, evidence.host, "skill", "reuse", "");
  m.get.mockResolvedValue({ version: 1, items: [p] });
  let confirm!: (yes: boolean) => void; m.confirm.mockImplementation(() => new Promise<boolean>((r) => { confirm = r; }));
  await act(async () => { root.render(<IntegrationPlansPanel />); await tick(); });
  await act(async () => button("Remove saved plan").click());
  await act(async () => root.render(null));
  await act(async () => { confirm(true); await tick(); }); expect(m.set).not.toHaveBeenCalled();
  expect(useIntegrationPlans.getState().items).toEqual([p]);
});
it("repository target is an explicit choice and changing it discards the old draft", async () => {
  await act(async () => root.render(<IntegrationPlanComposer evidence={{ ...evidence, scope: "repository-documents", assessment: { ...evidence.assessment, strategy: "unsupported" } }} />));
  expect(button("Build review plan").disabled).toBe(true);
  await act(async () => { const select = host.querySelector("select")!; select.value = "skill"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => button("Build review plan").click()); expect(host.textContent).toContain("Current handoff: blocked");
  await act(async () => { const select = host.querySelector("select")!; select.value = "app"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector('[aria-label="Integration plan handoff"]')).toBeNull(); expect(m.set).not.toHaveBeenCalled();
});
