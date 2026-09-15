import { act, type ReactNode, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./LiquidGlass", () => ({ LiquidGlassCard: ({ children, onSubmit }: { children: ReactNode; onSubmit: (e: FormEvent) => void }) => <form onSubmit={onSubmit}>{children}</form> }));
vi.mock("@/lib/db", () => ({ getAppState: vi.fn(), setAppState: vi.fn(), deleteAppState: vi.fn(), hasAnyUserData: vi.fn() }));
import { FirstRunSetup } from "./FirstRunSetup";
import { useAuth } from "./authStore";

let host: HTMLDivElement, root: Root;
const createAccount = vi.fn(), skipSetup = vi.fn();
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  createAccount.mockReset().mockResolvedValue(undefined); skipSetup.mockReset().mockResolvedValue(undefined);
  useAuth.setState({ ...useAuth.getInitialState(), phase: "first-run", createAccount, skipSetup });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<FirstRunSetup />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.getAttribute("aria-label")?.includes(text) || b.textContent?.includes(text))!;
async function input(value: string) {
  await act(async () => {
    const field = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text: string) { await act(async () => button(text).click()); }

it("asks only for username, then one password, using username as display name", async () => {
  expect(host.querySelectorAll("input")).toHaveLength(1);
  expect(host.textContent).not.toContain("Display name");
  expect(document.activeElement).toBe(host.querySelector("input"));
  await input("pilot"); await click("Next");
  expect(host.querySelectorAll("input")).toHaveLength(1);
  expect(host.querySelector("input")?.type).toBe("password");
  expect(document.activeElement).toBe(host.querySelector("input"));
  await input("test-password"); await click("Enter Orion");
  expect(createAccount).toHaveBeenCalledExactlyOnceWith("pilot", "test-password", "pilot");
});

it("allows skipping from either step without creating an account", async () => {
  await click("Skip sign-in"); expect(skipSetup).toHaveBeenCalledTimes(1);
  await input("pilot"); await click("Next"); await click("Skip sign-in");
  expect(skipSetup).toHaveBeenCalledTimes(2); expect(createAccount).not.toHaveBeenCalled();
});

it("validates password, supports back, and prevents IME Enter from submitting", async () => {
  await input("pilot");
  const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
  await act(async () => host.querySelector("input")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  await click("Next"); await input("x"); await click("Enter Orion");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("4 characters");
  expect(createAccount).not.toHaveBeenCalled();
  await click("Back"); expect(host.querySelector("input")?.value).toBe("pilot");
  await click("Next"); expect(host.querySelector("input")?.value).toBe("");
});

it("retains failed submissions and blocks duplicates while creating", async () => {
  let reject!: (e: Error) => void;
  createAccount.mockImplementation(() => new Promise((_, no) => { reject = no; }));
  await input("pilot"); await click("Next"); await input("test-password");
  await act(async () => { button("Enter Orion").click(); button("Enter Orion").click(); });
  expect(createAccount).toHaveBeenCalledTimes(1);
  await act(async () => { useAuth.setState({ error: "Couldn't create the account." }); reject(new Error("disk full")); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Couldn't create");
  expect(host.querySelector("input")?.value).toBe("test-password");
});
