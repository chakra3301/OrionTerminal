import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneGraph } from "@open-pencil/scene-graph";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { serializeGraph } from "./document";
import { startPencilSession, usePencilWorkspace } from "./runtime";
import { AssetsPanel } from "./AssetsPanel";
import { isDesignDialogOpen } from "../useDesignDialog";

const database = vi.hoisted(() => ({ value: null as unknown, wait: null as Promise<void> | null, fail: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("@/lib/db", () => ({
  getAppState: vi.fn(async () => structuredClone(database.value)),
  compareAndSetXDesignLibraries: vi.fn(async (value: unknown) => { await database.wait; if(database.fail)throw new Error("Library database unavailable"); database.value=structuredClone(value); }),
}));

let root: Root, container: HTMLDivElement, session: ReturnType<typeof startPencilSession>;
function Shell() { const busy=usePencilWorkspace(s=>s.busy); return <section className="xd-pencil"><div className="xd-pencil-body" inert={busy}><aside className="xd-pencil-layers"><AssetsPanel/></aside></div></section>; }
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(node=>node.textContent===name)!;
const click = async (name:string) => { await act(async()=>{button(name).click();}); };
async function until(predicate:()=>boolean) { for(let i=0;i<200;i++){if(predicate())return;await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});}throw new Error(`The panel did not finish its library action: ${container.textContent}`); }
beforeEach(async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); database.value=null;database.wait=null;database.fail=false;
  useXDesign.getState().hydrate(null);const id=ulid();useXDProjects.setState({activeId:id,transitioning:false,ready:true,registry:[{id,name:"Controls",createdAt:0,updatedAt:0}]});usePencilWorkspace.setState({busy:false});
  const graph=new SceneGraph();graph.createNode("COMPONENT",graph.getPages()[0]!.id,{name:"Button",width:140,height:40});
  const doc={formatVersion:1 as const,graph:serializeGraph(graph),pageId:graph.getPages()[0]!.id,panX:0,panY:0,zoom:1,photoLinks:{}};useXDesign.setState({pencilDocument:doc});session=startPencilSession(document.createElement("div"),doc,()=>undefined);
  container=document.createElement("div");document.body.append(container);root=createRoot(container);await act(async()=>{root.render(<Shell/>);});await until(()=>!container.textContent?.includes("Loading libraries"));
});
afterEach(async()=>{await act(async()=>{root.unmount();session.dispose();});container.remove();vi.unstubAllGlobals();});

describe("Assets panel library workflow",()=>{
  it("filters publication choices without losing selection and reviews only the chosen component",async()=>{
    await act(async()=>{session.editor.graph.createNode("COMPONENT",session.editor.graph.getPages()[0]!.id,{name:"Private draft",width:40,height:40});usePencilWorkspace.setState(s=>({version:s.version+1}));});
    await click("Publish");const dialog=container.querySelector('[role="dialog"]')!;
    await act(async()=>dialog.querySelector<HTMLInputElement>('[aria-label="Publish Private draft"]')!.click());
    const search=dialog.querySelector<HTMLInputElement>('[aria-label="Search components to publish"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(search,"Private");search.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(dialog.querySelector('[aria-label="Publish Button"]')).toBeNull();expect(dialog.querySelector<HTMLInputElement>('[aria-label="Publish Private draft"]')!.checked).toBe(false);
    await click("Review components");await until(()=>Boolean(button("Publish revision")));
    expect(dialog.querySelector(".xd-library-changes")?.textContent).toContain("Button");expect(dialog.querySelector(".xd-library-changes")?.textContent).not.toContain("Private draft");
    await click("Back");expect(dialog.textContent).toContain("1 of 2 selected");await click("Clear");expect(button("Review components").disabled).toBe(true);
    await click("Select all");expect(button("Review components").disabled).toBe(false);
  });
  it("publishes the reviewed library from a usable modal outside the busy canvas body",async()=>{
    await click("Publish");expect(isDesignDialogOpen()).toBe(true);await click("Review components");await until(()=>Boolean(button("Publish revision")));
    let release:()=>void=()=>undefined;database.wait=new Promise<void>(resolve=>{release=resolve;});await click("Publish revision");
    expect(usePencilWorkspace.getState().busy).toBe(true);const dialog=container.querySelector('[role="dialog"]')!;expect(dialog.closest("[inert]")).toBeNull();expect(container.querySelector(".xd-pencil-body")?.hasAttribute("inert")).toBe(true);
    await act(async()=>{release();});await until(()=>!container.querySelector('[role="dialog"]'));
    await until(()=>Boolean(container.textContent?.includes("Controls components")));expect(database.value).toBeTruthy();expect(isDesignDialogOpen()).toBe(false);
  });
  it("shows a save failure while retaining the review and the original components",async()=>{
    await click("Publish");await click("Review components");await until(()=>Boolean(button("Publish revision")));database.fail=true;await click("Publish revision");await until(()=>Boolean(container.querySelector('[role="alert"]')));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("database unavailable");expect(button("Publish revision")).toBeTruthy();expect(database.value).toBeNull();expect([...session.editor.graph.nodes.values()].find(n=>n.name==="Button")?.componentKey).toBeNull();
  });
  it("captures enable preferences and inserts from the library section through the shared tool adapter",async()=>{
    await click("Publish");await click("Review components");await until(()=>Boolean(button("Publish revision")));await click("Publish revision");await until(()=>!container.querySelector('[role="dialog"]'));
    await until(()=>Boolean(container.querySelector(".xd-library")));
    const library=container.querySelector(".xd-library")!;const checkbox=library.querySelector<HTMLInputElement>('input[type="checkbox"]')!;await until(()=>!checkbox.disabled);await act(async()=>{checkbox.click();});await until(()=>Boolean(library.querySelector("button[title='Insert library instance']")));
    expect(checkbox.checked).toBe(true);await until(()=>!library.querySelector<HTMLButtonElement>("button[title='Insert library instance']")!.disabled);await act(async()=>{library.querySelector<HTMLButtonElement>("button[title='Insert library instance']")!.click();});await until(()=>session.editor.getSelectedNodes()[0]?.type==="INSTANCE");
    expect(session.editor.getSelectedNodes()[0]?.width).toBe(140);
  });
});
