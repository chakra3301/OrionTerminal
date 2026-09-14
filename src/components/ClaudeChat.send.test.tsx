import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeChat } from "./ClaudeChat";

vi.mock("@/lib/fileDrop", () => ({ useFileDropZone: vi.fn() }));
vi.mock("@/components/ModelSelect", () => ({
  ModelSelect: ({ disabled }: { disabled?: boolean }) => <button data-testid="model" disabled={disabled}>Model</button>,
}));

let host: HTMLDivElement;
let root: Root;
const onNewChat = vi.fn();
function render(onSend: (text: string) => Promise<void>) {
  root.render(<ClaudeChat appId="orion" name="Assistant" subtitle="Test" accentColor="#00e0ff"
    systemPrompt="" messages={[]} suggestionChips={["Test prompt"]} onSend={onSend} onNewChat={onNewChat} />);
}
function suggestion() { return host.querySelector<HTMLButtonElement>(".chip")!; }

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onNewChat.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("chat send failures", () => {
  it("shows rejection, restores the draft, and clears the error on successful retry", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("Subscription login required")).mockResolvedValue(undefined);
    await act(async () => render(send));
    await act(async () => suggestion().click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Subscription login required");
    expect(host.querySelector("textarea")?.value).toBe("Test prompt");
    expect(host.querySelector("textarea")?.disabled).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('.send')!.click());
    expect(send).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("textarea")?.value).toBe("");
  });

  it("prevents duplicate submissions and model/new-chat changes during preparation", async () => {
    let reject!: (error: Error) => void;
    const send = vi.fn(() => new Promise<void>((_, no) => { reject = no; }));
    await act(async () => render(send));
    await act(async () => { suggestion().click(); suggestion().click(); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="model"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[title="New chat"]')?.disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Preparing message…");
    await act(async () => reject(new Error("Offline")));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Offline");
    expect(host.querySelector<HTMLButtonElement>('[data-testid="model"]')?.disabled).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[title="New chat"]')!.click());
    expect(onNewChat).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
