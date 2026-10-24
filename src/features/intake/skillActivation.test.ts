import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ context: vi.fn(), remember: vi.fn(), forget: vi.fn(), owner: vi.fn() }));
vi.mock("./installedApi", () => ({ installedSkills: { context: m.context } }));
vi.mock("@/features/agents/sessionOwnership", () => ({ hasSessionOwner: m.owner, rememberSessionOwner: m.remember, forgetSessionOwner: m.forget, forgetSessionOwnersForKind: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: { claudeSend: vi.fn(), cliSend: vi.fn(), cursorSend: vi.fn(), runtimeSend: vi.fn(), claudeCancel: vi.fn(), cliCancel: vi.fn(), cursorCancel: vi.fn(), runtimeCancel: vi.fn() } }));
import { ipc } from "@/lib/ipc";
import { dispatchSend, dispatchAgentTurn, dispatchCancel, forgetDispatch, recordDispatchedSession } from "@/features/agents/dispatchSend";
import { resolveSendFromStores } from "@/features/agents/resolveSend";
import { composeAgent } from "@/features/agents/composeAgent";
import { useSkillsStore } from "@/store/skillsStore";
import { useAgentsStore } from "@/store/agentsStore";
import { useProvidersStore } from "@/store/providersStore";
import { providerModelValue } from "@/features/agents/modelSelection";
import type { Agent, Provider, Skill } from "@/features/agents/agentTypes";
import { candidateFixture } from "./testFixture";
import { parseInstalledSkill, parseSkillContext, type InstalledSkill } from "./contracts";
import { skillModelScope, planSkillActivation, type SkillTurnChoice } from "./skillActivation";
import { assertImportedSkillsIdle } from "./skillRuns";
import { sha256 } from "@/features/repoAnalysis/sourceText";

const installed: InstalledSkill = { skillId: `imported:${candidateFixture.id}`, enabled: true, active: candidateFixture, versions: [candidateFixture] };
const skill: Skill = { id: installed.skillId, name: "example", icon: "", accent: "", instructions: "", tools: [], builtin: false, imported: { enabled: true, versionId: candidateFixture.id, artifactHash: candidateFixture.artifactHash } };
const provider: Provider = { id: "provider", name: "Test", kind: "anthropic", baseUrl: "", keyRef: "", models: [{ id: "model", label: "Model" }], enabled: true, builtin: false };
const value = providerModelValue(provider.id, "model");
const agent: Agent = { id: "agent", name: "Selected", role: "Assistant", accent: "", avatarAssetId: null, avatarUrl: null, brainModel: value, actionModel: "other", skillIds: [skill.id] };
let currentPackage = installed;
const parts = () => currentPackage.active.files.map((f, i) => ({ skillId: skill.id, versionId: candidateFixture.id, path: f.path, sha256: f.sha256, text: i ? "DESIGN!!" : "instructions" }));
const choice = (): SkillTurnChoice => ({ selections: [{ skillId: skill.id, versionId: candidateFixture.id, paths: ["example/DESIGN.md"] }], contextLimit: 128_000, modelScope: skillModelScope(value, useProvidersStore.getState().providers) });
const args = () => ({ chatId: "skill-chat", value, prompt: "Help", history: [], sessionId: "old-owned-session", skillContext: choice() });
beforeEach(async () => {
  const active = { ...candidateFixture, files: await Promise.all(candidateFixture.files.map(async (f, i) => ({ ...f, sha256: await sha256(i ? "DESIGN!!" : "instructions") }))) };
  currentPackage = { ...installed, active, versions: [active] };
  vi.resetAllMocks(); m.context.mockResolvedValue(parts()); m.owner.mockResolvedValue(true); m.remember.mockResolvedValue(undefined); m.forget.mockResolvedValue(undefined);
  useSkillsStore.setState({ skills: new Map([[skill.id, skill]]), packages: new Map([[skill.id, currentPackage]]), loaded: true, mutating: false, error: null });
  useAgentsStore.setState({ agents: new Map([[agent.id, agent]]) });
  useProvidersStore.setState({ providers: [provider], loaded: true });
});
afterEach(() => forgetDispatch("skill-chat"));
it("strictly rejects authority fields, broken version ownership and malformed context", () => {
  expect(parseInstalledSkill(installed)).toEqual(installed);
  expect(() => parseInstalledSkill({ ...installed, allowedTools: ["Bash"] })).toThrow();
  expect(() => parseInstalledSkill({ ...installed, enabled: 1 })).toThrow();
  expect(() => parseInstalledSkill({ ...installed, versions: [] })).toThrow();
  expect(() => parseSkillContext([{ ...parts()[0], approved: true }])).toThrow();
  expect(() => parseSkillContext([{ ...parts()[0], path: "../secret" }])).toThrow();
});
it("preserves legacy composition while surfacing missing/disabled imported attachments", () => {
  expect(composeAgent({ ...agent, skillIds: ["legacy-missing"] }, []).allowedTools).toEqual([]);
  expect(() => composeAgent(agent, [])).toThrow("missing");
  expect(() => composeAgent(agent, [{ ...skill, imported: { ...skill.imported!, enabled: false } }])).toThrow("disabled");
  const composed = composeAgent(agent, [{ ...skill, instructions: "do not auto-inject", tools: [{ kind: "builtin", name: "Bash" }] }]);
  expect(composed.allowedTools).toEqual([]); expect(composed.appendSystemPrompt).not.toContain("auto-inject");
  expect(() => resolveSendFromStores("agent:agent")).toThrow("foreground text chat");
});
it("requires model-bound review, adequate capacity and exact agent selections", () => {
  const r = resolveSendFromStores("agent:agent", true);
  expect(() => planSkillActivation("agent:agent", r)).toThrow("capacity");
  expect(() => planSkillActivation(value, { model: value, actionModel: null, systemAppend: null, allowedTools: null }, { ...choice(), modelScope: "other" })).toThrow("changed");
  expect(() => planSkillActivation("agent:agent", r, { ...choice(), selections: [] })).toThrow("attachments");
});
it("shares full selected resources only on send, after app grants are stripped, and never resumes", async () => {
  const onReady = vi.fn();
  expect(m.context).not.toHaveBeenCalled();
  await dispatchSend({ ...args(), extra: { allowedTools: ["Bash", "mcp__outside"] }, freshPreamble: "Orion app context", onReady });
  expect(ipc.claudeSend).toHaveBeenCalledOnce();
  const call = vi.mocked(ipc.claudeSend).mock.calls[0]!;
  expect(call[3]).toBeNull(); expect(call[7]).toEqual([]); expect(call[6]).toContain("instructions"); expect(call[6]).toContain("DESIGN!!"); expect(call[1]).toContain("Orion app context");
  expect(onReady.mock.calls[0]![0]).toHaveLength(2);
  recordDispatchedSession("skill-chat", "imported-session"); expect(m.remember).not.toHaveBeenCalled();
  expect(() => assertImportedSkillsIdle([skill.id])).toThrow("Stop the response");
  forgetDispatch("skill-chat"); expect(() => assertImportedSkillsIdle([skill.id])).not.toThrow();
});
it("an imported Agent Forge attachment uses Brain only with no tools or Action pass", async () => {
  await dispatchAgentTurn({ ...args(), value: "agent:agent" }, { capturePlan: () => "plan", nextHistory: () => [] });
  expect(ipc.claudeSend).toHaveBeenCalledOnce(); expect(vi.mocked(ipc.claudeSend).mock.calls[0]![7]).toEqual([]);
});
it.each(["anthropic", "codex_cli", "gemini_cli", "cursor_sdk", "openai", "google", "openai_compat"] as const)("routes explicit text context with zero tools through %s", async (kind) => {
  useProvidersStore.setState({ providers: [{ ...provider, kind }] });
  await dispatchSend(args());
  const calls: unknown[][] = [];
  for (const fn of [ipc.claudeSend, ipc.cliSend, ipc.cursorSend, ipc.runtimeSend]) calls.push(...vi.mocked(fn).mock.calls);
  expect(calls).toHaveLength(1); expect(calls[0]!.at(-1)).toEqual([]); expect(JSON.stringify(calls)).toContain("DESIGN!!");
});
it("rejects incomplete/foreign/native-disabled context before publishing a message or invoking a provider", async () => {
  const onReady = vi.fn(); m.context.mockResolvedValueOnce(parts().slice(0, 1));
  await expect(dispatchSend({ ...args(), onReady })).rejects.toThrow("incomplete");
  m.context.mockResolvedValueOnce([{ ...parts()[0], versionId: "foreign" }, parts()[1]]);
  await expect(dispatchSend({ ...args(), onReady })).rejects.toThrow("receipt");
  m.context.mockRejectedValueOnce(new Error("disabled"));
  await expect(dispatchSend({ ...args(), onReady })).rejects.toThrow("disabled");
  expect(onReady).not.toHaveBeenCalled(); expect(ipc.claudeSend).not.toHaveBeenCalled();
  expect(() => assertImportedSkillsIdle([skill.id])).not.toThrow();
});
it("rejects same-length altered skill text before publishing a message or contacting any provider", async () => {
  m.context.mockResolvedValueOnce([{ ...parts()[0], text: "INSTRUCTIONS" }, parts()[1]]); const onReady = vi.fn();
  await expect(dispatchSend({ ...args(), onReady })).rejects.toThrow("content hash");
  expect(onReady).not.toHaveBeenCalled(); for (const fn of [ipc.claudeSend, ipc.cliSend, ipc.cursorSend, ipc.runtimeSend]) expect(fn).not.toHaveBeenCalled();
  expect(() => assertImportedSkillsIdle([skill.id])).not.toThrow();
});
it("does not truncate 87 KB instructions and blocks insufficient context", async () => {
  const text = `${"x".repeat(87_250)}END`;
  const contentHash = await sha256(text);
  const active = { ...currentPackage.active, totalBytes: text.length + 8, files: currentPackage.active.files.map((f, i) => i ? f : { ...f, bytes: text.length, sha256: contentHash }) };
  currentPackage = { ...installed, active, versions: [active] };
  useSkillsStore.setState({ packages: new Map([[skill.id, currentPackage]]) });
  m.context.mockResolvedValue([{ ...parts()[0], text }, parts()[1]]);
  const onReady = vi.fn(); await expect(dispatchSend({ ...args(), skillContext: { ...choice(), contextLimit: 32_000 }, onReady })).rejects.toThrow("Nothing was truncated");
  expect(onReady).not.toHaveBeenCalled(); expect(ipc.claudeSend).not.toHaveBeenCalled();
  await dispatchSend(args()); expect(vi.mocked(ipc.claudeSend).mock.calls[0]![6]).toContain(text);
});
it("cancellation during native context resolution cannot start a late provider turn", async () => {
  let finish!: (value: unknown) => void; m.context.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  const sending = dispatchSend(args()); const rejected = expect(sending).rejects.toThrow("Cancelled");
  await vi.waitFor(() => expect(m.context).toHaveBeenCalledOnce()); await dispatchCancel("skill-chat", value);
  finish(parts()); await rejected; expect(ipc.claudeSend).not.toHaveBeenCalled();
});
it("provider changes during context preparation prevent upload", async () => {
  let finish!: (value: unknown) => void; m.context.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  const sending = dispatchSend(args()); const rejected = expect(sending).rejects.toThrow("provider changed");
  await vi.waitFor(() => expect(m.context).toHaveBeenCalledOnce()); useProvidersStore.setState({ providers: [{ ...provider, baseUrl: "https://changed.invalid" }] });
  finish(parts()); await rejected; expect(ipc.claudeSend).not.toHaveBeenCalled();
});
