import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FigmaAPI } from "@open-pencil/core/figma-api";
import { ulid } from "ulid";
import { SceneGraph } from "@open-pencil/scene-graph";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { useHtmlArtifact } from "../htmlArtifactStore";
import { usePencilWorkspace, startPencilSession, executeDesignToolAsync, designTools } from "./runtime";
import { previewPencilScript, applyPencilScript, scriptDraftCurrent } from "./scriptRuntime";
import { executeScriptDraft } from "./scriptEngine";
import { serializeGraph } from "./document";
import { xdesignActivityReason } from "../runtimeActivity";
import type { ScriptInput } from "./scriptContract";
const sandbox=vi.hoisted(()=>vi.fn());
vi.mock("./scriptSandbox",()=>({runIsolatedScript:sandbox}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>false,invoke:vi.fn(),convertFileSrc:(path:string)=>path}));
let session: ReturnType<typeof startPencilSession>;
beforeEach(()=>{useXDesign.getState().hydrate(null);const id=ulid();useXDProjects.setState({activeId:id,transitioning:false,ready:true,registry:[{id,name:"Scripts",createdAt:0,updatedAt:0}]});useHtmlArtifact.getState().setProject(id);const graph=new SceneGraph();const doc={formatVersion:1 as const,graph:serializeGraph(graph),pageId:graph.getPages()[0]!.id,panX:0,panY:0,zoom:1,photoLinks:{}};useXDesign.setState({pencilDocument:doc});session=startPencilSession(document.createElement("div"),doc,()=>{});sandbox.mockReset().mockImplementation((input:ScriptInput)=>executeScriptDraft(input));});
afterEach(()=>{vi.restoreAllMocks();session?.dispose();});
describe("script graph publication",()=>{
  it("previews without mutations and applies page/selection/graph together through undo and redo",async()=>{
    const editor=session.editor,before=serializeGraph(editor.graph),page=editor.state.currentPageId;
    const existing=editor.graph.createNode("RECTANGLE",page,{name:"Prior"});editor.select([existing.id]);const original=serializeGraph(editor.graph);
    const draft=await previewPencilScript("const p=figma.createPage();p.name='New';figma.currentPage=p;const r=figma.createRectangle();r.name='Created';figma.currentPage.selection=[r];r.id");expect(serializeGraph(editor.graph)).toBe(original);expect(scriptDraftCurrent(draft)).toBe(true);expect(usePencilWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
    const id=await applyPencilScript(draft) as string;const after=serializeGraph(editor.graph);expect(editor.state.selectedIds.has(id)).toBe(true);expect(editor.state.currentPageId).not.toBe(page);editor.undoAction();expect(serializeGraph(editor.graph)).toBe(original);expect(editor.graph.getNode(existing.id)).toBe(existing);expect(editor.state.currentPageId).toBe(page);expect([...editor.state.selectedIds]).toEqual([existing.id]);editor.redoAction();expect(serializeGraph(editor.graph)).toBe(after);expect(editor.state.selectedIds.has(id)).toBe(true);expect(before).not.toBe(after);
  });
  it("does not create undo entries for queries and routes eval through the isolated adapter",async()=>{
    const editor=session.editor;expect(editor.undo.canUndo).toBe(false);expect(designTools.find(tool=>tool.name==="eval")!.description).toContain("isolated worker");expect(await executeDesignToolAsync("eval",{code:"40+2"})).toBe(42);expect(sandbox).toHaveBeenCalledOnce();expect(editor.undo.canUndo).toBe(false);
    await executeDesignToolAsync("eval",{code:"const r=figma.createRectangle();r.name='From eval';r.id"});expect(editor.graph.getChildren(editor.state.currentPageId)[0]!.name).toBe("From eval");editor.undoAction();expect(editor.graph.getChildren(editor.state.currentPageId)).toHaveLength(0);
  });
  it("rejects stale project/editor/selection/graph drafts before publication",async()=>{
    const draft=await previewPencilScript("figma.createRectangle().id");session.editor.graph.createNode("RECTANGLE",session.editor.state.currentPageId,{name:"Newer"});const newer=serializeGraph(session.editor.graph);await expect(applyPencilScript(draft)).rejects.toThrow("changed");expect(serializeGraph(session.editor.graph)).toBe(newer);
    const fresh=await previewPencilScript("figma.createRectangle().id");useXDProjects.setState({activeId:ulid()});await expect(applyPencilScript(fresh)).rejects.toThrow("changed");expect(usePencilWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
  });
  it("keeps the live document/history intact after worker and malformed result failures",async()=>{
    const editor=session.editor,before=serializeGraph(editor.graph);sandbox.mockRejectedValueOnce(new Error("worker stopped"));await expect(previewPencilScript("42")).rejects.toThrow("worker stopped");expect(serializeGraph(editor.graph)).toBe(before);expect(editor.undo.canUndo).toBe(false);
    sandbox.mockResolvedValueOnce({graph:"invalid",pageId:editor.state.currentPageId,selection:[],result:"42",logs:[]});await expect(previewPencilScript("42")).rejects.toThrow();expect(serializeGraph(editor.graph)).toBe(before);expect(usePencilWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
  });
  it("pins the running source and releases activity after cancellation or an external edit",async()=>{
    let finish!:(input:unknown)=>void;let captured!:ScriptInput;sandbox.mockImplementationOnce((input:ScriptInput)=>{captured=input;return new Promise(resolve=>finish=resolve);});const pending=previewPencilScript("42");expect(xdesignActivityReason()).toContain("script");expect(usePencilWorkspace.getState().busy).toBe(true);session.editor.graph.createNode("RECTANGLE",session.editor.state.currentPageId,{});finish(await executeScriptDraft(captured));await expect(pending).rejects.toThrow("changed");expect(xdesignActivityReason()).toBeNull();
    const abort=new AbortController();sandbox.mockImplementationOnce(async(input:ScriptInput)=>{abort.abort();return executeScriptDraft(input);});await expect(previewPencilScript("42",abort.signal)).rejects.toThrow("changed");expect(usePencilWorkspace.getState().busy).toBe(false);
  });
  it("routes direct tool execution through the isolated adapter and keeps other privileged tools excluded",async()=>{
    const tool=designTools.find(tool=>tool.name==="eval")!;
    const privileged=designTools.filter(tool=>tool.capabilities.some(cap=>["filesystem:read","filesystem:write","network:access","code:execute"].includes(cap)));
    expect(privileged.map(tool=>tool.name)).toEqual(["fetch_icons","insert_icon","search_icons","stock_photo","eval"]);
    expect(await tool.execute(new FigmaAPI(session.editor.graph),{code:"6*7"})).toBe(42);expect(sandbox).toHaveBeenCalledOnce();expect(session.editor.undo.canUndo).toBe(false);
  });
  it("restores graph, page, selection and existing redo when layout or publication fails",async()=>{
    const editor=session.editor;await executeDesignToolAsync("eval",{code:"figma.createRectangle().id"});editor.undoAction();expect(editor.undo.canRedo).toBe(true);
    const before=serializeGraph(editor.graph),page=editor.state.currentPageId,document=useXDesign.getState().pencilDocument;
    const draft=await previewPencilScript("const p=figma.createPage();figma.currentPage=p;const r=figma.createRectangle();figma.currentPage.selection=[r];r.id");
    const layout=vi.spyOn(editor,"runLayoutForNode").mockImplementationOnce(()=>{throw new Error("layout failed");});
    await expect(applyPencilScript(draft)).rejects.toThrow("layout failed");layout.mockRestore();expect(serializeGraph(editor.graph)).toBe(before);expect(editor.state.currentPageId).toBe(page);expect([...editor.state.selectedIds]).toEqual([]);expect(editor.undo.canUndo).toBe(false);expect(editor.undo.canRedo).toBe(true);
    vi.spyOn(useXDesign,"setState").mockImplementationOnce(()=>{throw new Error("publication failed");});
    await expect(applyPencilScript(draft)).rejects.toThrow("publication failed");expect(serializeGraph(editor.graph)).toBe(before);expect(editor.state.currentPageId).toBe(page);expect([...editor.state.selectedIds]).toEqual([]);expect(useXDesign.getState().pencilDocument).toBe(document);expect(editor.undo.canUndo).toBe(false);expect(editor.undo.canRedo).toBe(true);expect(usePencilWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
  });

});
