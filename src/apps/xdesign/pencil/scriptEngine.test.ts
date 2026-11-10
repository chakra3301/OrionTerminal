import { describe, expect, it } from "vitest";
import { SceneGraph } from "@open-pencil/scene-graph";
import { serializeGraph } from "./document";
import { executeScriptDraft, wrapScript } from "./scriptEngine";
import { decodeScriptGraph, decodeScriptOutput, scriptSummary } from "./scriptContract";
const fixture=()=>{const graph=new SceneGraph();return{graph,input:{graph:serializeGraph(graph),pageId:graph.getPages()[0]!.id,selection:[],code:"42"}};};
describe("published API script drafts",()=>{
  it("returns expressions, explicit returns, async bodies and JSON proxy results",async()=>{
    const {input}=fixture();for(const [code,result] of [["1 + 2",3],["return {ok:true}",{ok:true}],["const value = await Promise.resolve(7); value",7],["const n = figma.createRectangle(); n.name = 'Draft'; n",null]] as const){const output=await executeScriptDraft({...input,code});expect(JSON.parse(output.result)).toEqual(result===null?expect.objectContaining({name:"Draft"}):result);}
    expect(wrapScript("const value=2;")).toContain("async () =>");expect((await executeScriptDraft({...input,code:"const value=2;"})).result).toContain("no return value");
  });
  it("executes loops, text, components, images, variables and plugin data on a copied graph",async()=>{
    const {graph,input}=fixture();const before=serializeGraph(graph);
    const code=`const c=figma.createComponent();c.name="Button";c.resize(120,40);const t=figma.createText();t.characters="こんにちは";c.appendChild(t);const instance=c.createInstance();instance.name="Instance";instance.setPluginData("script-note","retained");for(let i=0;i<3;i++){const n=figma.createRectangle();n.x=i*20;n.resize(10,10);}const collection=figma.createVariableCollection("Brand");figma.createVariable("Gap","FLOAT",collection.id,24);figma.createImage(new Uint8Array([137,80,78,71]));figma.currentPage.selection=[instance];({count:figma.currentPage.children.length})`;
    const output=await executeScriptDraft({...input,code});const decoded=decodeScriptOutput(output,graph);expect(decoded.graph.nodes.size).toBeGreaterThan(graph.nodes.size+5);expect(decoded.graph.variables.size).toBe(1);expect(decoded.graph.images.size).toBe(1);expect([...decoded.graph.nodes.values()].some(n=>n.text==="こんにちは")).toBe(true);expect(decoded.graph.getNode(output.selection[0]!)!.pluginData.some(entry=>entry.key==="script-note")).toBe(true);expect(serializeGraph(graph)).toBe(before);
    expect(scriptSummary(graph,decoded.graph,input,output)).toMatchObject({added:expect.any(Number),images:1,variables:1,selectionChanged:true});
  });
  it("leaves source snapshots untouched after syntax, runtime or non-JSON failures",async()=>{
    const {graph,input}=fixture();const before=serializeGraph(graph);
    for(const code of ["const n=figma.createRectangle();throw new Error('stop')","const = ;","return 3n"]){await expect(executeScriptDraft({...input,code})).rejects.toThrow();expect(serializeGraph(graph)).toBe(before);}
  });
  it("bounds code, logs and result while preserving Unicode",async()=>{
    const {input}=fixture();const output=await executeScriptDraft({...input,code:"for(let i=0;i<200;i++)console.log('文字'.repeat(700)); return '✓';"});expect(output.logs).toHaveLength(100);expect(output.logs.every(line=>line.length<=1024)).toBe(true);expect(JSON.parse(output.result)).toBe("✓");
    await expect(executeScriptDraft({...input,code:"'a'.repeat(70000)"})).rejects.toThrow("64 KiB");await expect(executeScriptDraft({...input,code:" ".repeat(70000)})).rejects.toThrow("64 KiB");
  });
  it("validates results and refuses orphaned, oversized and prototype-bearing graph data",async()=>{
    const {graph,input}=fixture();const good=await executeScriptDraft(input);expect(()=>decodeScriptOutput({...good,result:"invalid"},graph)).toThrow();expect(()=>decodeScriptOutput({...good,logs:["x".repeat(1025)]},graph)).toThrow();
    graph.getPages()[0]!.childIds.push("missing");expect(()=>decodeScriptGraph(serializeGraph(graph))).toThrow();
    const fresh=fixture();Object.defineProperty(fresh.graph.getPages()[0]!,"__proto__",{value:{bad:true},enumerable:true});expect(()=>decodeScriptGraph(serializeGraph(fresh.graph))).toThrow();
  });
  it("preserves format schema/root and requires current-page selections",async()=>{
    const {graph,input}=fixture();const output=await executeScriptDraft(input);const other=new SceneGraph();expect(()=>decodeScriptOutput({...output,graph:serializeGraph(other)},graph)).toThrow("root");
    expect(()=>decodeScriptOutput({...output,selection:[graph.rootId]},graph)).toThrow("current page");expect(()=>decodeScriptOutput({...output,selection:[input.pageId]},graph)).toThrow("current page");
  });
  it("reports changes to map-backed overrides, collections, modes, libraries and document color space",()=>{
    const {graph,input}=fixture();const layer=graph.createNode("RECTANGLE",input.pageId,{});const after=decodeScriptGraph(serializeGraph(graph));
    after.getNode(layer.id)!.instanceOverrides.descendants.set(layer.id,new Map([["name","Changed"]]));
    after.activeMode.set("collection","mode");after.documentColorSpace="display-p3";
    expect(scriptSummary(graph,after,input,input)).toMatchObject({changed:1,modes:1,documentChanged:true});
  });

});
