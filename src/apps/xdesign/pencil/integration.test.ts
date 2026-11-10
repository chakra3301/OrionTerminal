import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { SceneGraph } from "@open-pencil/scene-graph";
import { useXDesign } from "../store";
import { useXDProjects, snapshotActiveDoc } from "../projectsStore";
import { useHtmlArtifact } from "../htmlArtifactStore";
import { serializeGraph, deserializeGraph, validatePencilDocument } from "./document";
import { startPencilSession, commitPencilPhoto, pencilPhotoDocumentId, currentPencilSnapshot, executeDesignTool, executeDesignToolAsync, usePencilWorkspace } from "./runtime";
import { ingestPencilPlans } from "./designPlans";
import type { PhotoDocument } from "../photo/types";
import { runPencilCommandsAsync } from "./legacyCommands";
import { setVariableAlias } from "./variableAliases";
import { resolveVariable } from "@open-pencil/scene-graph/variables";
import { editPencilGraph } from "./toolExecution";

vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>false,invoke:vi.fn(),convertFileSrc:(path:string)=>path}));
let session:ReturnType<typeof startPencilSession>;
beforeEach(()=>{
  useXDesign.getState().hydrate(null);const id=ulid();useXDProjects.setState({activeId:id,transitioning:false,ready:true,registry:[{id,name:"Integration",createdAt:0,updatedAt:0}]});
  useHtmlArtifact.getState().setProject(id);
  const graph=new SceneGraph();const doc={formatVersion:1 as const,graph:serializeGraph(graph),pageId:graph.getPages()[0]!.id,panX:0,panY:0,zoom:1,photoLinks:{}};useXDesign.setState({pencilDocument:doc});session=startPencilSession(document.createElement("div"),doc,()=>{});
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(new Uint8Array([137,80,78,71,1,2,3]))));
});
afterEach(()=>{session.dispose();vi.unstubAllGlobals();});
const photo=(id=ulid(),version=ulid()):PhotoDocument=>({id,version,name:"Linked photo",width:4000,height:3000,previewWidth:2048,previewHeight:1536,bundlePath:`/assets/${version}.pcraft`,previewPath:`/assets/${version}.png`,originalPath:null});

describe("combined design workspace",()=>{
  it("creates real token-bound AI layouts and undoes the entire design",()=>{
    ingestPencilPlans([{tokens:{colors:[{name:"Accent",value:"#e03090"}]},screen:{name:"Generated screen",w:640,h:480,layout:{mode:"vertical",padding:24,gap:12},children:[{type:"rect",name:"Token card",w:200,h:80,fill:"color/Accent",sizingH:"fill"}]}}]);
    const graph=session.editor.graph;const root=[...graph.nodes.values()].find(n=>n.name==="Generated screen")!;const card=[...graph.nodes.values()].find(n=>n.name==="Token card")!;
    expect(root.layoutMode).toBe("VERTICAL");expect(card.boundVariables["fills/0/color"]).toBeTruthy();expect(card.layoutAlignSelf).toBe("STRETCH");expect(useXDesign.getState().shapes).toHaveLength(0);
    session.editor.undoAction();expect(graph.nodes.size).toBe(2);expect(graph.variables.size).toBe(0);session.editor.redoAction();expect(graph.variables.size).toBe(1);expect(graph.getNode(card.id)).toBeTruthy();
  });
  it("places a layered asset as one undo step and restores it on redo",async()=>{
    const doc=photo();const id=await commitPencilPhoto(doc);expect(pencilPhotoDocumentId(id)).toBe(doc.id);
    session.editor.undoAction();expect(session.editor.graph.getNode(id)).toBeUndefined();session.editor.redoAction();expect(pencilPhotoDocumentId(id)).toBe(doc.id);
  });
  it("updates linked duplicates together and preserves independent copies through undo",async()=>{
    const first=photo();const id=await commitPencilPhoto(first);session.editor.select([id]);session.editor.duplicateSelected();const copy=session.editor.getSelectedNodes()[0]!;
    expect(pencilPhotoDocumentId(copy.id)).toBe(first.id);const next=photo(first.id);await commitPencilPhoto(next,id);expect(currentPencilSnapshot()?.photoLinks[copy.id]).toBe(first.id);expect(useXDesign.getState().photoDocuments[first.id]?.version).toBe(next.version);
    const independent=photo();await commitPencilPhoto(independent,id);expect(pencilPhotoDocumentId(id)).toBe(independent.id);expect(pencilPhotoDocumentId(copy.id)).toBe(first.id);
    session.editor.undoAction();expect(pencilPhotoDocumentId(id)).toBe(first.id);session.editor.undoAction();expect(useXDesign.getState().photoDocuments[first.id]?.version).toBe(first.version);
    const saved=snapshotActiveDoc();validatePencilDocument(saved.pencilDocument!);const reopened=deserializeGraph(saved.pencilDocument!.graph);expect(reopened.getNode(copy.id)?.pluginData).toEqual(session.editor.graph.getNode(copy.id)?.pluginData);expect(saved.photoDocuments?.[first.id]?.version).toBe(first.version);
  });
  it("routes variable and appearance tools through real graph undo",()=>{
    const collection=executeDesignTool("create_collection",{name:"Brand"}) as {id:string};const variable=executeDesignTool("create_variable",{name:"Space",type:"FLOAT",collection_id:collection.id,value:"8"}) as {id:string};const mode=session.editor.getCollection(collection.id)!.defaultModeId;
    executeDesignTool("set_variable",{id:variable.id,mode,value:"16"});expect(session.editor.getVariable(variable.id)?.valuesByMode[mode]).toBe(16);session.editor.undoAction();expect(session.editor.getVariable(variable.id)?.valuesByMode[mode]).toBe(8);
  });
  it("uses restored node metadata when a graph edit changes a photo link before autosave",async()=>{
    const first=photo(),independent=photo();const id=await commitPencilPhoto(first);
    session.editor.select([id]);session.editor.duplicateSelected();const copy=session.editor.getSelectedNodes()[0]!;
    currentPencilSnapshot(); // Populate the index before a graph-level operation restores different metadata.
    useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[independent.id]:independent}}));
    editPencilGraph(session.editor,"Change photo link",()=>session.editor.graph.updateNode(copy.id,{pluginData:[{pluginId:"orion.xdesign",key:"photoDocumentId",value:independent.id}]}));
    await commitPencilPhoto(photo(first.id),id);
    expect(pencilPhotoDocumentId(copy.id)).toBe(independent.id);
    session.editor.undoAction();expect(pencilPhotoDocumentId(copy.id)).toBe(independent.id);
    session.editor.undoAction();expect(pencilPhotoDocumentId(copy.id)).toBe(first.id);
  });
  it("imports SVG as editable vectors atomically and exposes XPath queries",async()=>{
    const result=await executeDesignToolAsync("import_svg",{svg:'<svg width="24" height="24"><path d="M2 2L22 2L22 22Z" fill="#ff0000"/></svg>',name:"Imported vector"}) as {id:string};
    expect(session.editor.graph.getNode(result.id)).toBeTruthy();expect([...session.editor.graph.nodes.values()].some(n=>n.type==="VECTOR")).toBe(true);expect(usePencilWorkspace.getState().busy).toBe(false);
    const query=await executeDesignToolAsync("query_nodes",{selector:"//VECTOR"}) as {count:number};expect(query.count).toBeGreaterThan(0);
    session.editor.undoAction();expect(session.editor.graph.nodes.size).toBe(2);session.editor.redoAction();expect(session.editor.graph.getNode(result.id)).toBeTruthy();
    const before=serializeGraph(session.editor.graph);await expect(executeDesignToolAsync("import_svg",{svg:"invalid"})).rejects.toThrow();expect(serializeGraph(session.editor.graph)).toBe(before);
  });
  it("renders declarative JSX with replacement undo and rolls back rejected code",async()=>{
    const original=executeDesignTool("create_shape",{type:"RECTANGLE",name:"Original",x:80,y:120,width:100,height:80}) as {id:string};
    const result=await executeDesignToolAsync("render",{replace_id:original.id,jsx:'<Frame name="JSX card" w={240} h={160} bg="#ff0088"><Text>Editable text</Text></Frame>'}) as {id:string};
    expect(session.editor.graph.getNode(result.id)?.name).toBe("JSX card");expect(session.editor.graph.getNode(original.id)).toBeUndefined();
    session.editor.undoAction();expect(session.editor.graph.getNode(original.id)?.name).toBe("Original");expect(session.editor.graph.getNode(result.id)).toBeUndefined();
    const before=serializeGraph(session.editor.graph);await expect(executeDesignToolAsync("render",{jsx:'<Frame w={globalThis.location}/>'})).rejects.toThrow();expect(serializeGraph(session.editor.graph)).toBe(before);expect(usePencilWorkspace.getState().busy).toBe(false);
  });
  it("groups mixed synchronous and asynchronous agent edits into one undo step",async()=>{
    const outcome=await runPencilCommandsAsync([{action:"addRect",x:0,y:0,w:100,h:80,fill:"#f00000"},{action:"designTool",name:"render",input:{jsx:'<Frame name="Agent card" w={200} h={120}><Text>Hello</Text></Frame>'}},{action:"addText",x:0,y:160,text:"Caption"}]);
    expect(outcome.applied).toBe(3);expect(session.editor.graph.nodes.size).toBe(6);session.editor.undoAction();expect(session.editor.graph.nodes.size).toBe(2);session.editor.redoAction();expect(session.editor.graph.nodes.size).toBe(6);
  });
  it("authors cross-collection variable aliases with undo, persisted references and cycle checks",()=>{
    const editor=session.editor, graph=editor.graph;
    const brand=graph.createCollection("Brand"), semantics=graph.createCollection("Semantics");
    const base=graph.createVariable("Space", "FLOAT", brand.id, 12), alias=graph.createVariable("Card gap", "FLOAT", semantics.id, 4);
    const color=graph.createVariable("Accent", "COLOR", brand.id, {r:1,g:0,b:0,a:1});
    setVariableAlias(editor,alias.id,semantics.defaultModeId,base.id);
    expect(resolveVariable(graph,alias.id,semantics.defaultModeId)).toBe(12);
    editor.undoAction();expect(alias.valuesByMode[semantics.defaultModeId]).toBe(4);
    editor.redoAction();expect(alias.valuesByMode[semantics.defaultModeId]).toEqual({aliasId:base.id});
    expect(()=>setVariableAlias(editor,base.id,brand.defaultModeId,alias.id)).toThrow("circular");
    expect(()=>setVariableAlias(editor,alias.id,semantics.defaultModeId,color.id)).toThrow("same type");
    expect(resolveVariable(deserializeGraph(serializeGraph(graph)),alias.id,semantics.defaultModeId)).toBe(12);
    setVariableAlias(editor,alias.id,semantics.defaultModeId,null);expect(alias.valuesByMode[semantics.defaultModeId]).toBe(12);
    editor.undoAction();expect(alias.valuesByMode[semantics.defaultModeId]).toEqual({aliasId:base.id});
  });
});
