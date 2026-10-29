import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrushPresetPicker } from "./OptionsBarControls";

vi.mock("./PresetPreview", () => ({ PresetPreview: ({ preset }: { preset: string }) => <span data-testid="preview">{preset}</span> }));

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const presets = [{ name: "Soft Round", group: "General Brushes", size: 30, hardness: 0 }, { name: "Loose", group: "", size: 12, hardness: .8 }, { name: "Chalk", group: "Dry Media", size: 60, hardness: .5 }, { name: "Hard Round", group: "General Brushes", size: 30, hardness: 1 }];
const byLabel = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const folder = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("[role=dialog] button[aria-expanded]")].find(element => element.textContent === name);
const brushesIn = (group: string) => [...byLabel(group)!.querySelectorAll("button[aria-label^='Use brush ']")].map(element => element.getAttribute("aria-label"));

describe("BrushPresetPicker folders", () => {
  it("shows presets in Photoshop's folder groups that fold open and shut, keeping the fold across reopening", () => {
    const selectPreset = vi.fn();
    act(() => root.render(<BrushPresetPicker size={30} hardness={0} maxSize={500} presets={presets} change={vi.fn()} commit={vi.fn()} selectPreset={selectPreset} />));
    act(() => byLabel("Brush preset picker")!.click());
    expect(brushesIn("General Brushes")).toEqual(["Use brush Soft Round", "Use brush Hard Round"]);
    expect(brushesIn("Dry Media")).toEqual(["Use brush Chalk"]);
    expect(brushesIn("Ungrouped brushes")).toEqual(["Use brush Loose"]);
    expect(folder("General Brushes")!.getAttribute("aria-expanded")).toBe("true");
    act(() => folder("General Brushes")!.click());
    expect(folder("General Brushes")!.getAttribute("aria-expanded")).toBe("false");
    expect(brushesIn("General Brushes")).toEqual([]);
    act(() => byLabel("Brush preset picker")!.click());
    act(() => byLabel("Brush preset picker")!.click());
    expect(folder("General Brushes")!.getAttribute("aria-expanded")).toBe("false");
    act(() => byLabel("Use brush Chalk")!.click());
    expect(selectPreset).toHaveBeenCalledWith("Chalk");
  });
  it("lists empty groups and creates a group from Photoshop's Create new group and its Group Name prompt", async () => {
    const newGroup = vi.fn(async () => undefined);
    act(() => root.render(<BrushPresetPicker size={30} hardness={0} maxSize={500} presets={presets} groups={["General Brushes", "Dry Media", "Mine"]} newGroup={newGroup} change={vi.fn()} commit={vi.fn()} selectPreset={vi.fn()} />));
    act(() => byLabel("Brush preset picker")!.click());
    expect(folder("Mine")).toBeTruthy(); expect(brushesIn("Mine")).toEqual([]);
    act(() => byLabel("Create new group")!.click());
    const name = container.querySelector<HTMLInputElement>('input[aria-label="Group Name"]')!; expect(name.value).toBe("Group 4");
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "  Inks "); name.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => container.querySelector<HTMLFormElement>('form[aria-label="Group Name"]')!.requestSubmit());
    expect(newGroup).toHaveBeenCalledTimes(1); expect(newGroup).toHaveBeenCalledWith("Inks"); expect(byLabel("Group Name")).toBeNull();
    act(() => root.render(<BrushPresetPicker size={30} hardness={0} maxSize={500} presets={presets} newGroup={newGroup} disabled change={vi.fn()} commit={vi.fn()} selectPreset={vi.fn()} />));
    expect((byLabel("Create new group") as HTMLButtonElement).disabled).toBe(true);
    act(() => root.render(<BrushPresetPicker size={30} hardness={0} maxSize={500} presets={presets} change={vi.fn()} commit={vi.fn()} selectPreset={vi.fn()} />));
    expect(byLabel("Create new group")).toBeNull();
  });
});
