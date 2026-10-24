import type { SceneNode } from "@open-pencil/scene-graph";
import { usePencilWorkspace } from "./runtime";
import { NumericValue } from "./AppearancePanel";

export function OptionalNumber({label,value,onCommit,min=0,max}:{label:string;value:number|null;onCommit:(value:number|null)=>void;min?:number;max?:number}) {
  return <label>{label}<input aria-label={label} type="number" key={String(value)} min={min} max={max} step="any" defaultValue={value??""} placeholder="Auto" onBlur={event=>{
    const next=event.target.value===""?null:event.target.valueAsNumber;
    if(next!==value&&(next===null||(Number.isFinite(next)&&next>=min&&(max===undefined||next<=max))))onCommit(next);
  }} onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur();}}/></label>;
}
export function LayoutChildPanel({node}:{node:SceneNode}) {
  const editor=usePencilWorkspace(state=>state.editor)!;
  const parent=node.parentId?editor.graph.getNode(node.parentId):null;
  const update=(changes:Partial<SceneNode>)=>editor.updateNodeWithUndo(node.id,changes,"Change layout sizing");
  const position=node.gridPosition??{column:1,row:1,columnSpan:1,rowSpan:1};
  return <>
    <details className="xd-pencil-property-card"><summary>Size limits</summary><div className="xd-pencil-grid">{([ ["minWidth","Min width"], ["maxWidth","Max width"], ["minHeight","Min height"], ["maxHeight","Max height"] ] as const).map(([field,label])=><OptionalNumber key={field} label={label} value={node[field]} onCommit={value=>{
      const minField=field.endsWith("Width")?"minWidth":"minHeight", maxField=field.endsWith("Width")?"maxWidth":"maxHeight";
      const minimum=field===minField?value:node[minField],maximum=field===maxField?value:node[maxField];
      if(minimum!==null&&maximum!==null&&minimum>maximum){usePencilWorkspace.setState({error:"Minimum size must be at most the maximum size."});return;}
      update({[field]:value});
    }}/>)}</div></details>
    {parent&&parent.layoutMode!=="NONE"&&<details className="xd-pencil-property-card" open><summary>Layout child</summary>
      <label>Position<select aria-label="Layout child positioning" value={node.layoutPositioning} onChange={event=>update({layoutPositioning:event.target.value as SceneNode["layoutPositioning"]})}>{["AUTO","ABSOLUTE"].map(value=><option key={value}>{value}</option>)}</select></label>
      {node.layoutPositioning==="AUTO"&&<><NumericValue label="Grow" value={node.layoutGrow} onCommit={layoutGrow=>update({layoutGrow})}/><label>Align self<select aria-label="Align self" value={node.layoutAlignSelf} onChange={event=>update({layoutAlignSelf:event.target.value as SceneNode["layoutAlignSelf"]})}>{["AUTO","MIN","CENTER","MAX","STRETCH","BASELINE"].map(value=><option key={value}>{value}</option>)}</select></label></>}
      {parent.layoutMode==="GRID"&&node.layoutPositioning==="AUTO"&&<><label><input aria-label="Explicit grid placement" type="checkbox" checked={node.gridPosition!==null} onChange={event=>update({gridPosition:event.target.checked?position:null})}/>Explicit grid placement</label>
        {node.gridPosition&&<div className="xd-pencil-grid">{([ ["column","Grid column"], ["row","Grid row"], ["columnSpan","Column span"], ["rowSpan","Row span"] ] as const).map(([field,label])=><NumericValue key={field} label={label} min={1} value={position[field]} onCommit={value=>{if(Number.isInteger(value))update({gridPosition:{...position,[field]:value}});}}/>)}</div>}
      </>}
    </details>}
  </>;
}
