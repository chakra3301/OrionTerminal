import { act } from "react";
import { getAppState } from "@/lib/db";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneGraph, getSharedStyles, hasInstanceOverride } from "@open-pencil/scene-graph";
import { ulid } from "ulid";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { usePhotoWorkspace } from "../photo/runtime";
import { usePencilWorkspace } from "./runtime";
import { serializeGraph } from "./document";
import { PencilStudio } from "./PencilStudio";
import { allComments, resolveCommentAnchor } from "./comments";
import { SharedDesign } from './sharedDesign';
import { encodeSharedCheckpoint } from './sharedCheckpoint';
import { deserializeGraph, validatePencilDocument } from './document';
import { roomGrantState, type PendingRoomCreation } from './roomGrants';

const canvas = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("@/lib/db", () => ({ getAppState: vi.fn(async () => null) }));
vi.mock("./runtime", async original => ({ ...await original<typeof import("./runtime")>(), initializeCanvasKit: async () => undefined }));
vi.mock("./CanvasHost", () => ({ mountPencilCanvas: (element: HTMLElement, _editor: unknown, ready: () => void) => { canvas.mount(); const surface = document.createElement("canvas"); element.append(surface); ready(); return () => { canvas.unmount(); surface.remove(); }; } }));
let root: Root, container: HTMLDivElement, rectangleId: string, frameId: string;
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(element => element.getAttribute("aria-label") === label || element.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.mocked(getAppState).mockReset().mockResolvedValue(null);
  canvas.mount.mockClear(); canvas.unmount.mockClear(); useXDesign.getState().hydrate(null); usePhotoWorkspace.setState({ shapeId: null });
  const graph = new SceneGraph(), page = graph.getPages()[0]!;
  rectangleId = graph.createNode("RECTANGLE", page.id, { name: "Accent", width: 120, height: 80 }).id;
  frameId = graph.createNode("FRAME", page.id, { name: "Screen", width: 400, height: 800, layoutMode: "VERTICAL" }).id;
  const projectId = ulid();
  useXDProjects.setState({ activeId: projectId, transitioning: false, ready: true, registry: [{ id: projectId, name: "Layout study", createdAt: 0, updatedAt: 0 }] });
  useXDesign.setState({ pencilDocument: { formatVersion: 1, graph: serializeGraph(graph), pageId: page.id, panX: 0, panY: 0, zoom: 1, photoLinks: {} } });
  usePencilWorkspace.setState({ busy: false, error: null });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<PencilStudio/>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("Design workspace layout", () => {
  it("keeps the workspace focusable so WebKit clicks on layer rows still route ⇧1/⇧2 to it", async () => {
    expect(container.querySelector(`section[aria-label="Design workspace"]`)!.getAttribute("tabindex")).toBe("-1");
  });
  it('reopens a checkpoint through the normal canvas startup and retains selective editing', async () => {
    act(() => root.unmount());
    const doc=useXDesign.getState().pencilDocument!,replica=SharedDesign.fromGraph(deserializeGraph(doc.graph));
    try{
      replica.edit('Before closing',graph=>graph.updateNode(rectangleId,{x:260}));
      useXDesign.setState({pencilDocument:{...doc,graph:serializeGraph(replica.graph),shared:encodeSharedCheckpoint(ulid(),replica.update())}});
      root=createRoot(container);
      await act(async()=>{root.render(<PencilStudio/>);});
      await act(async()=>{await vi.waitFor(()=>expect(usePencilWorkspace.getState().editor).not.toBeNull());});
      const editor=usePencilWorkspace.getState().editor!;expect(container.querySelector('canvas')).not.toBeNull();expect(editor.graph.getNode(rectangleId)!.x).toBe(260);
      await act(async()=>{editor.updateNodeWithUndo(rectangleId,{x:320});editor.undoAction();});
      expect(editor.graph.getNode(rectangleId)!.x).toBe(260);validatePencilDocument(useXDesign.getState().pencilDocument!);expect(useXDesign.getState().pencilDocument!.shared).toBeDefined();
    }finally{replica.dispose();}
  });
  it('opens libraries from the main menu with publishing controls and closes on Escape or Close', async () => {
    expect(container.querySelector('[aria-label="Libraries"]')).toBeNull();
    await click('Main menu'); await click('Libraries…');
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Libraries"]')).not.toBeNull(), {timeout:5000});
    const dialog = container.querySelector('[role="dialog"][aria-label="Libraries"]')!; expect(dialog).not.toBeNull(); expect(dialog.contains(button('Publish'))).toBe(true); expect(button('Publish').disabled).toBe(false);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('[aria-label="Libraries"]')).toBeNull();
    await act(async () => container.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO', key: 'ø', altKey: true, metaKey: true, bubbles: true })));
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Libraries"]')).not.toBeNull(), {timeout:5000});
    await click('Close'); expect(container.querySelector('[aria-label="Libraries"]')).toBeNull();
  });
  it("keeps the editor, graph and canvas alive as panels collapse and reopen", async () => {
    const editor = usePencilWorkspace.getState().editor, surface = container.querySelector("canvas");
    await click("Hide layers panel"); await click("Show layers panel"); await click("Hide properties panel"); await click("Show properties panel");
    expect(usePencilWorkspace.getState().editor).toBe(editor); expect(container.querySelector("canvas")).toBe(surface);
    expect(canvas.mount).toHaveBeenCalledOnce(); expect(canvas.unmount).not.toHaveBeenCalled();
  });
  it("shows layout controls for a frame and updates geometry with real undo from the inspector", async () => {
    const editor = usePencilWorkspace.getState().editor!;
    await act(async () => { editor.select([rectangleId]); editor.requestRender(); });
    expect(container.querySelector('[aria-label="Auto layout"]')).toBeNull();
    const width = container.querySelector<HTMLInputElement>('[aria-label="Width"]')!;
    await act(async () => { width.value = "243"; width.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(editor.graph.getNode(rectangleId)?.width).toBe(243);
    await click("Undo"); expect(editor.graph.getNode(rectangleId)?.width).toBe(120);
    await act(async () => { editor.select([frameId]); editor.requestRender(); });
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Auto layout"]')!.value).toBe("VERTICAL");
    expect(container.querySelector('[aria-label="Primary alignment"]')?.closest("details")?.querySelector("summary")?.textContent).toBe("Auto layout");
  });
  it("switches pages through the Pages list while retaining the canvas session", async () => {
    const editor = usePencilWorkspace.getState().editor!;
    const previous = editor.state.currentPageId; await click("Add page");
    const pages = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Pages"] [role="option"]')];
    expect(pages).toHaveLength(2);
    await act(async () => pages.find(page => page.textContent === editor.graph.getNode(previous)!.name)!.click());
    expect(editor.state.currentPageId).toBe(previous); expect(canvas.mount).toHaveBeenCalledOnce();
  });
  it("edits mixed selections together in one undo step without touching locked descendants", async () => {
    const editor=usePencilWorkspace.getState().editor!;
    const second=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{opacity:.6});
    const locked=editor.graph.createNode("FRAME",editor.state.currentPageId,{locked:true});
    const child=editor.graph.createNode("RECTANGLE",locked.id,{opacity:.8});
    await act(async()=>{editor.select([rectangleId,second.id,child.id]);editor.requestRender();});
    expect(container.textContent).toContain("3 layers selected");
    const opacity=container.querySelector<HTMLInputElement>('[aria-label="Selection Opacity %"]')!;
    expect(opacity.placeholder).toBe("Mixed");
    await act(async()=>{opacity.value="35";opacity.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));});
    expect(editor.graph.getNode(rectangleId)?.opacity).toBe(.35);expect(second.opacity).toBe(.35);expect(child.opacity).toBe(.8);
    await click("Undo");expect(editor.graph.getNode(rectangleId)?.opacity).toBe(1);expect(second.opacity).toBe(.6);
  });
  it("creates and applies a shared stroke style while preserving each target's geometry and undo", async () => {
    const editor=usePencilWorkspace.getState().editor!;
    const red={r:1,g:0,b:0,a:1};
    editor.graph.updateNode(rectangleId,{strokes:[{color:red,weight:5,align:"INSIDE",visible:true,opacity:1,dashPattern:[2,3]}]});
    await act(async()=>{editor.select([rectangleId]);editor.requestRender();});
    const type=container.querySelector<HTMLSelectElement>('[aria-label="Shared style type"]')!;
    await act(async()=>{type.value="stroke";type.dispatchEvent(new Event("change",{bubbles:true}));});
    await click("Create from selection");
    const style=getSharedStyles(editor.graph,"stroke")[0]!;
    expect(editor.graph.getNode(style.nodeId)?.fills[0]?.color).toEqual(red);
    const target=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{strokes:[{color:{r:0,g:0,b:0,a:1},weight:12,align:"OUTSIDE",visible:true,opacity:.3,cap:"ROUND",dashPattern:[7,9]}]});
    await act(async()=>{editor.select([target.id]);editor.requestRender();});
    await act(async()=>{const picker=container.querySelector<HTMLSelectElement>('[aria-label="Shared style type"]')!;picker.value="stroke";picker.dispatchEvent(new Event("change",{bubbles:true}));});
    const selector=container.querySelector<HTMLSelectElement>('[aria-label="Shared style"]')!;
    await act(async()=>{selector.value=style.id;selector.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(target.strokes[0]).toMatchObject({color:red,weight:12,align:"OUTSIDE",cap:"ROUND",dashPattern:[7,9],opacity:1});
    expect(target.strokeStyleId).toBe(style.id);
    await click("Undo");expect(target.strokeStyleId).toBeNull();expect(target.strokes[0]?.opacity).toBe(.3);
  });
  it("edits ellipse arc and ring geometry in native radians and restores it through undo", async () => {
    const editor=usePencilWorkspace.getState().editor!;
    const ellipse=editor.graph.createNode("ELLIPSE",editor.state.currentPageId);
    await act(async()=>{editor.select([ellipse.id]);editor.requestRender();});
    const sweep=container.querySelector<HTMLInputElement>('[aria-label="Arc sweep °"]')!;
    await act(async()=>{sweep.value="180";sweep.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));});
    expect(ellipse.arcData).toMatchObject({startingAngle:0,endingAngle:Math.PI,innerRadius:0});
    const radius=container.querySelector<HTMLInputElement>('[aria-label="Ring inner radius %"]')!;
    await act(async()=>{radius.value="50";radius.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));});
    expect(ellipse.arcData?.innerRadius).toBe(.5);
    await click("Undo");expect(ellipse.arcData?.innerRadius).toBe(0);
    await click("Undo");expect(ellipse.arcData).toBeNull();
  });

  it("updates shared styles from an edited detached layer and updates consumers with one undo", async () => {
    const editor=usePencilWorkspace.getState().editor!,red={r:1,g:0,b:0,a:1},blue={r:0,g:0,b:1,a:1};
    const second=editor.graph.createNode("RECTANGLE",editor.state.currentPageId);
    editor.graph.updateNode(rectangleId,{fills:[{type:"SOLID",color:red,opacity:1,visible:true}]});
    await act(async()=>{editor.select([rectangleId,second.id]);editor.requestRender();});await click("Create from selection");
    const style=getSharedStyles(editor.graph,"fill")[0]!;
    await act(async()=>{editor.updateNodeWithUndo(rectangleId,{fills:[{type:"SOLID",color:blue,opacity:1,visible:true}]});editor.select([rectangleId]);editor.requestRender();});
    expect(editor.graph.getNode(rectangleId)?.fillStyleId).toBeNull();
    const manage=container.querySelector<HTMLSelectElement>('[aria-label="Manage shared style"]')!;
    await act(async()=>{manage.value=style.id;manage.dispatchEvent(new Event("change",{bubbles:true}));});await click("Update style");
    expect(second.fills[0]?.color).toEqual(blue);expect(editor.graph.getNode(rectangleId)?.fillStyleId).toBe(style.id);
    await click("Undo");expect(second.fills[0]?.color).toEqual(red);expect(editor.graph.getNode(rectangleId)?.fills[0]?.color).toEqual(blue);expect(editor.graph.getNode(rectangleId)?.fillStyleId).toBeNull();
  });
  it("edits independent corners, nullable size limits and OpenType features through the inspector",async()=>{
    const editor=usePencilWorkspace.getState().editor!;
    await act(async()=>{editor.select([rectangleId]);editor.requestRender();});
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Independent corners"]')!.click());
    const radius=container.querySelector<HTMLInputElement>('[aria-label="Top left radius"]')!;
    await act(async()=>{radius.value="15";radius.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));});
    expect(editor.graph.getNode(rectangleId)).toMatchObject({independentCorners:true,topLeftRadius:15,topRightRadius:0});
    const limit=container.querySelector<HTMLInputElement>('[aria-label="Max width"]')!;
    await act(async()=>{limit.value="200";limit.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));});expect(editor.graph.getNode(rectangleId)?.maxWidth).toBe(200);
    const newLimit=container.querySelector<HTMLInputElement>('[aria-label="Max width"]')!;
    await act(async()=>{newLimit.value="";newLimit.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));});expect(editor.graph.getNode(rectangleId)?.maxWidth).toBeNull();
    const text=editor.graph.createNode("TEXT",editor.state.currentPageId,{text:"Office 0123"});
    await act(async()=>{editor.select([text.id]);editor.requestRender();});await click("Add font feature");expect(text.fontFeatures).toEqual([{tag:"liga",enabled:true}]);
    await click("Undo");expect(text.fontFeatures).toEqual([]);
  });

  it("records component overrides for a bulk edit in one graph transaction",async()=>{
    const editor=usePencilWorkspace.getState().editor!,page=editor.state.currentPageId;
    const main=editor.graph.createNode("COMPONENT",page,{name:"Card"});
    const template=editor.graph.createNode("RECTANGLE",main.id,{opacity:.8});
    const first=editor.graph.createInstance(main.id,page)!,second=editor.graph.createInstance(main.id,page)!;
    const childA=editor.graph.getNode(first.childIds[0]!)!,childB=editor.graph.getNode(second.childIds[0]!)!;
    await act(async()=>{editor.select([childA.id,childB.id]);editor.requestRender();});
    const push=vi.spyOn(editor,"pushUndoEntry");
    const input=container.querySelector<HTMLInputElement>('[aria-label="Selection Opacity %"]')!;
    await act(async()=>{input.value="40";input.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));});
    expect(push).toHaveBeenCalledOnce();expect(childA.opacity).toBe(.4);expect(childB.opacity).toBe(.4);expect(template.opacity).toBe(.8);
    expect(hasInstanceOverride(editor.graph,childA.id,"opacity")).toBe(true);expect(hasInstanceOverride(editor.graph,childB.id,"opacity")).toBe(true);
    await click("Undo");expect(childA.opacity).toBe(.8);expect(childB.opacity).toBe(.8);expect(hasInstanceOverride(editor.graph,childA.id,"opacity")).toBe(false);
  });

});


async function commentInput(label:string,value:string){const input=container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement|HTMLTextAreaElement;const prototype=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;await act(async()=>{Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
async function commentSubmit(label:string){await act(async()=>container.querySelector(`[aria-label="${label}"]`)!.closest("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
describe("Project comment workflow",()=>{
  it("posts/replies/reacts/edits/resolves/reopens and deletes through the real panel with one-step undo",async()=>{
    const editor=usePencilWorkspace.getState().editor!;await click("Comments");await act(async()=>{editor.select([rectangleId]);editor.requestRender();});await click("Comment on selection");
    await commentInput("New comment","Review 日本語 <img src=x onerror=alert(1)>");await commentSubmit("New comment");let thread=allComments(editor.graph)[0]!;expect(thread.messages[0]!.body).toContain("日本語");expect(container.querySelector('.xd-comments-thread img')).toBeNull();expect(resolveCommentAnchor(editor.graph,thread).target?.id).toBe(rectangleId);
    await commentInput("Reply to comment","Looks good");await commentSubmit("Reply to comment");expect(allComments(editor.graph)[0]!.messages).toHaveLength(2);
    const react=container.querySelector<HTMLButtonElement>('[aria-label="React 👍"]')!;await act(async()=>react.click());expect(allComments(editor.graph)[0]!.messages[0]!.reactions[0]!.emoji).toBe("👍");
    await click("Edit");await commentInput("Edit comment","Edited review");await commentSubmit("Edit comment");expect(allComments(editor.graph)[0]!.messages[0]!.body).toBe("Edited review");await click("Undo");expect(allComments(editor.graph)[0]!.messages[0]!.body).toContain("日本語");
    await click("Resolve");expect(allComments(editor.graph)[0]!.resolved).toBe(true);await click("Reopen");expect(allComments(editor.graph)[0]!.resolved).toBe(false);
    await click("Delete");expect(allComments(editor.graph)).toHaveLength(1);await click("Keep comment");await click("Delete");await click("Confirm delete thread");expect(allComments(editor.graph)).toEqual([]);await click("Undo");expect(allComments(editor.graph)[0]!.messages).toHaveLength(2);expect(canvas.mount).toHaveBeenCalledOnce();
  });
  it("handles region drags, primary-pointer cancellation, pan/zoom and Escape without remounting the canvas",async()=>{
    const editor=usePencilWorkspace.getState().editor!;await click("Comments");await click("Pin on canvas");const overlay=container.querySelector<HTMLDivElement>('.xd-comment-canvas')!;
    overlay.getBoundingClientRect=()=>({left:10,top:20,width:800,height:600,right:810,bottom:620,x:10,y:20,toJSON(){}});overlay.setPointerCapture=vi.fn();overlay.releasePointerCapture=vi.fn();
    const pointer=async(type:string,x:number,y:number,id=1,primary=true,button=0)=>{await act(async()=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button});Object.defineProperties(event,{pointerId:{value:id},isPrimary:{value:primary}});overlay.dispatchEvent(event);});};
    await pointer("pointerdown",110,120,2,false);await pointer("pointerup",210,220,2,false);expect(container.querySelector('[aria-label="New comment"]')).toBeNull();
    await pointer("pointerdown",110,120);await pointer("pointermove",210,220);expect(overlay.querySelector("polygon.selected")).not.toBeNull();await pointer("pointercancel",210,220);expect(container.querySelector('[aria-label="New comment"]')).toBeNull();
    await pointer("pointerdown",110,120);await pointer("pointermove",210,220);await pointer("pointerup",210,220);await commentInput("New comment","Region review");await commentSubmit("New comment");expect(allComments(editor.graph)[0]!.anchor.points).toHaveLength(4);
    await click("Pin on canvas");const previousZoom=editor.state.zoom;await act(async()=>overlay.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaY:-50,ctrlKey:true,clientX:200,clientY:200})));expect(editor.state.zoom).toBeGreaterThan(previousZoom);
    const previousPan=editor.state.panX;await pointer("pointerdown",110,120,1,true,1);await pointer("pointermove",130,120);await pointer("pointerup",130,120,1,true,1);expect(editor.state.panX).toBe(previousPan+20);
    await pointer("pointerdown",150,160);await pointer("pointerup",150,160);const input=container.querySelector('[aria-label="New comment"]')!;await act(async()=>input.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Escape",isComposing:true})));expect(container.querySelector('[aria-label="New comment"]')).not.toBeNull();await act(async()=>input.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Escape"})));expect(container.querySelector('[aria-label="New comment"]')).toBeNull();expect(canvas.mount).toHaveBeenCalledOnce();
  });
  it("keeps C shortcuts out of IME/text entry and rejects a draft whose project changed",async()=>{
    const surface=container.querySelector("canvas")!;await act(async()=>surface.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"c",code:"KeyC",isComposing:true})));expect(container.querySelector('.xd-comment-canvas.placing')).toBeNull();
    await act(async()=>surface.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"c",code:"KeyC"})));expect(container.querySelector('.xd-comment-canvas.placing')).not.toBeNull();await click("Comment at view center");await commentInput("New comment","Stale draft");
    const editor=usePencilWorkspace.getState().editor!;useXDProjects.setState({activeId:ulid()});await commentSubmit("New comment");expect(allComments(editor.graph)).toEqual([]);expect(container.textContent).toContain("position or author changed");
  });
  it("filters page/status/search and jumps between pages while retaining the same editor session",async()=>{
    const editor=usePencilWorkspace.getState().editor!;await click("Comments");await click("Comment at view center");await commentInput("New comment","First page review");await commentSubmit("New comment");await act(async()=>editor.addPage());await click("Comment at view center");await commentInput("New comment","Second page review");await commentSubmit("New comment");
    const scope=container.querySelector<HTMLSelectElement>('[aria-label="Comment pages"]')!;await act(async()=>{scope.value="file";scope.dispatchEvent(new Event("change",{bubbles:true}));});expect(container.querySelectorAll('.xd-comments-list>button')).toHaveLength(2);
    await commentInput("Search comments","First");expect(container.querySelectorAll('.xd-comments-list>button')).toHaveLength(1);await act(async()=>(container.querySelector('.xd-comments-list>button') as HTMLButtonElement).click());expect(editor.state.currentPageId).toBe(allComments(editor.graph)[0]!.ownerPageId);expect(canvas.mount).toHaveBeenCalledOnce();
  });
  it('opens sharing without remounting the local canvas and keeps the desktop-only connection form disabled in a browser', async () => {
    const editor = usePencilWorkspace.getState().editor, surface = container.querySelector('canvas'); await click('Share');
    await vi.waitFor(async () => { await act(async () => {}); expect(container.querySelector('[aria-label="Share design"]')).not.toBeNull(); });
    expect(container.querySelector<HTMLInputElement>('[aria-label="Room server"]')!.matches(':disabled')).toBe(true); expect(container.textContent).toContain('Orion Terminal desktop'); await click('Close');
    expect(usePencilWorkspace.getState().editor).toBe(editor); expect(container.querySelector('canvas')).toBe(surface); expect(canvas.mount).toHaveBeenCalledOnce();
  });
  it('reopens a saved viewer with authoring disabled while retaining layer selection, comments search and export', async () => {
    act(() => root.unmount()); const original = useXDesign.getState().pencilDocument!, replica = SharedDesign.fromGraph(deserializeGraph(original.graph)), documentId = ulid();
    try {
      useXDesign.setState({ pencilDocument: { ...original, shared: encodeSharedCheckpoint(documentId, replica.update()) } });
      vi.mocked(getAppState).mockImplementation(async key => key === 'xdesign.rooms' ? { version: 1, rooms: [{ documentId, serverUrl: 'https://rooms.example.test/', revision: 2, role: 'viewer' }] } as never : null); root = createRoot(container); await act(async () => root.render(<PencilStudio/>));
      await act(async () => { await vi.waitFor(() => expect(usePencilWorkspace.getState().editor).not.toBeNull()); }); expect(usePencilWorkspace.getState().readOnly).toBe(true);
      for (const label of ['Undo', 'Add page']) expect(button(label).disabled).toBe(true);
      await click('Main menu'); for (const label of ['Import video…', 'Design actions…', 'Scripts…', 'Resources…']) expect(button(label).disabled).toBe(true); await click('Main menu');
      await act(async () => container.querySelector<HTMLButtonElement>('.xd-pencil-layer-row[title^="RECTANGLE"]')!.click()); const editor = usePencilWorkspace.getState().editor!; expect(editor.state.selectedIds.has(rectangleId)).toBe(true); expect(container.querySelector('[aria-label="Width"]')!.matches(':disabled')).toBe(true); expect(button('Export selection').disabled).toBe(false);
      await act(async () => container.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))); expect(editor.graph.getNode(rectangleId)).toBeDefined();
      await click('Comments'); expect(button('Pin on canvas').disabled).toBe(true); expect(container.querySelector('[aria-label="Search comments"]')!.matches(':disabled')).toBe(false);
    } finally { replica.dispose(); }
  });
  it('preserves shared artwork and reports corrupt connection preferences before mounting an editable canvas', async () => {
    act(() => root.unmount()); const original = useXDesign.getState().pencilDocument!, replica = SharedDesign.fromGraph(deserializeGraph(original.graph));
    try {
      const saved = { ...original, shared: encodeSharedCheckpoint(ulid(), replica.update()) }; useXDesign.setState({ pencilDocument: saved }); vi.mocked(getAppState).mockResolvedValue({ version: 2, rooms: [] }); root = createRoot(container); await act(async () => root.render(<PencilStudio/>));
      await act(async () => { await vi.waitFor(() => expect(container.textContent).toContain('newer application')); }); expect(useXDesign.getState().pencilDocument).toBe(saved); expect(usePencilWorkspace.getState().editor).toBeNull(); expect(container.querySelector('canvas')).toBeNull();
    } finally { replica.dispose(); }
  });
  it('reopens an unpublished shared copy read-only without attempting desktop operations', async () => {
    act(() => root.unmount()); const original = useXDesign.getState().pencilDocument!, replica = SharedDesign.fromGraph(deserializeGraph(original.graph)), documentId = ulid(), projectId = useXDProjects.getState().activeId!;
    try {
      const creation: PendingRoomCreation = { kind: 'create', projectId, documentId, serverUrl: 'https://rooms.example.test/', requestId: ulid(), name: 'Shared copy', ownerName: 'Owner', checkpointSha256: 'a'.repeat(64) };
      useXDesign.setState({ pencilDocument: { ...original, shared: encodeSharedCheckpoint(documentId, replica.update()) } }); vi.mocked(getAppState).mockImplementation(async key => key.startsWith('xdesign.roomGrants.') ? roomGrantState(projectId, [creation]) as never : null);
      root = createRoot(container); await act(async () => root.render(<PencilStudio/>)); await act(async () => { await vi.waitFor(() => expect(usePencilWorkspace.getState().editor).not.toBeNull()); });
      expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(button('Undo').disabled).toBe(true); await click('Publish room'); await vi.waitFor(async () => { await act(async () => {}); expect(container.textContent).toContain('Publish or recover room'); });
      expect(container.querySelector<HTMLInputElement>('[aria-label="Room administrator credential"]')!.matches(':disabled')).toBe(true);
    } finally { replica.dispose(); }
  });
  it('preserves newer pending handoffs before mounting the shared canvas', async () => {
    act(() => root.unmount()); const original = useXDesign.getState().pencilDocument!, replica = SharedDesign.fromGraph(deserializeGraph(original.graph));
    try {
      const saved = { ...original, shared: encodeSharedCheckpoint(ulid(), replica.update()) }; useXDesign.setState({ pencilDocument: saved }); vi.mocked(getAppState).mockImplementation(async key => key.startsWith('xdesign.roomGrants.') ? { version: 2, grants: [] } as never : null);
      root = createRoot(container); await act(async () => root.render(<PencilStudio/>)); await act(async () => { await vi.waitFor(() => expect(container.textContent).toContain('Pending room requests need a newer')); });
      expect(useXDesign.getState().pencilDocument).toBe(saved); expect(usePencilWorkspace.getState().editor).toBeNull(); expect(container.querySelector('canvas')).toBeNull();
    } finally { replica.dispose(); }
  });
});
