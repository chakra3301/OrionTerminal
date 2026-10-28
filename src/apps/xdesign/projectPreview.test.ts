import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true, convertFileSrc: (path: string) => path }));
vi.mock("./previewCapture", () => ({ captureProjectPicture: vi.fn() }));
vi.mock("./photo/runtime", async () => { const { create } = await import("zustand"); return { usePhotoWorkspace: create(() => ({ busy: false })) }; });
vi.mock("./pencil/runtime", async () => { const { create } = await import("zustand"); return { usePencilWorkspace: create(() => ({ busy: false })) }; });

import { log } from "@/lib/log";
import { captureProjectPicture, type PreviewPicture } from "./previewCapture";
import { usePhotoWorkspace } from "./photo/runtime";
import { usePencilWorkspace } from "./pencil/runtime";
import { useXDProjects } from "./projectsStore";
import {
  PREVIEW_IDLE_MS, PREVIEW_LEAVE_BUDGET_MS, PREVIEW_THROTTLE_MS,
  deleteProjectPreview, settlePreview, startPreviewTracking, useProjectPreviews,
} from "./projectPreview";

const A = "01ARZ3NDEKTSV4RRFFQ69G5FB0", B = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const capture = vi.mocked(captureProjectPicture);
const bytes = new Uint8Array([137, 80, 78, 71]);
const entry = { path: `/data/assets/xdesign-previews/${A}.png`, revision: 7 };
const save = (id = A) => useXDProjects.setState((s) => ({ registry: s.registry.map((m) => m.id === id ? { ...m, updatedAt: m.updatedAt + 1 } : m) }));
const input = (type = "pointermove") => window.dispatchEvent(new Event(type));
const writes = (id: string) => native.invoke.mock.calls.filter(([command, args]) => command === "xdesign_preview_write" && args.projectId === id);
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(log, "warn").mockImplementation(() => {});
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string) => command === "xdesign_preview_write" ? entry : command === "xdesign_preview_list" ? {} : undefined);
  capture.mockReset();
  capture.mockResolvedValue(bytes);
  useProjectPreviews.setState({ entries: {}, loaded: false });
  usePhotoWorkspace.setState({ busy: false });
  usePencilWorkspace.setState({ busy: false });
  useXDProjects.setState({ registry: [
    { id: A, name: "A", createdAt: 1, updatedAt: 1 },
    { id: B, name: "B", createdAt: 1, updatedAt: 1 },
  ], openTabs: [A, B], activeId: null, transitioning: false });
  stop = startPreviewTracking();
});
afterEach(() => { stop(); vi.useRealTimers(); });

describe("project previews", () => {
  it("captures the open project once it's saved and you've stopped working", async () => {
    useXDProjects.setState({ activeId: A }); save(); input();
    await vi.advanceTimersByTimeAsync(1000);
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(capture).toHaveBeenCalledExactlyOnceWith(A, 640);
    expect(native.invoke).toHaveBeenCalledWith("xdesign_preview_write", { projectId: A, png: [...bytes] });
    expect(useProjectPreviews.getState().entries[A]).toEqual(entry);
  });

  it("waits while you paint, drag or type", async () => {
    useXDProjects.setState({ activeId: A }); save();
    const kinds = ["pointerdown", "pointermove", "keydown", "wheel"];
    for (let step = 0; step < 20; step++) { input(kinds[step % kinds.length]); await vi.advanceTimersByTimeAsync(500); }
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PREVIEW_IDLE_MS);
    expect(capture).toHaveBeenCalledOnce();
  });

  it("doesn't capture during an image or design operation, then catches up", async () => {
    usePhotoWorkspace.setState({ busy: true });
    useXDProjects.setState({ activeId: A });
    await vi.advanceTimersByTimeAsync(5000);
    expect(capture).not.toHaveBeenCalled();
    usePhotoWorkspace.setState({ busy: false }); usePencilWorkspace.setState({ busy: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(capture).not.toHaveBeenCalled();
    usePencilWorkspace.setState({ busy: false });
    await vi.advanceTimersByTimeAsync(PREVIEW_IDLE_MS);
    expect(capture).toHaveBeenCalledOnce();
  });

  it("captures at most every 15 seconds", async () => {
    useXDProjects.setState({ activeId: A });
    await vi.advanceTimersByTimeAsync(0);
    expect(capture).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); save();
    await vi.advanceTimersByTimeAsync(1000); save();
    await vi.advanceTimersByTimeAsync(PREVIEW_THROTTLE_MS - 2100);
    expect(capture).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("never puts a picture on another project's card when you switch mid-capture", async () => {
    const stale = new Uint8Array([1, 2, 3]);
    let finish!: (picture: PreviewPicture) => void;
    capture.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    useXDProjects.setState({ activeId: A });
    await vi.advanceTimersByTimeAsync(0);
    const settled = settlePreview(A);
    await vi.advanceTimersByTimeAsync(PREVIEW_LEAVE_BUDGET_MS);
    await settled;
    useXDProjects.setState({ activeId: B });
    finish(stale);
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).not.toHaveBeenCalledWith("xdesign_preview_write", { projectId: A, png: [...stale] });
    expect(native.invoke).not.toHaveBeenCalledWith("xdesign_preview_write", { projectId: B, png: [...stale] });
    expect(useProjectPreviews.getState().entries[A]).toBeUndefined();
  });

  it("drops a capture you switched away from and captures again when you come back", async () => {
    const stale = new Uint8Array([1, 2, 3]);
    let finish!: (picture: PreviewPicture) => void;
    capture.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    useXDProjects.setState({ activeId: A });
    await vi.advanceTimersByTimeAsync(0);
    useXDProjects.setState({ activeId: B });
    useXDProjects.setState({ activeId: A });
    finish(stale);
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).not.toHaveBeenCalledWith("xdesign_preview_write", { projectId: A, png: [...stale] });
    await vi.advanceTimersByTimeAsync(PREVIEW_THROTTLE_MS);
    expect(capture).toHaveBeenLastCalledWith(A, 640);
    expect(native.invoke).toHaveBeenCalledWith("xdesign_preview_write", { projectId: A, png: [...bytes] });
  });

  it("waits for a quick capture when you leave", async () => {
    capture.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(bytes), 100)));
    useXDProjects.setState({ activeId: A }); save(); input();
    let writtenWhenSettled = -1;
    const leaving = settlePreview(A).then(() => { writtenWhenSettled = writes(A).length; });
    expect(capture).toHaveBeenCalledExactlyOnceWith(A, 640);
    await vi.advanceTimersByTimeAsync(100);
    await leaving;
    expect(writtenWhenSettled).toBe(1);
  });

  it("removes the stored preview instead of capturing while a Claude page is open", async () => {
    capture.mockResolvedValue("clear");
    useProjectPreviews.setState({ entries: { [A]: entry } });
    useXDProjects.setState({ activeId: A });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).toHaveBeenCalledWith("xdesign_preview_delete", { projectId: A });
    expect(writes(A)).toEqual([]);
    expect(useProjectPreviews.getState().entries[A]).toBeUndefined();
  });

  it("tries again later when the canvas isn't ready", async () => {
    capture.mockResolvedValueOnce(null);
    useXDProjects.setState({ activeId: A });
    await vi.advanceTimersByTimeAsync(0);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(writes(A)).toEqual([]);
    await vi.advanceTimersByTimeAsync(PREVIEW_THROTTLE_MS - 1);
    expect(capture).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(writes(A)).toHaveLength(1);
  });

  it("lists stored previews for the home page", async () => {
    native.invoke.mockResolvedValueOnce({ [A]: entry });
    await useProjectPreviews.getState().load();
    expect(native.invoke).toHaveBeenCalledWith("xdesign_preview_list");
    expect(useProjectPreviews.getState()).toMatchObject({ entries: { [A]: entry }, loaded: true });
    useProjectPreviews.setState({ entries: {}, loaded: false });
    native.invoke.mockRejectedValueOnce(new Error("disk unavailable"));
    await useProjectPreviews.getState().load();
    expect(useProjectPreviews.getState()).toMatchObject({ entries: {}, loaded: true });
  });

  it("forgets a deleted project's preview even when the file can't be removed", async () => {
    useProjectPreviews.setState({ entries: { [A]: entry } });
    native.invoke.mockRejectedValueOnce(new Error("busy"));
    await deleteProjectPreview(A);
    expect(native.invoke).toHaveBeenCalledWith("xdesign_preview_delete", { projectId: A });
    expect(useProjectPreviews.getState().entries[A]).toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});
