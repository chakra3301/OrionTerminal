import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { SceneGraph } from "@open-pencil/scene-graph";
import { FigmaAPI } from "@open-pencil/core/figma-api";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";
import { useHtmlArtifact } from "../htmlArtifactStore";
import { startPencilSession, executeDesignToolAsync, designTools, editPencilImage, pencilPhotoDocumentId, currentPencilSnapshot, usePencilWorkspace } from "./runtime";
import { serializeGraph, deserializeGraph } from "./document";
import { assetCredits, placeStockPhoto, runRemoteAssetTool } from "./assetRuntime";
import { clearAssetCache } from "./assetService";
import { xdesignActivityReason } from "../runtimeActivity";
const ipc=vi.hoisted(()=>vi.fn());
const photoBridge=vi.hoisted(()=>vi.fn());
const nativeKit=vi.hoisted(()=>({initialize:vi.fn(),decode:vi.fn(),release:vi.fn()}));
const kitFixture={MakeImageFromEncoded:nativeKit.decode};
vi.mock("../photo/runtime",()=>({openPencilPhoto:photoBridge}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>true,invoke:ipc,convertFileSrc:(path:string)=>path}));
vi.mock("./runtime",async original=>({...await original<Record<string,unknown>>(),initializeCanvasKit:nativeKit.initialize}));
const photo={sourceId:"photo1",provider:"unsplash" as const,url:"https://images.unsplash.com/photo1",thumbnail:"https://images.unsplash.com/photo1?w=200",page:"https://unsplash.com/photos/photo1",artist:"https://unsplash.com/@artist",photographer:"Artist",width:400,height:200};
let session:ReturnType<typeof startPencilSession>;
beforeEach(()=>{nativeKit.initialize.mockReset().mockResolvedValue(kitFixture);nativeKit.decode.mockReset().mockImplementation(()=>({width:()=>12,height:()=>8,delete:nativeKit.release}));nativeKit.release.mockReset();useXDesign.getState().hydrate(null);const id=ulid();useXDProjects.setState({activeId:id,transitioning:false,ready:true,registry:[{id,name:"Assets",createdAt:0,updatedAt:0}]});useHtmlArtifact.getState().setProject(id);const graph=new SceneGraph(),doc={formatVersion:1 as const,graph:serializeGraph(graph),pageId:graph.getPages()[0]!.id,panX:0,panY:0,zoom:1,photoLinks:{}};useXDesign.setState({pencilDocument:doc});session=startPencilSession(document.createElement("div"),doc,()=>{});clearAssetCache();localStorage.setItem("orion.xdesign.stock-provider","unsplash");ipc.mockReset().mockImplementation(async(command,args)=>{if(command==="xdesign_stock_image")return{base64:btoa("PNG fixture"),width:12,height:8};if(command!=="xdesign_asset_request")return[];switch(args.request.kind){case"iconCollection":return{prefix:"test",width:24,height:24,icons:{empty:{body:"<g/>"},heart:{body:'<path d="M0 0L24 0L24 24Z" fill="currentColor"/>'},home:{body:'<path d="M0 0L24 24" fill="none" stroke="currentColor" stroke-width="2"/>'}}};case"iconInfo":return{info:{license:{title:"MIT",url:"https://example.com/license"}}};case"iconSearch":return{icons:["test:heart"],total:1,collections:{}};case"photos":return{photos:[photo]};default:return{};}});});
afterEach(()=>{usePencilWorkspace.setState({readOnly:false});vi.restoreAllMocks();session?.dispose();});
describe("remote resource publication",()=>{
  it("dispatches all three icon tools through native adapters and records one vector/selection undo",async()=>{
    const editor=session.editor,original=serializeGraph(editor.graph);expect((await executeDesignToolAsync("search_icons",{queries:["heart"]}) as any).heart.icons).toEqual(["test:heart"]);expect(editor.undo.canUndo).toBe(false);
    expect(await executeDesignToolAsync("fetch_icons",{names:["test:heart","test:home"]})).toMatchObject({count:2});const result=await executeDesignToolAsync("insert_icon",{names:["test:heart","test:home"],size:48,color:"#ff0080"}) as {inserted:{id:string}[]};expect(result.inserted).toHaveLength(2);expect(editor.state.selectedIds.size).toBe(2);const first=editor.graph.getNode(result.inserted[0]!.id)!;expect(first.width).toBe(48);expect(editor.graph.getChildren(first.id)[0]!.fills[0]!.color.r).toBe(1);expect(assetCredits(first)[0]!.license).toBe("MIT");const after=serializeGraph(editor.graph);expect(assetCredits(deserializeGraph(after).getNode(first.id)!)[0]!.sourceId).toBe("test:heart");editor.undoAction();expect(serializeGraph(editor.graph)).toBe(original);expect(editor.state.selectedIds.size).toBe(0);editor.redoAction();expect(serializeGraph(editor.graph)).toBe(after);expect(editor.state.selectedIds.size).toBe(2);
  });
  it("applies stock results to leaf geometry, rejects unsuitable targets and preserves attribution through history",async()=>{
    const editor=session.editor,leaf=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{width:160,height:90}),text=editor.graph.createNode("TEXT",editor.state.currentPageId,{}),before=serializeGraph(editor.graph);
    const result=await executeDesignToolAsync("stock_photo",{requests:JSON.stringify([{id:leaf.id,query:"ocean"},{id:text.id,query:"ocean"}])});expect(result).toMatchObject({applied:1,failed:1,provider:"unsplash"});expect(leaf.fills[0]!.type).toBe("IMAGE");expect(assetCredits(leaf)[0]!.author).toBe("Artist");expect(ipc.mock.calls.filter(([,args])=>args.request?.kind==="photoDownload")).toHaveLength(1);editor.undoAction();expect(serializeGraph(editor.graph)).toBe(before);expect(editor.graph.getNode(leaf.id)).toBe(leaf);editor.redoAction();expect(assetCredits(leaf)[0]!.sourceId).toBe("photo1");
  });
  it("inserts a new photo with view history and validates target/batch input before publication",async()=>{
    const editor=session.editor,before=serializeGraph(editor.graph);const id=await placeStockPhoto(photo);expect(editor.state.selectedIds.has(id)).toBe(true);expect(editor.graph.getNode(id)!.height).toBe(8);editor.undoAction();expect(serializeGraph(editor.graph)).toBe(before);expect(editor.state.selectedIds.size).toBe(0);await expect(runRemoteAssetTool("stock_photo",{requests:"[]"})).rejects.toThrow("1–16");await expect(runRemoteAssetTool("insert_icon",{names:["test:heart"],parent_id:editor.graph.rootId})).rejects.toThrow("Choose");
  });
  it("discards stale/cancelled downloads and rolls back publication failures without losing prior redo",async()=>{
    const editor=session.editor;await runRemoteAssetTool("insert_icon",{name:"test:heart"});editor.undoAction();const original=serializeGraph(editor.graph);const pending=vi.spyOn(useXDesign,"setState").mockImplementationOnce(()=>{throw Error("store failed");});await expect(placeStockPhoto(photo)).rejects.toThrow("store failed");pending.mockRestore();expect(serializeGraph(editor.graph)).toBe(original);expect(editor.undo.canRedo).toBe(true);
    let finish!:(value:unknown)=>void;ipc.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const inserting=placeStockPhoto(photo);editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{name:"Newer"});finish({base64:btoa("PNG fixture"),width:12,height:8});await expect(inserting).rejects.toThrow("changed");expect(editor.graph.getChildren(editor.state.currentPageId)).toHaveLength(1);expect(usePencilWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
    const abort=new AbortController();ipc.mockImplementationOnce(()=>new Promise(()=>{}));const stopped=placeStockPhoto(photo,undefined,abort.signal);abort.abort();await expect(stopped).rejects.toThrow("cancelled");expect(usePencilWorkspace.getState().busy).toBe(false);
  });
  it("cancels cached icon publication without another request, preserving prior redo and allowing retry",async()=>{
    const editor=session.editor;
    await runRemoteAssetTool("insert_icon",{name:"test:heart"});const published=serializeGraph(editor.graph);editor.undoAction();
    const before=serializeGraph(editor.graph),selection=[...editor.state.selectedIds],saved=useXDesign.getState().pencilDocument,requests=ipc.mock.calls.length,write=vi.spyOn(useXDesign,"setState"),abort=new AbortController();
    const work=runRemoteAssetTool("insert_icon",{name:"test:heart"},abort.signal);abort.abort();
    await expect(work).rejects.toThrow("cancelled");expect(ipc.mock.calls).toHaveLength(requests);expect(serializeGraph(editor.graph)).toBe(before);expect([...editor.state.selectedIds]).toEqual(selection);expect(useXDesign.getState().pencilDocument).toBe(saved);expect(write).not.toHaveBeenCalled();expect(editor.undo.canUndo).toBe(false);expect(editor.undo.canRedo).toBe(true);expect(usePencilWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
    write.mockRestore();editor.redoAction();expect(serializeGraph(editor.graph)).toBe(published);editor.undoAction();
    await runRemoteAssetTool("insert_icon",{name:"test:heart"});expect(editor.undo.canUndo).toBe(true);editor.undoAction();expect(serializeGraph(editor.graph)).toBe(before);
  });
  it.each(["cancel","viewer"] as const)("discards a Pexels image after deferred initialization on %s and permits retry",async reason=>{
    const editor=session.editor,before=serializeGraph(editor.graph),selection=[...editor.state.selectedIds],saved=useXDesign.getState().pencilDocument,write=vi.spyOn(useXDesign,"setState"),abort=new AbortController();
    const pexels={...photo,provider:"pexels" as const,url:"https://images.pexels.com/photos/1/image.jpg"};
    let release!:(kit:typeof kitFixture)=>void;nativeKit.initialize.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const work=placeStockPhoto(pexels,undefined,abort.signal);await vi.waitFor(()=>expect(release).toBeDefined());
    if(reason==="cancel")abort.abort();else usePencilWorkspace.setState({readOnly:true});release(kitFixture);
    await expect(work).rejects.toThrow(reason==="cancel"?"cancelled":"viewer access");expect(serializeGraph(editor.graph)).toBe(before);expect([...editor.state.selectedIds]).toEqual(selection);expect(useXDesign.getState().pencilDocument).toBe(saved);expect(write).not.toHaveBeenCalled();expect(editor.undo.canUndo).toBe(false);expect(editor.undo.canRedo).toBe(false);expect(usePencilWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
    expect(ipc.mock.calls.filter(([,args])=>args.request?.kind==="photoDownload")).toHaveLength(0);
    if(reason==="cancel")expect(nativeKit.decode).not.toHaveBeenCalled();else expect(nativeKit.release).toHaveBeenCalledOnce();
    write.mockRestore();usePencilWorkspace.setState({readOnly:false});await placeStockPhoto(pexels);expect(editor.undo.canUndo).toBe(true);editor.undoAction();expect(serializeGraph(editor.graph)).toBe(before);
  });
  it("cancels a stock batch after preparing one image without partial artwork or download notifications",async()=>{
    const editor=session.editor,first=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{name:"First"}),second=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{name:"Second"}),before=serializeGraph(editor.graph),saved=useXDesign.getState().pencilDocument,write=vi.spyOn(useXDesign,"setState"),abort=new AbortController();
    let release!:(kit:typeof kitFixture)=>void;nativeKit.initialize.mockResolvedValueOnce(kitFixture).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const args={requests:JSON.stringify([{id:first.id,query:"ocean"},{id:second.id,query:"forest"}])},work=runRemoteAssetTool("stock_photo",args,abort.signal);
    await vi.waitFor(()=>expect(release).toBeDefined());expect(nativeKit.release).toHaveBeenCalledOnce();abort.abort();release(kitFixture);
    await expect(work).rejects.toThrow("cancelled");expect(serializeGraph(editor.graph)).toBe(before);expect(editor.state.selectedIds.size).toBe(0);expect(useXDesign.getState().pencilDocument).toBe(saved);expect(write).not.toHaveBeenCalled();expect(editor.undo.canUndo).toBe(false);expect(editor.undo.canRedo).toBe(false);expect(ipc.mock.calls.filter(([,args])=>args.request?.kind==="photoDownload")).toHaveLength(0);expect(usePencilWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
    write.mockRestore();await expect(runRemoteAssetTool("stock_photo",args)).resolves.toMatchObject({applied:2,failed:0});expect(ipc.mock.calls.filter(([,args])=>args.request?.kind==="photoDownload")).toHaveLength(2);editor.undoAction();expect(serializeGraph(editor.graph)).toBe(before);
  });
  it("cancels between stock batch provider notifications before any graph publication",async()=>{
    const editor=session.editor,first=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{}),second=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{}),before=serializeGraph(editor.graph),saved=useXDesign.getState().pencilDocument,abort=new AbortController(),original=ipc.getMockImplementation()!;
    ipc.mockImplementation((command,args)=>{if(args.request?.kind==="photoDownload"){abort.abort();return Promise.resolve({});}return original(command,args);});
    await expect(runRemoteAssetTool("stock_photo",{requests:JSON.stringify([{id:first.id,query:"ocean"},{id:second.id,query:"forest"}])},abort.signal)).rejects.toThrow("cancelled");
    expect(ipc.mock.calls.filter(([,args])=>args.request?.kind==="photoDownload")).toHaveLength(1);expect(serializeGraph(editor.graph)).toBe(before);expect(useXDesign.getState().pencilDocument).toBe(saved);expect(editor.undo.canUndo).toBe(false);expect(usePencilWorkspace.getState().busy).toBe(false);expect(xdesignActivityReason()).toBeNull();
  });
  it("uses adapted direct tool metadata and rejects forged credit links",async()=>{
    expect(await designTools.find(tool=>tool.name==="search_icons")!.execute(new FigmaAPI(session.editor.graph),{queries:["heart"]})).toMatchObject({heart:{total:1}});const node=session.editor.graph.getPages()[0]!;node.pluginData.push({pluginId:"orion.xdesign.asset",key:"source",value:JSON.stringify({provider:"Iconify",sourceId:"x",source:"javascript:alert(1)"})});expect(assetCredits(node)).toEqual([]);
  });
  it("rejects oversized source metadata and restores all provisional image/view/history changes",async()=>{
    const editor=session.editor,before=serializeGraph(editor.graph);await expect(placeStockPhoto({...photo,page:"https://unsplash.com/"+"a".repeat(6000),artist:"https://unsplash.com/"+"a".repeat(6000)})).rejects.toThrow("metadata");expect(serializeGraph(editor.graph)).toBe(before);expect(editor.undo.canUndo).toBe(false);expect(editor.state.selectedIds.size).toBe(0);expect(usePencilWorkspace.getState().busy).toBe(false);
  });

  it("replaces only the chosen linked image and restores its PSD link with undo/redo",async()=>{
    const editor=session.editor,original={id:"original",version:"v1",name:"Layered",width:12,height:8,previewWidth:12,previewHeight:8,bundlePath:"/fixture.psd",previewPath:"/fixture.png",originalPath:null};useXDesign.setState({photoDocuments:{original}});
    const markers=[{pluginId:"orion.xdesign",key:"photoDocumentId",value:"original"}];const first=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{pluginData:structuredClone(markers)}),other=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{pluginData:structuredClone(markers)});
    expect(currentPencilSnapshot()!.photoLinks[first.id]).toBe("original");const before=serializeGraph(editor.graph);await placeStockPhoto(photo,first.id);expect(pencilPhotoDocumentId(first.id)).toBeNull();expect(pencilPhotoDocumentId(other.id)).toBe("original");expect(currentPencilSnapshot()!.photoLinks[first.id]).toBeUndefined();expect(useXDesign.getState().photoDocuments.original).toBe(original);
    editor.undoAction();expect(serializeGraph(editor.graph)).toBe(before);expect(pencilPhotoDocumentId(first.id)).toBe("original");expect(currentPencilSnapshot()!.photoLinks[first.id]).toBe("original");editor.redoAction();expect(pencilPhotoDocumentId(first.id)).toBeNull();expect(pencilPhotoDocumentId(other.id)).toBe("original");expect(useXDesign.getState().photoDocuments.original).toBe(original);
  });

  it("opens a stock WebP using its actual format rather than the JPEG path",async()=>{
    const editor=session.editor,bytes=new TextEncoder().encode("RIFF0000WEBPfixture"),image=new FigmaAPI(editor.graph).createImage(bytes),node=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{name:"Stock",fills:[{type:"IMAGE",color:{r:1,g:1,b:1,a:1},imageHash:image.hash,imageScaleMode:"FILL",visible:true,opacity:1}]});
    photoBridge.mockReset().mockResolvedValue(undefined);await editPencilImage(node.id);expect(photoBridge).toHaveBeenCalledWith(node.id,null,btoa("RIFF0000WEBPfixture"),"image.webp");
  });

  it("preserves duplicate icon insertion and reports empty or missing icons without dropping valid entries",async()=>{
    expect(await runRemoteAssetTool("fetch_icons",{names:["test:heart","test:heart"]})).toEqual({fetched:["test:heart"],count:1});
    const result=await runRemoteAssetTool("insert_icon",{names:["test:heart","test:empty","test:missing","test:heart"]}) as {inserted:{id:string}[];not_found:string[]};expect(result.inserted).toHaveLength(2);expect(new Set(result.inserted.map(node=>node.id)).size).toBe(2);expect(result.not_found).toEqual(["test:empty","test:missing"]);session.editor.undoAction();expect(session.editor.graph.getChildren(session.editor.state.currentPageId)).toHaveLength(0);
  });

});
