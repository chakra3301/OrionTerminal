import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { SettingsSlider } from "./SettingsSlider";

it("provides a labelled native range, current value and description", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Example() { const [value, set] = useState(.35); return <SettingsSlider label="Intensity" value={value} valueText={`${Math.round(value * 100)}%`} onChange={set} hint="Applied immediately" />; }
  await act(async () => root.render(<Example />));
  const input = host.querySelector("input")!;
  expect(input.type).toBe("range"); expect(input.min).toBe("0"); expect(input.max).toBe("1");
  expect(host.querySelector("label")?.htmlFor).toBe(input.id);
  expect(input.getAttribute("aria-valuetext")).toBe("35%");
  expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("Applied immediately");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, ".6");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input.getAttribute("aria-valuetext")).toBe("60%");
  await act(async () => root.unmount()); host.remove();
});
