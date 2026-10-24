import { useContext,useState } from 'react';
import type { SceneNode } from '@open-pencil/scene-graph';
import { usePencilWorkspace } from './runtime';
import { mainSlotComponent } from './slots';
import { BEHAVIOUR_KINDS,INTERACTION_STATES,behaviourContract } from './behaviour/kinds';
import { behaviourOwner,behaviourProperties,missingBindings,readBehaviour } from './behaviour/model';
import { behaviourToSpec,type BehaviourSpec } from './behaviour/spec';
import { setComponentBehaviour } from './behaviour/editor';
import { BehaviourPreviewDialog } from './BehaviourPreviewDialog';
import { CanvasPreviewContext } from './CanvasPreviewContext';

const label=(value:string)=>value.replace(/([A-Z])/g,' $1').replace(/^./,char=>char.toUpperCase());
export function BehaviourPanel({node}:{node:SceneNode}){
  const editor=usePencilWorkspace(state=>state.editor)!,canvas=useContext(CanvasPreviewContext),[error,setError]=useState(''),[preview,setPreview]=useState<'dialog'|'canvas'|null>(null);
  const main=node.type==='INSTANCE'?mainSlotComponent(editor.graph,node):node,owner=main&&behaviourOwner(editor.graph,main);if(!owner)return null;
  const behaviour=readBehaviour(owner),spec=behaviour?behaviourToSpec(editor.graph,owner,behaviour):null,properties=behaviourProperties(editor.graph,owner),missing=behaviour?missingBindings(editor.graph,owner,behaviour):[];
  const editable=node.type!=='INSTANCE',contract=behaviour&&behaviourContract(behaviour.kind);
  const act=(next:BehaviourSpec|null)=>{try{setComponentBehaviour(editor,owner,next);setError('');}catch(error){setError(String(error));}};
  const values=(types:string[])=>[...new Map(properties.filter(def=>types.includes(def.type)).map(def=>[def.name,def])).values()];
  const bind=(record:'values'|'parts',key:string,value:string)=>{if(!spec)return;const entries:Record<string,string|{property:string;on?:string;off?:string}>={...spec[record]};if(value)entries[key]=value;else delete entries[key];act(record==='parts'?{...spec,parts:entries as Record<string,string>}:{...spec,values:entries});};
  return <div className="xd-pencil-behaviour-panel"><h3>Interactive behavior</h3>
    {editable?<label>Control<select aria-label="Component behavior" value={behaviour?.kind??''} onChange={event=>act(event.target.value?{kind:event.target.value as BehaviourSpec['kind']}:null)}><option value="">None</option>{BEHAVIOUR_KINDS.map(kind=><option key={kind} value={kind}>{label(kind)}</option>)}</select></label>:<p className="xd-pencil-section-help">{behaviour?`${label(behaviour.kind)} · edit bindings in the main component.`:'Configure behavior in the main component.'}</p>}
    {editable&&spec&&behaviour&&contract&&<>
      {contract.values.filter(value=>value.type==='boolean'||value.type==='text').map(value=>{
        const binding=spec.values?.[value.id],name=typeof binding==='string'?binding:binding?.property??'',property=properties.find(def=>def.name===name);
        return <div key={value.id} className="xd-pencil-property-card"><label>{label(value.id)}{value.required?' *':''}<select aria-label={`Bind behavior ${value.id}`} value={name} onChange={event=>bind('values',value.id,event.target.value)}><option value="">Unbound</option>{values(value.type==='text'?['TEXT']:['BOOLEAN','VARIANT']).map(def=><option key={def.id} value={def.name}>{def.name}</option>)}</select></label>
          {value.type==='boolean'&&property?.type==='VARIANT'&&<div className="xd-pencil-grid">{(['on','off'] as const).map(key=><label key={key}>{label(key)}<select aria-label={`${value.id} ${key} variant`} value={behaviour.booleans[value.id]?.[key]??''} onChange={event=>act({...spec,values:{...spec.values,[value.id]:{property:name,...(typeof binding==='object'?binding:{}),[key]:event.target.value}}})}>{(property.variantOptions??[]).map(option=><option key={option}>{option}</option>)}</select></label>)}</div>}
        </div>;
      })}
      {contract.values.filter(value=>value.type==='number').map(value=><details key={value.id}><summary>{label(value.id)} range</summary><div className="xd-pencil-grid">{(['min','max','step','default'] as const).map(key=><label key={key}>{label(key)}<input aria-label={`Behavior ${value.id} ${key}`} key={behaviour.numbers[value.id]?.[key]} type="number" step="any" defaultValue={behaviour.numbers[value.id]?.[key]} onBlur={event=>act({...spec,numbers:{...spec.numbers,[value.id]:{...spec.numbers?.[value.id],[key]:event.target.valueAsNumber}}})}/></label>)}</div></details>)}
      {contract.parts.map(part=><label key={part.id}>{label(part.id)} slot{part.required?' *':''}<select aria-label={`Bind behavior ${part.id} slot`} value={spec.parts?.[part.id]??''} onChange={event=>bind('parts',part.id,event.target.value)}><option value="">Unbound</option>{values(['SLOT']).map(def=><option key={def.id} value={def.name}>{def.name}</option>)}</select></label>)}
      <details><summary>Hover, pressed & keyboard states</summary><label>Variant property<select aria-label="Interaction state property" value={typeof spec.states==='string'?spec.states:spec.states?.property??''} onChange={event=>act({...spec,states:event.target.value||undefined})}><option value="">Unbound</option>{values(['VARIANT']).map(def=><option key={def.id} value={def.name}>{def.name}</option>)}</select></label>
        {behaviour.states&&INTERACTION_STATES.map(state=><label key={state}>{label(state)}<select aria-label={`Interaction ${state} variant`} value={behaviour.states?.[state]??''} onChange={event=>act({...spec,states:{...(typeof spec.states==='object'?spec.states:{}),property:typeof spec.states==='string'?spec.states:spec.states!.property,[state]:event.target.value||undefined}})}><option value="">Use rest</option>{properties.find(def=>def.id===behaviour.states?.propertyId)?.variantOptions?.map(value=><option key={value}>{value}</option>)}</select></label>)}
      </details>
    </>}
    {missing.length>0&&<p role="status">Bind {missing.join(', ')} to preview this control.</p>}
    {behaviour&&<><button disabled={missing.length>0} onClick={()=>setPreview('dialog')}>Preview interactions</button>{canvas&&<button disabled={missing.length>0} onClick={()=>setPreview('canvas')}>Try on canvas</button>}</>}
    {preview&&<BehaviourPreviewDialog key={preview} node={node} canvas={preview==='canvas'?canvas??undefined:undefined} close={()=>setPreview(null)}/>} {error&&<p role="alert">{error}</p>}
  </div>;
}
