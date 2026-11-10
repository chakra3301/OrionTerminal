import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import type { SceneNode } from "@open-pencil/scene-graph";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePencilWorkspace } from "./runtime";
import { ComponentPanel } from "./ComponentPanel";
import { createComponentProperty, setPreferredComponents } from "./componentProperties";

let root:Root,container:HTMLDivElement,editor:Editor;
const render=async(node:SceneNode)=>act(async()=>root.render(<ComponentPanel node={node}/>));
const button=(label:string)=>container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);editor=createEditor();usePencilWorkspace.setState({editor,busy:false});
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(()=>{act(()=>root.unmount());editor.dispose();usePencilWorkspace.setState({editor:null});container.remove();vi.unstubAllGlobals();});
it("distinguishes same-name choices with their library names",async()=>{
  const main=editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Button"});
  const icon=(name:string)=>editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Icon",librarySource:{identity:{libraryId:name,assetKey:"icon",revisionId:"revision"},sourceNodeId:name,readOnly:true},pluginData:[{pluginId:"orion.xdesign",key:"libraryDisplayName",value:name}]});
  const first=icon("First icons"),second=icon("Second icons"),property=createComponentProperty(editor,main,"Icon","INSTANCE_SWAP",first.id);setPreferredComponents(editor,main,property,[first.id,second.id]);await render(main);
  expect([...container.querySelectorAll('optgroup[label="Preferred components"] option')].map(option=>option.textContent)).toEqual(["Icon · First icons","Icon · Second icons"]);
  expect(container.querySelector('[aria-label="Prefer Icon · Second icons for Icon"]')).toBeTruthy();
});
it("edits preferred swaps and offers them first without removing the remaining component choices",async()=>{
  const main=editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Button"});
  const first=editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"First"}),second=editor.graph.createNode("COMPONENT",editor.state.currentPageId,{name:"Second"});
  const property=createComponentProperty(editor,main,"Icon","INSTANCE_SWAP",first.id);await render(main);
  await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Prefer Second for Icon"]')!.click());await render(main);
  expect(main.componentPropertyDefinitions[0]?.preferredValues).toEqual([second.id]);
  expect(container.querySelector('optgroup[label="Preferred components"]')?.textContent).toBe("Second");
  expect(container.querySelector('optgroup[label="Other components"]')?.textContent).toContain("First");
  const instance=editor.graph.createInstance(main.id,editor.state.currentPageId)!;await render(instance);
  expect(container.querySelector('optgroup[label="Preferred components"]')?.textContent).toBe("Second");
  editor.undoAction();expect(main.componentPropertyDefinitions.find(def=>def.id===property)?.preferredValues).toBeUndefined();
});
it("renames and orders variant values and property definitions with real undo",async()=>{
  const set=editor.graph.createNode("COMPONENT_SET",editor.state.currentPageId,{name:"Buttons"});
  const size=editor.addPropertyDefinition(set.id,"Size","VARIANT","Small")!;
  const tone=editor.addPropertyDefinition(set.id,"Tone","VARIANT","Quiet")!;
  editor.graph.createNode("COMPONENT",set.id,{name:"Small",componentPropertyValues:{Size:"Small",Tone:"Quiet"}});
  editor.graph.createNode("COMPONENT",set.id,{name:"Large",componentPropertyValues:{Size:"Large",Tone:"Quiet"}});
  const large=editor.graph.getChildren(set.id)[1]!;
  editor.graph.updateNode(set.id,{componentPropertyDefinitions:set.componentPropertyDefinitions.map(def=>({...def,variantOptions:def.id===size?["Small","Large"]:["Quiet"]}))});
  await render(set);
  await act(async()=>button("Move Size Large up").click());await render(set);
  expect(set.componentPropertyDefinitions.find(def=>def.id===size)?.variantOptions?.[0]).toBe("Large");
  await act(async()=>button("Move property Size down").click());await render(set);
  expect(set.componentPropertyDefinitions.map(def=>def.id)).toEqual([tone,size]);
  const field=container.querySelector<HTMLInputElement>('[aria-label="Rename Size value Large"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(field,"Big");field.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));});
  expect(large.componentPropertyValues.Size).toBe("Big");editor.undoAction();expect(large.componentPropertyValues.Size).toBe("Large");
  editor.undoAction();expect(set.componentPropertyDefinitions[0]?.id).toBe(size);editor.undoAction();expect(set.componentPropertyDefinitions.find(def=>def.id===size)?.variantOptions?.[0]).toBe("Small");
});
