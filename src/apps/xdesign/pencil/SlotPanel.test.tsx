import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import type { SceneNode } from '@open-pencil/scene-graph';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { SlotPanel } from './SlotPanel';
import { usePencilWorkspace } from './runtime';
import { installSlotSupport,instanceSlotFrames,ownsSlotContent,slotDefinitions } from './slots';
let editor:Editor,root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);editor=createEditor();installSlotSupport(editor.graph);usePencilWorkspace.setState({editor,busy:false});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());editor.dispose();usePencilWorkspace.setState({editor:null});container.remove();vi.unstubAllGlobals();});
const render=async(node:SceneNode)=>act(async()=>root.render(<SlotPanel node={node}/>));
const click=async(text:string)=>act(async()=>[...container.querySelectorAll('button')].find(button=>button.textContent===text)!.click());
it('authors a slot in the existing inspector and edits, clears and resets real instance content',async()=>{
  const graph=editor.graph,main=graph.createNode('COMPONENT',editor.state.currentPageId,{name:'Card'}),frame=graph.createNode('FRAME',main.id,{name:'Body'});graph.createNode('TEXT',frame.id,{text:'Default'});
  await render(frame);await click('Make content slot');await render(main);expect(container.textContent).toContain('Default content');expect(container.querySelector('[aria-label="Maximum layers"]')).toBeTruthy();
  const instance=graph.createInstance(main.id,editor.state.currentPageId)!;await render(instance);expect(container.textContent).toContain('Component content');await click('Edit contents');await render(instance);
  expect(ownsSlotContent(graph,instanceSlotFrames(graph,instance)[0]!)).toBe(true);expect(container.textContent).toContain('Instance content');
  await click('Clear slot');await render(instance);expect(instanceSlotFrames(graph,instance)[0]!.childIds).toHaveLength(0);
  await click('Reset slot');await render(instance);expect(instanceSlotFrames(graph,instance)[0]!.childIds).toHaveLength(1);expect(ownsSlotContent(graph,instanceSlotFrames(graph,instance)[0]!)).toBe(false);
  await render(frame);await click('Remove slot binding');expect(slotDefinitions(graph,instance)).toHaveLength(0);
});
it('shows actionable errors and leaves locked slot definitions untouched',async()=>{
  const graph=editor.graph,main=graph.createNode('COMPONENT',editor.state.currentPageId),frame=graph.createNode('FRAME',main.id,{locked:true});await render(frame);await click('Make content slot');expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unlock');expect(main.componentPropertyDefinitions).toHaveLength(0);
});
