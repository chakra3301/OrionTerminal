import { parse } from 'valibot';
import type { Editor } from '@open-pencil/core/editor';
import type { SceneNode } from '@open-pencil/scene-graph';
import { behaviourOwner, withBehaviour } from './model';
import { behaviourFromSpec, behaviourSpecSchema, type BehaviourSpec } from './spec';

export function setComponentBehaviour(editor:Editor,node:SceneNode,spec:BehaviourSpec|null){
  const owner=behaviourOwner(editor.graph,node);if(!owner)throw new Error('Choose a main component or component set.');
  let current:SceneNode|undefined=owner;
  while(current){if(current.locked||current.internalOnly||current.librarySource?.readOnly)throw new Error('Edit the original unlocked component to change its behavior.');current=current.parentId?editor.graph.getNode(current.parentId):undefined;}
  const behaviour=spec?behaviourFromSpec(editor.graph,owner,parse(behaviourSpecSchema,spec)):null;
  for(const settings of Object.values(behaviour?.numbers??{}))if(settings.default<settings.min||settings.default>settings.max)throw new Error('The default number must be inside its range.');
  const pluginData=withBehaviour(owner,behaviour);
  if(JSON.stringify(pluginData)===JSON.stringify(owner.pluginData))return;
  editor.updateNodeWithUndo(owner.id,{pluginData},'Change component behavior');
}
