import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMenu } from "./menus";
import { useXDProjects } from "@/apps/xdesign/projectsStore";
import { useXDesign } from "@/apps/xdesign/store";
import { useFxStore } from "@/apps/xdesign/fx/fxStore";

const click = (label: string) => {
  const item = buildMenu("xdesign", "Edit").find(item => item.type !== "separator" && item.label === label);
  if (!item || item.type === "separator") throw new Error(`No ${label} item`);
  item.onClick();
};

describe("XDesign Edit menu", () => {
  beforeEach(() => {
    useXDProjects.setState({ activeId: "fx-1", registry: [{ id: "fx-1", name: "FX", createdAt: 0, updatedAt: 0, kind: "fx" }] });
    useFxStore.getState().hydrateFx({ scene: { ...useFxStore.getState().scene, layers: [] } } as never);
  });

  it("undoes and redoes the FX scene, not the design document, while an FX project is open", () => {
    const designUndo = vi.spyOn(useXDesign.getState(), "undo");
    useFxStore.getState().patchScene({ background: "#123456" } as never);
    const edited = useFxStore.getState().scene;
    click("Undo");
    expect(useFxStore.getState().scene).not.toBe(edited);
    expect(designUndo).not.toHaveBeenCalled();
    click("Redo");
    expect(useFxStore.getState().scene).toBe(edited);
  });
});
