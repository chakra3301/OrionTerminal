import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { usePhotoWorkspace } from "./runtime";
import { ImagePlaceDialog } from "./ImagePlaceDialog";
import type { PhotoDocument, PhotoState } from "./types";

const picker = vi.hoisted(() => vi.fn());
const command = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: picker }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: command }));
let root: Root, container: HTMLDivElement;
let project: string, photo: PhotoDocument;
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === name)!;
const click = (name: string) => act(async () => button(name).click());
const input = async (label: string, value: string) => act(async () => {
  const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const toggle = (label: string) => act(async () => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.click());
const mount = (linked = false, close = vi.fn()) => act(async () => root.render(<ImagePlaceDialog linked={linked} close={close}/>));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  picker.mockReset(); command.mockReset().mockResolvedValue(undefined);
  useXDesign.getState().hydrate(null);
  project = ulid();
  const id = ulid(), version = ulid();
  photo = { id, version, name: "Target", width: 800, height: 600, previewWidth: 800, previewHeight: 600, bundlePath: `/assets/${version}.pcraft`, previewPath: `/assets/${version}.png`, originalPath: null };
  const shapeId = useXDesign.getState().applyPhotoDocument(photo);
  useXDProjects.setState({ activeId: project, transitioning: false });
  const state = { width: 800, height: 600, activeLayer: 11, features: { placeImages: true } } as PhotoState;
  usePhotoWorkspace.setState({ projectId: project, documentId: id, shapeId, source: "legacy", state, stateVersion: version, busy: false, error: null, smartTrail: [] });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); usePhotoWorkspace.setState({ busy: false }); usePhotoWorkspace.getState().close(); vi.unstubAllGlobals(); });

it.each([false, true])("places picked bytes through the correct native command with automatic sizing (%s)", async linked => {
  const close = vi.fn(); await mount(linked, close);
  expect(button("OK").disabled).toBe(true);
  picker.mockResolvedValue("/picked/source.psd"); await click("Choose image…");
  expect(picker).toHaveBeenCalledExactlyOnceWith({ multiple: false });
  expect(command).not.toHaveBeenCalled(); expect(document.activeElement).not.toBeNull();
  await click("OK");
  expect(command).toHaveBeenCalledExactlyOnceWith(linked ? "file.placeLinked" : "file.placeEmbedded", { path: "/picked/source.psd", fit: true });
  expect(close).toHaveBeenCalledOnce();
});

it("sends explicit scale and center and preserves the independent fit choice", async () => {
  await mount(); picker.mockResolvedValue("/picked/custom.png"); await click("Choose image…");
  await toggle("Fit placed image"); await input("Placement scale (%)", "42.5");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Fit placed image"]')!.disabled).toBe(true);
  await toggle("Center placed image"); await input("Placement center X", "21.25"); await input("Placement center Y", "-8"); await click("OK");
  expect(command).toHaveBeenCalledExactlyOnceWith("file.placeEmbedded", { path: "/picked/custom.png", fit: false, scale: 42.5, center: [21.25, -8] });
});

it("keeps cancellation quiet and does not place until a file is selected", async () => {
  await mount(); picker.mockResolvedValue(null); await click("Choose image…");
  expect(button("OK").disabled).toBe(true); expect(command).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("retains the selected file and local error when native placement fails", async () => {
  const close = vi.fn(); await mount(false, close); picker.mockResolvedValue("/picked/broken.psd"); await click("Choose image…");
  command.mockRejectedValue(new Error("Source cannot be decoded")); await click("OK");
  expect(close).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')?.textContent).toContain("Source cannot be decoded");
  expect(button("broken.psd")).toBeDefined(); command.mockResolvedValue(undefined); await click("OK"); expect(close).toHaveBeenCalledOnce();
});

it.each(["document", "layer", "project", "version", "transition", "capability"])("rejects a late picker after the %s changes", async change => {
  let finish!: (value: string) => void;
  picker.mockReturnValue(new Promise<string>(resolve => { finish = resolve; })); await mount(); await click("Choose image…");
  expect(button("OK").disabled).toBe(true);
  await act(async () => {
    if (change === "document") usePhotoWorkspace.setState({ documentId: ulid() });
    else if (change === "layer") usePhotoWorkspace.setState(state => ({ state: { ...state.state!, activeLayer: 12 } }));
    else if (change === "project") useXDProjects.setState({ activeId: ulid() });
    else if (change === "version") useXDesign.setState(state => ({ photoDocuments: { ...state.photoDocuments, [photo.id]: { ...photo, version: ulid() } } }));
    else if (change === "transition") useXDProjects.setState({ transitioning: true });
    else usePhotoWorkspace.setState(state => ({ state: { ...state.state!, features: {} } }));
    finish("/late/foreign.psd");
  });
  expect(command).not.toHaveBeenCalled(); expect(container.textContent).not.toContain("foreign.psd"); expect(button("OK").disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("image changed");
});

it("ignores picker results after unmount and prevents repeated picker requests", async () => {
  let finish!: (value: string) => void;
  picker.mockReturnValue(new Promise<string>(resolve => { finish = resolve; })); await mount(); await click("Choose image…");
  expect(button("Choosing…").disabled).toBe(true); await click("Choosing…"); expect(picker).toHaveBeenCalledOnce();
  await act(async () => root.unmount()); root = createRoot(container);
  await act(async () => finish("/late/ignored.png")); expect(command).not.toHaveBeenCalled(); expect(container.textContent).toBe("");
});

it("disables placement during another operation and refuses invalid geometry fields", async () => {
  await mount(); picker.mockResolvedValue("/picked/source.png"); await click("Choose image…"); await input("Placement scale (%)", "0"); expect(button("OK").disabled).toBe(true);
  await input("Placement scale (%)", "100"); await toggle("Center placed image"); await input("Placement center X", ""); expect(button("OK").disabled).toBe(true);
  await input("Placement center X", "0"); await act(async () => usePhotoWorkspace.setState({ busy: true })); expect(button("OK").disabled).toBe(true); expect(command).not.toHaveBeenCalled();
});

it("restores the opening values on Alt-click Reset", async () => {
  await mount(); await input("Placement scale (%)", "42"); await toggle("Center placed image");
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true })); });
  await act(async () => { button("Reset").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true })); });
  expect(container.querySelector<HTMLInputElement>('[aria-label="Placement scale (%)"]')!.value).toBe("");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Center placed image"]')!.checked).toBe(true);
});
