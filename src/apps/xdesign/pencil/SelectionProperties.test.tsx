import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneNode } from "@open-pencil/scene-graph";
import { SelectionProperties } from "./SelectionProperties";
import { usePencilWorkspace } from "./runtime";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
let editor: Editor, node: SceneNode, root: Root, container: HTMLDivElement;
const render = () => act(async () => root.render(<SelectionProperties node={node}/>));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); editor = createEditor(); usePencilWorkspace.setState({ editor });
  node = editor.graph.createNode("RECTANGLE", editor.state.currentPageId, { x: 41.3999999, y: 10, width: 160, height: 100 });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); await render();
});
afterEach(() => { act(() => root.unmount()); container.remove(); editor.dispose(); usePencilWorkspace.setState({ editor: null }); vi.unstubAllGlobals(); });

describe("design selection properties", () => {
  it("rounds imported positions for display without committing the rounded value", async () => {
    const x = container.querySelector<HTMLInputElement>('input[aria-label="X"]')!;
    expect(x.value).toBe("41.4");
    await act(async () => { x.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(node.x).toBe(41.3999999);
    await act(async () => { x.value = "50"; x.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(node.x).toBe(50);
  });
});
