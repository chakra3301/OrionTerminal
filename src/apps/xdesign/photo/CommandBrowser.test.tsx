import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PhotoCommandBrowser } from "./CommandBrowser";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoCommand, PhotoState } from "./types";

const native = vi.hoisted(() => ({ invoke: vi.fn(), run: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: native.invoke }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: native.run }));
const commands: PhotoCommand[] = [
  { id: "edit.fade", label: "Fade", menu: ["Edit"], shortcut: null, params: '{"opacity":number=100,"mode":string="normal"}', hostDispatch: true },
  { id: "filter.cameraRaw", label: "Camera RAW", menu: ["Filter"], shortcut: null, params: "{}", hostDispatch: true },
];
const state: PhotoState = { name: "Image", width: 32, height: 24, mode: "RGB", depth: 16, resolution: 72, activeLayer: null, hasSelection: false, selectionBounds: null, layers: [], canUndo: true, canRedo: false, canFade: false };
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); native.invoke.mockReset().mockResolvedValue({ commands }); native.run.mockReset().mockResolvedValue(null);
  usePhotoWorkspace.setState({ busy: false, error: null, state });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<PhotoCommandBrowser close={vi.fn()}/>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const choose = async (id: string) => act(async () => { const input = container.querySelector<HTMLSelectElement>('[aria-label="Image action"]')!; input.value = id; input.dispatchEvent(new Event("change", { bubbles: true })); });
const submit = async () => act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const apply = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

it("uses current host Fade availability and refuses programmatic submission when stale", async () => {
  await choose("edit.fade"); expect(apply().disabled).toBe(true); await submit(); expect(native.run).not.toHaveBeenCalled();
  await act(async () => usePhotoWorkspace.setState({ state: { ...state, canFade: true } })); expect(apply().disabled).toBe(false);
  await submit(); expect(native.run).toHaveBeenCalledWith("edit.fade", expect.any(Object));
  await act(async () => usePhotoWorkspace.setState({ state: { ...state, canFade: false } })); expect(apply().disabled).toBe(true);
  await submit(); expect(native.run).toHaveBeenCalledOnce();
});

it("keeps other actions available and guards a busy workspace before dispatch", async () => {
  await choose("filter.cameraRaw"); expect(apply().disabled).toBe(false);
  await act(async () => usePhotoWorkspace.setState({ busy: true })); expect(apply().disabled).toBe(true); await submit(); expect(native.run).not.toHaveBeenCalled();
  await act(async () => usePhotoWorkspace.setState({ busy: false })); await submit(); expect(native.run).toHaveBeenCalledWith("filter.cameraRaw", {});
});
