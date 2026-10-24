// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ClaudeChatProps } from "@/components/ClaudeChat";
import type { DispatchSendArgs } from "@/features/agents/dispatchSend";
const m = vi.hoisted(() => ({ props: null as unknown, dispatch: vi.fn(), cancel: vi.fn(), forget: vi.fn(), context: vi.fn(), auto: vi.fn() }));
vi.mock("@/components/ClaudeChat", () => ({ ClaudeChat: (props: unknown) => { m.props = props; return null; } }));
vi.mock("@/features/intake/SkillTurnPicker", () => ({ SkillTurnPicker: () => null }));
vi.mock("@/features/agents/dispatchSend", () => ({ dispatchAgentTurn: m.dispatch, dispatchCancel: m.cancel, forgetDispatch: m.forget, toRuntimeHistory: () => [] }));
vi.mock("@/features/context/contextProviders", () => ({ searchContextSuggestions: vi.fn(), resolveContextChips: m.context, buildContextBlock: () => "context", autoCodebaseContext: m.auto, toPill: (p: unknown) => p }));
vi.mock("@/store/projectStore", async () => ({ useProjectStore: (await import("zustand")).create(() => ({ active: { id: "project", root_path: "/project" } })) }));
vi.mock("@/store/modelPrefsStore", async () => ({ useModelPrefs: (await import("zustand")).create(() => ({ modelFor: () => "model" })) }));
vi.mock("@/lib/log", () => ({ log: { error: vi.fn(), warn: vi.fn() } }));
import { OrionClaudeRail } from "./OrionClaudeRail";
import { useChatStore } from "@/store/chatStore";
let root: Root, host: HTMLDivElement;
const props = () => m.props as ClaudeChatProps;
const tick = () => new Promise((r) => setTimeout(r, 0));
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); m.context.mockResolvedValue([]); m.auto.mockResolvedValue([]); m.cancel.mockResolvedValue(undefined);
  useChatStore.setState({ running: false, active: null }); useChatStore.getState().newChat("project");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<OrionClaudeRail />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("preflight failures preserve the chat without adding a phantom user message", async () => {
  m.dispatch.mockRejectedValueOnce(new Error("Context budget is insufficient"));
  await act(async () => { await expect(props().onSend("keep my draft")).rejects.toThrow("budget"); });
  expect(useChatStore.getState().active?.messages).toEqual([]); expect(useChatStore.getState().running).toBe(false);
});
it("publishes the message and exact resource receipts only after preflight", async () => {
  m.dispatch.mockImplementationOnce(async (args: DispatchSendArgs) => {
    expect(useChatStore.getState().active?.messages).toHaveLength(0);
    args.onReady?.([{ label: "skill/DESIGN.md", chars: 12053, preview: "version and hash" }]);
  });
  await act(async () => props().onSend("design this"));
  const message = useChatStore.getState().active?.messages[0];
  expect(message?.pills?.[0]).toEqual({ kind: "skill", label: "skill/DESIGN.md", chars: 12053, preview: "version and hash", truncated: false });
  expect(m.dispatch.mock.calls[0]![0].freshPreamble).toBeTruthy();
});
it("Stop during app-context preparation prevents a late dispatch", async () => {
  let finish!: (v: unknown[]) => void; m.auto.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  let sending!: Promise<void>;
  await act(async () => { sending = Promise.resolve(props().onSend("do not send")); await tick(); });
  const rejected = expect(sending).rejects.toThrow("Cancelled");
  await act(async () => { props().onCancel?.(); finish([]); await tick(); });
  await rejected; expect(m.dispatch).not.toHaveBeenCalled(); expect(useChatStore.getState().running).toBe(false);
});
it("unmount cancels pending preparation without leaving the shared chat busy", async () => {
  let finish!: (v: unknown[]) => void; m.auto.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  let sending!: Promise<void>;
  await act(async () => { sending = Promise.resolve(props().onSend("do not send")); await tick(); });
  const rejected = expect(sending).rejects.toThrow("Cancelled");
  await act(async () => { root.render(<div />); });
  await act(async () => { finish([]); await rejected; });
  await rejected; expect(m.dispatch).not.toHaveBeenCalled(); expect(useChatStore.getState().running).toBe(false);
});
