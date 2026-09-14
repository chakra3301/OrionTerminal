import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRow } from "@/lib/db";

const mocks = vi.hoisted(() => ({ run: vi.fn(), get: vi.fn(), save: vi.fn() }));
vi.mock("@/features/agents/textCall", () => ({ runTextModel: mocks.run }));
vi.mock("@/store/modelPrefsStore", () => ({ useModelPrefs: { getState: () => ({ modelFor: () => "provider:fixture/selected" }) } }));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getAppState: mocks.get, setAppState: mocks.save }));
import { WeekRead } from "./Today";

const chats = [{ title: "Disposable fixture", updated_at: Date.now() } as ChatRow];
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(null);
  mocks.save.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue("A selected-model summary.");
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks(); });

describe("weekly summary consent and routing", () => {
  it("does not make an AI call on mount, then uses the selected Archives model", async () => {
    await act(async () => root.render(<WeekRead recentNotes={[]} recentChats={chats} />));
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(false);
    expect(mocks.run).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect(container.textContent).toContain("A selected-model summary.");
    expect(mocks.run).toHaveBeenCalledWith(expect.stringContaining("Disposable fixture"), "provider:fixture/selected");
    expect(mocks.save).toHaveBeenCalledWith("today.weekRead", expect.objectContaining({ text: "A selected-model summary." }));
  });

  it("retains generated text and surfaces a failed cache write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.save.mockRejectedValue(new Error("disk unavailable"));
    await act(async () => root.render(<WeekRead recentNotes={[]} recentChats={chats} />));
    await act(async () => container.querySelector("button")!.click());
    expect(container.textContent).toContain("Summary generated, but saving failed: disk unavailable");
    expect(container.textContent).toContain("A selected-model summary.");
  });
});
