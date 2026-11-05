import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePhotoWorkspace } from "./runtime";
import { antialiasEntries, faceStyles, layerFaceName, typeAntialias, typeSize, typeStyleParams, useFamilyFaces, type Face } from "./typeOptions";

const command = vi.hoisted(() => vi.fn(async (_id: string, _params?: Record<string, unknown>): Promise<unknown> => undefined));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), runPhotoCommand: command }));

describe("type options", () => {
  it("never offers an anti-alias mode the engine cannot draw: the platform pair is listed but off", () => {
    expect(antialiasEntries(true)).toEqual([["none", "None", true], ["sharp", "Sharp", true], ["crisp", "Crisp", true], ["strong", "Strong", true], ["smooth", "Smooth", true], ["macLcd", "Mac LCD", false], ["mac", "Mac", false]]);
    expect(antialiasEntries(false).slice(5)).toEqual([["windowsLcd", "Windows LCD", false], ["windows", "Windows", false]]);
  });
  it("reads a stale platform mode as the Sharp it is drawn with, and anything unknown as Smooth", () => {
    for (const value of ["windowslcd", "windowsLcd", "windows"]) expect(typeAntialias(value)).toBe("sharp");
    expect(typeAntialias("Crisp")).toBe("crisp");
    for (const value of ["macLcd", "bogus", undefined, 3]) expect(typeAntialias(value)).toBe("smooth");
  });
  it("keeps the type size in Photoshop's 0.01-1296 pt at two decimals", () => {
    expect(typeSize(0)).toBe(.01); expect(typeSize(12.345)).toBe(12.35); expect(typeSize(5000)).toBe(1296);
    expect(typeSize(Number.NaN)).toBeNull();
  });
  it("lists the family's own faces in weight order, keeps the current one and falls back to the four basic styles", () => {
    const faces: Face[] = [{ weight: 700, italic: false }, { weight: 400, italic: true }, { weight: 300, italic: false }, { weight: 400, italic: false }, { weight: 700, italic: false }];
    expect(faceStyles(faces, "Regular")).toEqual(["Light", "Regular", "Italic", "Bold"]);
    expect(faceStyles(faces, "Black")).toEqual(["Light", "Regular", "Italic", "Bold", "Black"]);
    expect(faceStyles([], "Regular")).toEqual(["Regular", "Italic", "Bold", "Bold Italic"]);
  });
  it("maps any face name to weight and italic, resetting them only when restyling", () => {
    expect(typeStyleParams("Regular")).toEqual({});
    expect(typeStyleParams("Regular", true)).toEqual({ weight: 400, italic: false });
    expect(typeStyleParams("Bold Italic")).toEqual({ weight: 700, italic: true });
    expect(typeStyleParams("Light")).toEqual({ weight: 300 });
    expect(typeStyleParams("SemiBold Italic", true)).toEqual({ weight: 600, italic: true });
    expect(typeStyleParams("Italic", true)).toEqual({ weight: 400, italic: true });
  });
  it("names a layer's face when every run shares it", () => {
    const run = (start: number, end: number, style: Record<string, unknown>) => ({ start, end, style });
    expect(layerFaceName([run(0, 3, { weight: 700, italic: true })])).toBe("Bold Italic");
    expect(layerFaceName([run(0, 3, { weight: 700, italic: false }), run(3, 5, { weight: 400, italic: false })])).toBeNull();
    expect(layerFaceName(undefined)).toBeNull();
  });
});

describe("useFamilyFaces", () => {
  let root: Root, container: HTMLDivElement, seen: Face[] = [];
  function Probe({ family }: { family: string }) { seen = useFamilyFaces(family); return null; }
  beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); command.mockReset(); usePhotoWorkspace.setState({ busy: false, quiet: false }); container = document.createElement("div"); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });
  it("asks the engine once per family, only while idle, and keeps the fallback after a failure without retrying", async () => {
    command.mockResolvedValue({ faces: [{ family: "Inter", weight: 400, italic: false, axes: [] }, { family: "Inter", weight: 700, italic: true, axes: [] }, { weight: "x" }] });
    await act(async () => usePhotoWorkspace.setState({ busy: true }));
    await act(async () => root.render(<Probe family="Inter" />));
    expect(command).not.toHaveBeenCalled();
    await act(async () => usePhotoWorkspace.setState({ busy: false }));
    expect(command).toHaveBeenCalledWith("type.fonts", { family: "Inter" });
    expect(seen).toEqual([{ weight: 400, italic: false }, { weight: 700, italic: true }]);
    await act(async () => root.render(<Probe family="Inter" />)); expect(command).toHaveBeenCalledTimes(1);
    command.mockRejectedValue(new Error("no font"));
    await act(async () => root.render(<Probe family="Missing" />));
    await act(async () => usePhotoWorkspace.setState({ busy: true })); await act(async () => usePhotoWorkspace.setState({ busy: false }));
    expect(command).toHaveBeenCalledTimes(2); expect(seen).toEqual([]);
  });
});
