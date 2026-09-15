import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ setAppState: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/ipc", () => ({ ipc: { wallpaperStoreFile: vi.fn(), wallpaperClearFile: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/store/toastStore", () => ({ toast: { error: vi.fn() } }));
import { setAppState } from "@/lib/db";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import { useWallpaperStore } from "./wallpaperStore";

beforeEach(() => { vi.clearAllMocks(); useWallpaperStore.setState(useWallpaperStore.getInitialState()); });

it("defaults to a still wallpaper while preserving saved Matrix/Core/custom preferences", () => {
  expect(useWallpaperStore.getState().overlay).toBe("none");
  useWallpaperStore.getState().hydrate({ overlay: "matrix", matrixHue: 200, mode: "custom", customPath: "/existing/image.png" });
  expect(useWallpaperStore.getState()).toMatchObject({ overlay: "matrix", matrixHue: 200, mode: "custom", customPath: "/existing/image.png" });
  useWallpaperStore.getState().hydrate({ overlay: "core" }); expect(useWallpaperStore.getState().overlay).toBe("core");
  useWallpaperStore.getState().hydrate({ overlay: "none" }); expect(useWallpaperStore.getState().overlay).toBe("none");
});

it("orders preference writes so the final Off choice remains durable", async () => {
  let done!: () => void;
  vi.mocked(setAppState).mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve; }));
  useWallpaperStore.getState().setOverlay("matrix");
  useWallpaperStore.getState().setMatrixHue(230);
  useWallpaperStore.getState().setOverlay("none");
  await vi.waitFor(() => expect(setAppState).toHaveBeenCalledTimes(1));
  done();
  await vi.waitFor(() => expect(setAppState).toHaveBeenCalledTimes(3));
  expect(vi.mocked(setAppState).mock.calls.at(-1)?.[1]).toMatchObject({ overlay: "none", matrixHue: 230 });
});

it("reports failed preference writes rather than silently claiming persistence", async () => {
  vi.mocked(setAppState).mockRejectedValueOnce(new Error("disk full"));
  useWallpaperStore.getState().setOverlay("none");
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
});

it("keeps the previous custom file if the new wallpaper could not be persisted", async () => {
  useWallpaperStore.getState().hydrate({ mode: "custom", customPath: "/previous.png" });
  vi.mocked(ipc.wallpaperStoreFile).mockResolvedValueOnce({ filePath: "/new.png", originalName: "new.png" });
  vi.mocked(setAppState).mockRejectedValueOnce(new Error("disk full"));
  await expect(useWallpaperStore.getState().setCustomFromPath("/input.png")).rejects.toThrow("disk full");
  expect(ipc.wallpaperClearFile).not.toHaveBeenCalled();
});
