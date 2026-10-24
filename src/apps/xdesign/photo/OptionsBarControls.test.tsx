import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrushPresetPicker, GradientTypeIcons, PopupSlider, SelectionModeCluster } from "./OptionsBarControls";

vi.mock("./PresetPreview", () => ({ PresetPreview: ({ preset }: { preset: string }) => <span data-testid="preview">{preset}</span> }));

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const byLabel = <T extends HTMLElement = HTMLElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`);
const render = (node: React.ReactElement) => act(() => root.render(node));
const click = (el: HTMLElement) => act(() => el.click());
const fire = (el: Element, type: string, init: MouseEventInit & { key?: string } = {}) => act(() => { el.dispatchEvent(type.startsWith("key") ? new KeyboardEvent(type, { bubbles: true, ...init }) : new MouseEvent(type, { bubbles: true, ...init })); });
function type(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("SelectionModeCluster", () => {
  it("renders only the given modes with pressed state and reports clicks", () => {
    const change = vi.fn();
    render(<SelectionModeCluster value="add" modes={["replace", "add", "subtract"]} change={change} />);
    expect(container.querySelectorAll("button")).toHaveLength(3);
    expect(byLabel("Intersect with selection")).toBeNull();
    expect(byLabel("Add to selection")!.getAttribute("aria-pressed")).toBe("true");
    expect(byLabel("New selection")!.getAttribute("aria-pressed")).toBe("false");
    click(byLabel("Subtract from selection")!);
    expect(change).toHaveBeenCalledWith("subtract");
  });
});

describe("GradientTypeIcons", () => {
  it("marks the active type and reports changes", () => {
    const change = vi.fn();
    render(<GradientTypeIcons value="radial" change={change} />);
    expect(container.querySelectorAll("button")).toHaveLength(5);
    expect(byLabel("Radial Gradient")!.getAttribute("aria-pressed")).toBe("true");
    click(byLabel("Diamond Gradient")!);
    expect(change).toHaveBeenCalledWith("diamond");
  });
});

describe("PopupSlider", () => {
  const slider = (props: Partial<Parameters<typeof PopupSlider>[0]> = {}) => {
    const change = vi.fn(), commit = vi.fn();
    render(<PopupSlider label="Opacity" ariaLabel="Opacity value" value={50} min={0} max={100} unit="%" change={change} commit={commit} {...props} />);
    return { change, commit };
  };

  it("changes on input, clamps, and commits on blur", () => {
    const { change, commit } = slider();
    const input = byLabel<HTMLInputElement>("Opacity value")!;
    type(input, "70");
    expect(change).toHaveBeenLastCalledWith(70);
    type(input, "250");
    expect(change).toHaveBeenLastCalledWith(100);
    act(() => { input.focus(); input.blur(); });
    expect(commit).toHaveBeenCalledWith(50);
  });

  it("commits once on Enter", () => {
    const { commit } = slider();
    const input = byLabel<HTMLInputElement>("Opacity value")!;
    act(() => input.focus());
    fire(input, "keydown", { key: "Enter" });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("opens a range that changes and commits on pointerup, then closes on Escape refocusing the chevron", () => {
    const { change, commit } = slider();
    const chevron = byLabel("Show opacity slider")!;
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    const range = byLabel<HTMLInputElement>("Opacity value slider")!;
    type(range, "30");
    expect(change).toHaveBeenLastCalledWith(30);
    fire(range, "pointerup");
    expect(commit).toHaveBeenCalledOnce();
    act(() => range.focus());
    fire(range, "keydown", { key: "Escape" });
    expect(byLabel("Opacity value slider")).toBeNull();
    expect(document.activeElement).toBe(chevron);
  });

  it("closes on outside pointerdown and commits a changed value", () => {
    const Harness = ({ commit }: { commit: (v: number) => void }) => { const [v, setV] = useState(50); return <PopupSlider label="Opacity" ariaLabel="Opacity value" value={v} min={0} max={100} change={setV} commit={commit} />; };
    const commit = vi.fn();
    render(<Harness commit={commit} />);
    click(byLabel("Show opacity slider")!);
    type(byLabel<HTMLInputElement>("Opacity value slider")!, "20");
    fire(document.body, "pointerdown");
    expect(byLabel("Opacity value slider")).toBeNull();
    expect(commit).toHaveBeenCalledWith(20);
  });

  it("scrubs with the label, Shift multiplies by ten, and commits on release", () => {
    const { change, commit } = slider();
    const label = container.querySelector(".xd-ps-scrub")!;
    fire(label, "pointerdown", { clientX: 100 });
    fire(label, "pointermove", { clientX: 110 });
    expect(change).toHaveBeenLastCalledWith(60);
    fire(label, "pointermove", { clientX: 130, shiftKey: true });
    expect(change).toHaveBeenLastCalledWith(100);
    fire(label, "pointermove", { clientX: 0 });
    expect(change).toHaveBeenLastCalledWith(0);
    fire(label, "pointerup", { clientX: 0 });
    expect(commit).toHaveBeenCalledExactlyOnceWith(0);
  });
});

describe("BrushPresetPicker", () => {
  const presets = [{ name: "Soft Round", group: "General", size: 30, hardness: 0 }, { name: "Hard Round", group: "General", size: 20.4, hardness: 1 }];
  const setup = (props: Partial<Parameters<typeof BrushPresetPicker>[0]> = {}) => {
    const spies = { change: vi.fn(), commit: vi.fn(), selectPreset: vi.fn() };
    const Harness = () => {
      const [s, setS] = useState({ size: 40, hardness: 0.5 });
      return <BrushPresetPicker {...s} maxSize={500} presets={presets} revision={1} {...props} change={p => { spies.change(p); setS(c => ({ ...c, ...p })); }} commit={spies.commit} selectPreset={spies.selectPreset} />;
    };
    render(<Harness />);
    click(byLabel("Brush preset picker")!);
    return spies;
  };

  it("opens as a dialog and focuses the size field", () => {
    setup();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(byLabel("Brush size"));
  });

  it("changes and commits size", () => {
    const s = setup();
    const input = byLabel<HTMLInputElement>("Brush size")!;
    type(input, "64");
    expect(s.change).toHaveBeenLastCalledWith({ size: 64 });
    type(input, "9999");
    expect(s.change).toHaveBeenLastCalledWith({ size: 500 });
    act(() => input.blur());
    expect(s.commit).toHaveBeenLastCalledWith({ size: 500 });
    fire(byLabel("Brush size slider")!, "pointerup");
    expect(s.commit).toHaveBeenCalledTimes(2);
  });

  it("scales hardness to 0..1", () => {
    const s = setup();
    type(byLabel<HTMLInputElement>("Brush hardness")!, "80");
    expect(s.change).toHaveBeenLastCalledWith({ hardness: 0.8 });
    act(() => byLabel<HTMLInputElement>("Brush hardness")!.focus());
    act(() => byLabel<HTMLInputElement>("Brush hardness")!.blur());
    expect(s.commit).toHaveBeenLastCalledWith({ hardness: 0.8 });
    type(byLabel<HTMLInputElement>("Brush hardness slider")!, "25");
    expect(s.change).toHaveBeenLastCalledWith({ hardness: 0.25 });
  });

  it("selects presets and stays open", () => {
    const s = setup();
    click(byLabel("Use brush Hard Round")!);
    expect(s.selectPreset).toHaveBeenCalledWith("Hard Round");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(byLabel("Use brush Hard Round")!.title).toBe("General · 20 px");
  });

  it("opens at a point for a canvas right-click and dismisses through the caller", () => {
    const dismiss = vi.fn();
    render(<BrushPresetPicker size={10} hardness={1} maxSize={500} presets={presets} at={{ x: 30, y: 40 }} dismiss={dismiss} change={vi.fn()} commit={vi.fn()} selectPreset={vi.fn()} />);
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect([dialog.style.left, dialog.style.top]).toEqual(["30px", "40px"]);
    expect(document.activeElement).toBe(byLabel("Brush size"));
    fire(byLabel("Brush size")!, "keydown", { key: "Escape" });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("hides hardness when asked and closes on Escape", () => {
    setup({ showHardness: false });
    expect(byLabel("Brush hardness")).toBeNull();
    fire(byLabel("Brush size")!, "keydown", { key: "Escape" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(byLabel("Brush preset picker"));
  });
});
