import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useXDProjects } from "./projectsStore";
import { ProjectChangeStatus } from "./ProjectChangeStatus";

let root: Root, container: HTMLDivElement;
const status = () => container.querySelector('[role="status"]');
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers(); useXDProjects.setState({ transitioning: false });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); useXDProjects.setState({ transitioning: false }); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("project change status", () => {
  it("says the project is loading once a change runs long, without flashing on a quick switch", async () => {
    await act(async () => root.render(<ProjectChangeStatus/>));
    await act(async () => { useXDProjects.setState({ transitioning: true }); await vi.advanceTimersByTimeAsync(300); });
    expect(status()).toBeNull();
    await act(async () => { useXDProjects.setState({ transitioning: false }); });
    await act(async () => { useXDProjects.setState({ transitioning: true }); await vi.advanceTimersByTimeAsync(300); });
    expect(status()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(status()?.textContent).toBe("Loading project…");
    await act(async () => { useXDProjects.setState({ transitioning: false }); });
    expect(status()).toBeNull();
  });
});
