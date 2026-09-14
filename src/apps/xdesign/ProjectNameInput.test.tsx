import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectNameInput } from "./ProjectNameInput";
import { useXDesignSaveState, unsavedXDesignReason } from "./saveState";

const rename = vi.hoisted(() => vi.fn());
vi.mock("./projectsStore", () => ({ useXDProjects: { getState: () => ({ renameProject: rename }) } }));
let host: HTMLDivElement, root: Root;
const finish = vi.fn();
function render() { root.render(<ProjectNameInput id="project" name="Original" className="rename" onFinish={finish} />); }
function input() { return host.querySelector("input")!; }
function key(key: string) { input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); }
function change(value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
  input().dispatchEvent(new Event("input", { bubbles: true }));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rename.mockReset(); finish.mockReset(); useXDesignSaveState.setState({ names: {}, documents: {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("retains a failed draft across unmount, blocks disable, and allows retry", async () => {
  rename.mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
  await act(async () => render());
  await act(async () => change("Keep my name"));
  await act(async () => key("Enter"));
  expect(input().getAttribute("aria-invalid")).toBe("true");
  expect(finish).not.toHaveBeenCalled(); expect(unsavedXDesignReason()).toMatch(/unfinished project name/);
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => render());
  expect(input().value).toBe("Keep my name");
  await act(async () => key("Enter"));
  expect(finish).toHaveBeenCalledOnce(); expect(rename).toHaveBeenLastCalledWith("project", "Keep my name");
  expect(unsavedXDesignReason()).toBeNull();
});

it("does not send duplicate Enter/blur saves or discard an in-flight save", async () => {
  let done!: () => void;
  rename.mockImplementation(() => new Promise<void>((resolve) => { done = resolve; }));
  await act(async () => render()); await act(async () => change("Pending"));
  await act(async () => { key("Enter"); input().dispatchEvent(new FocusEvent("focusout", { bubbles: true })); key("Enter"); key("Escape"); });
  expect(rename).toHaveBeenCalledOnce(); expect(finish).not.toHaveBeenCalled(); expect(input().readOnly).toBe(true);
  await act(async () => done()); expect(finish).toHaveBeenCalledOnce();
});

it("Escape discards without a trailing blur committing the discarded name", async () => {
  await act(async () => render()); await act(async () => change("Discard"));
  await act(async () => { key("Escape"); input().dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  expect(rename).not.toHaveBeenCalled(); expect(finish).toHaveBeenCalledOnce(); expect(unsavedXDesignReason()).toBeNull();
});
