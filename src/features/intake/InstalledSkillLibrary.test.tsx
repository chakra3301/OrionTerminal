// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn(), change: vi.fn(), confirm: vi.fn() }));
vi.mock("./installedApi", () => ({ installedSkills: { read: m.read } }));
vi.mock("@/components/ConfirmModal", () => ({ confirmAction: m.confirm }));
import { SkillInstallReview, InstalledSkillLibrary } from "./InstalledSkillLibrary";
import { SkillTurnPicker } from "./SkillTurnPicker";
import { useSkillsStore } from "@/store/skillsStore";
import { useAgentsStore } from "@/store/agentsStore";
import { candidateFixture } from "./testFixture";
import { EMPTY_SKILL_CHOICE } from "./skillActivation";
import type { InstalledSkill } from "./contracts";
const candidate = { ...candidateFixture, totalBytes: 23, files: [...candidateFixture.files, { path: "example/LICENSE", sourcePath: "LICENSE", bytes: 3, sha256: "e".repeat(64), sourceMode: 0o100644, kind: "attribution" as const }] };
const installed: InstalledSkill = { skillId: `imported:${candidate.id}`, active: candidate, versions: [candidate], enabled: true };
let root: Root, host: HTMLDivElement;
const tick = () => new Promise((r) => setTimeout(r, 0));
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); m.read.mockResolvedValue('<script>untrusted</script>'); m.change.mockResolvedValue(undefined); m.confirm.mockResolvedValue(false);
  useSkillsStore.setState({ packages: new Map([[installed.skillId, installed]]), loaded: true, error: null, mutating: false, changePackage: m.change });
  useAgentsStore.setState({ agents: new Map() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("installation is separate from staging and requires source rights acknowledgement", async () => {
  const install = vi.fn();
  await act(async () => root.render(<SkillInstallReview candidate={candidate} disabled={false} onInstall={install} />));
  expect(install).not.toHaveBeenCalled(); expect(button("Install in Skill Codex").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => button("Install in Skill Codex").click());
  expect(install).toHaveBeenCalledWith(null, true);
});
it("changed candidate bytes invalidate an earlier acknowledgement", async () => {
  const install = vi.fn();
  await act(async () => root.render(<SkillInstallReview candidate={candidate} disabled={false} onInstall={install} />));
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => root.render(<SkillInstallReview candidate={{ ...candidate, artifactHash: "f".repeat(64) }} disabled={false} onInstall={install} />));
  expect(button("Install in Skill Codex").disabled).toBe(true); expect(install).not.toHaveBeenCalled();
});
it("missing attribution remains unavailable despite acknowledgement", async () => {
  const install = vi.fn();
  await act(async () => root.render(<SkillInstallReview candidate={candidateFixture} disabled={false} onInstall={install} />));
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(button("Install in Skill Codex").disabled).toBe(true); expect(host.textContent).toContain("Include LICENSE/NOTICE");
});
it("installed resources are escaped, and removal does nothing when confirmation is cancelled", async () => {
  await act(async () => root.render(<InstalledSkillLibrary />));
  await act(async () => { button("example/DESIGN.md").click(); await tick(); });
  expect(host.querySelector("pre")?.textContent).toContain("<script>"); expect(host.querySelector("script")).toBeNull();
  expect(m.read).toHaveBeenCalledWith(installed.skillId, candidate.id, "example/DESIGN.md");
  await act(async () => { button("Remove imported skill").click(); await tick(); });
  expect(m.confirm).toHaveBeenCalledOnce(); expect(m.change).not.toHaveBeenCalled();
});
it("update selection compares versions, excludes other sources and invalidates prior review", async () => {
  const install = vi.fn();
  const incoming = { ...candidate, artifactHash: "f".repeat(64), files: candidate.files.map((f) => f.kind === "attribution" ? { ...f, sha256: "b".repeat(64) } : f) };
  const other = { ...installed, skillId: "imported:other", active: { ...candidate, sourceLabel: "unrelated source" } };
  useSkillsStore.setState({ packages: new Map([[installed.skillId, installed], [other.skillId, other]]) });
  await act(async () => root.render(<SkillInstallReview candidate={incoming} disabled={false} onInstall={install} />));
  expect(host.querySelectorAll("option")).toHaveLength(2);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => { const select = host.querySelector("select")!; select.value = installed.skillId; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).toContain("Attribution bytes or paths changed"); expect(button("Install reviewed update").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => button("Install reviewed update").click()); expect(install).toHaveBeenCalledWith(installed, true);
});
it("rollback first reviews changes and cancel never changes the installed version", async () => {
  const old = { ...candidate, id: "01ARZ3NDEKTSV4RRFFQ69G5FB0", artifactHash: "a".repeat(64), metadata: { ...candidate.metadata, allowedTools: "<script>old</script>" } };
  useSkillsStore.setState({ packages: new Map([[installed.skillId, { ...installed, versions: [candidate, old] }]]) });
  await act(async () => root.render(<InstalledSkillLibrary />));
  await act(async () => button("Roll back").click()); expect(m.change).not.toHaveBeenCalled(); expect(host.textContent).toContain("Grants remain zero"); expect(host.querySelector("script")).toBeNull();
  await act(async () => button("Cancel rollback review").click()); expect(m.change).not.toHaveBeenCalled();
  await act(async () => button("Roll back").click()); await act(async () => { button("Apply reviewed rollback").click(); await tick(); });
  expect(m.change).toHaveBeenCalledWith(installed.skillId, candidate.id, "rollback", old.id);
});
it("plain-model controls start with no skill and never read resource bodies on mount", async () => {
  const change = vi.fn();
  await act(async () => root.render(<SkillTurnPicker value="model" chatKey="chat" choice={EMPTY_SKILL_CHOICE} onChange={change} disabled={false} />));
  expect(host.querySelector(".skill-turn-label")?.textContent).toBe("Skill for this turn");
  expect(host.querySelector(".skill-turn-value")?.textContent).toBe("None");
  expect(change.mock.calls[0]![0].selections).toEqual([]); expect(m.read).not.toHaveBeenCalled();
});
