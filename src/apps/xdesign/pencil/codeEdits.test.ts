// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import { selectionToJSX } from "@open-pencil/core/io";
import { fontManager } from "@open-pencil/core/text";
import { applyCodeEdits, prepareCodeEdits } from "./codeEdits";
import { fixLintIssues, lintFix } from "./lintFixes";
import { formatTextRange, textRange } from "./inlineTypography";
import type { LintMessage } from "@open-pencil/core/lint";
let editor:Editor;
beforeEach(()=>{fontManager.setOnlineFontProviders({google:false,fontshare:false,fontsource:false});editor=createEditor();});afterEach(()=>editor.dispose());
it("changes exported properties while keeping imported node IDs, metadata and one undo step",async()=>{
  const root=editor.graph.createNode("FRAME",editor.state.currentPageId,{name:"Card",width:240,height:160,pluginData:[{pluginId:"third-party",key:"data",value:"keep"}]}),child=editor.graph.createNode("RECTANGLE",root.id,{name:"Swatch",width:40,height:30});
  const base=selectionToJSX([root.id],editor.graph,"openpencil");expect(base).toContain('w={240}');
  const edits=await prepareCodeEdits(editor,root.id,base,base.replace('w={240}','w={320}').replace('name="Swatch"','name="Edited swatch"'));expect(applyCodeEdits(editor,edits)).toBe(2);
  expect(root.width).toBe(320);expect(editor.graph.getNode(child.id)?.name).toBe("Edited swatch");expect(root.pluginData[0]?.value).toBe("keep");
  editor.undoAction();expect(root.width).toBe(240);expect(child.name).toBe("Swatch");editor.redoAction();expect(child.name).toBe("Edited swatch");
});
it("rejects stale, structural and executable code without changing the graph",async()=>{
  const root=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{name:"Square",width:40,height:40}),base=selectionToJSX([root.id],editor.graph,"openpencil");
  await expect(prepareCodeEdits(editor,root.id,base,'<Frame><Text>New</Text></Frame>')).rejects.toThrow("structure");
  await expect(prepareCodeEdits(editor,root.id,base,'<Rectangle w={globalThis.fetch("https://example.com")}/>')).rejects.toThrow();
  editor.graph.updateNode(root.id,{width:50});await expect(prepareCodeEdits(editor,root.id,base,base)).rejects.toThrow("changed");expect(root.width).toBe(50);
});
it("detaches only explicitly changed bindings and records instance overrides with undo",async()=>{
  const component=editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Button",width:40,height:40}),instance=editor.graph.createInstance(component.id,editor.state.currentPageId)!;
  const collection=editor.graph.createCollection("Layout"),width=editor.graph.createVariable("Width","FLOAT",collection.id,40),height=editor.graph.createVariable("Height","FLOAT",collection.id,40);editor.graph.bindVariable(instance.id,"width",width.id);editor.graph.bindVariable(instance.id,"height",height.id);
  const base=selectionToJSX([instance.id],editor.graph,"openpencil");const patches=await prepareCodeEdits(editor,instance.id,base,base.replace('w={40}','w={80}'));applyCodeEdits(editor,patches);
  expect(instance.width).toBe(80);expect(instance.boundVariables.width).toBeUndefined();expect(instance.boundVariables.height).toBe(height.id);expect(instance.instanceOverrides.self.has("width")).toBe(true);
  editor.undoAction();expect(instance.width).toBe(40);expect(instance.boundVariables.width).toBe(width.id);expect(instance.instanceOverrides.self.has("width")).toBe(false);
});
const issue=(id:string,ruleId:string):LintMessage=>({nodeId:id,ruleId,severity:"warning",message:"Check",nodeName:"Layer",nodePath:[]});
it("combines supported lint fixes in one undo and leaves locked or ambiguous findings alone",()=>{
  const node=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{name:"Button",x:.25,y:1.3,width:20.5,height:23.2});
  expect(fixLintIssues(editor,[issue(node.id,"pixel-perfect"),issue(node.id,"touch-target-size")])).toBe(1);expect(node).toMatchObject({x:0,y:1,width:44,height:44});editor.undoAction();expect(node.width).toBe(20.5);
  expect(lintFix(node,issue(node.id,"color-contrast"))).toBeNull();node.locked=true;expect(fixLintIssues(editor,[issue(node.id,"pixel-perfect")])).toBe(0);
});
it("formats whole Unicode characters, preserves untouched runs and supports undo and clear",async()=>{
  const node=editor.graph.createNode("TEXT",editor.state.currentPageId,{text:"A😀BC",styleRuns:[{start:3,length:2,style:{italic:true}}]});
  expect(textRange(node.text,2,3)).toEqual([1,3]);expect(()=>textRange(node.text,NaN,2)).toThrow();
  await formatTextRange(editor,node,[2,3],{fontSize:24});expect(node.styleRuns).toEqual(expect.arrayContaining([expect.objectContaining({start:1,length:2,style:expect.objectContaining({fontSize:24})}),expect.objectContaining({start:3,style:expect.objectContaining({italic:true})})]));
  editor.undoAction();expect(node.styleRuns).toHaveLength(1);await formatTextRange(editor,node,[3,5],null);expect(node.styleRuns.some(run=>run.style.italic)).toBe(false);
});
