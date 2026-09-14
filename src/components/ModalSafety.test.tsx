import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ConfirmModalHost, confirmAction } from "./ConfirmModal";
import { PromptModalHost, promptText } from "./PromptModal";

let root: Root;
let host: HTMLDivElement;
let launcher: HTMLButtonElement;
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); queueMicrotask(() => this.dispatchEvent(new Event("close"))); } });
  launcher = document.createElement("button"); document.body.append(launcher); launcher.focus();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<><ConfirmModalHost /><PromptModalHost /></>));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); launcher.remove(); vi.unstubAllGlobals();
  for (const [name, descriptor] of [["showModal", originalShow], ["close", originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
const button = (name: string) => [...document.querySelectorAll("dialog button")].find(node => node.textContent === name) as HTMLButtonElement;
async function enterButton(node: HTMLButtonElement) {
  node.focus();
  await act(async () => {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    // jsdom does not perform the browser's default button activation.
    if (!event.defaultPrevented) node.click();
  });
}

it("names the destructive dialog, initially focuses Cancel, and never treats Cancel+Enter as approval", async () => {
  let result!: Promise<boolean>;
  await act(async () => { result = confirmAction({ title: "Delete fixture?", body: "Cannot undo this deletion.", danger: true, confirmLabel: "Delete" }); });
  const dialog = document.querySelector("dialog")!;
  expect(dialog.getAttribute("role")).toBe("alertdialog"); expect(dialog.open).toBe(true);
  expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Delete fixture?");
  expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("Cannot undo this deletion.");
  expect(document.activeElement).toBe(button("Cancel"));
  await enterButton(button("Cancel")); expect(await result).toBe(false); expect(document.activeElement).toBe(launcher);
});
it("wraps Tab at both boundaries rather than entering WebKit's outer focus loop", async () => {
  await act(async () => { void confirmAction({ title: "Delete?", confirmLabel: "Delete" }); });
  button("Delete").focus();
  const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  button("Delete").dispatchEvent(forward);
  expect(forward.defaultPrevented).toBe(true); expect(document.activeElement).toBe(button("Cancel"));
  const backward = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  button("Cancel").dispatchEvent(backward);
  expect(backward.defaultPrevented).toBe(true); expect(document.activeElement).toBe(button("Delete"));
});
it("only explicit affirmative activation approves", async () => {
  let result!: Promise<boolean>;
  await act(async () => { result = confirmAction({ title: "Delete?", confirmLabel: "Delete" }); });
  await enterButton(button("Delete")); expect(await result).toBe(true);
});
it("refuses a competing confirmation without losing the original decision", async () => {
  let first!: Promise<boolean>; let second!: Promise<boolean>;
  await act(async () => { first = confirmAction({ title: "First" }); second = confirmAction({ title: "Second" }); });
  expect(await second).toBe(false); expect(document.querySelector(".ot-prompt-title")?.textContent).toBe("First");
  await enterButton(button("Confirm")); expect(await first).toBe(true);
});
it("cancels native Escape from any focused control", async () => {
  let result!: Promise<string | null>;
  await act(async () => { result = promptText({ title: "Rename", initialValue: "Must not submit" }); });
  button("OK").focus();
  await act(async () => { document.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); });
  expect(await result).toBeNull(); expect(document.activeElement).toBe(launcher);
});
it("labels the prompt, keeps an in-progress value against competing requests, and trims on submit", async () => {
  let first!: Promise<string | null>;
  await act(async () => { first = promptText({ title: "Rename", label: "Name", initialValue: "Old" }); });
  const input = document.querySelector("dialog input") as HTMLInputElement;
  expect(document.querySelector("label")?.htmlFor).toBe(input.id); expect(document.activeElement).toBe(input);
  input.value = "  New name  "; expect(await promptText({ title: "Other", initialValue: "Wrong" })).toBeNull();
  expect(input.value).toBe("  New name  ");
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  expect(await first).toBe("New name");
});
it("does not submit a composition commit as Enter", async () => {
  let result!: Promise<string | null>;
  await act(async () => { result = promptText({ title: "Name", initialValue: "Composition" }); });
  const input = document.querySelector("dialog input")!;
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })); });
  expect(document.querySelector("dialog")?.open).toBe(true);
  await enterButton(button("Cancel")); expect(await result).toBeNull();
});
it("settles outstanding requests conservatively when their hosts unmount", async () => {
  let confirm!: Promise<boolean>; let prompt!: Promise<string | null>;
  await act(async () => { confirm = confirmAction({ title: "Confirm" }); prompt = promptText({ title: "Prompt" }); });
  await act(async () => root.render(null));
  expect(await confirm).toBe(false); expect(await prompt).toBeNull();
  expect(await confirmAction({ title: "No host" })).toBe(false); expect(await promptText({ title: "No host" })).toBeNull();
});
it("resets an immediate replacement prompt without a delayed close cancelling it", async () => {
  let first!: Promise<string | null>; let second: Promise<string | null> | undefined;
  await act(async () => { first = promptText({ title: "First", initialValue: "One" }); });
  void first.then(() => { second = promptText({ title: "Second", initialValue: "Two" }); });
  await enterButton(button("OK"));
  expect((document.querySelector("dialog input") as HTMLInputElement).value).toBe("Two");
  expect(document.querySelector("dialog")?.open).toBe(true);
  await enterButton(button("OK")); expect(await second).toBe("Two");
});
