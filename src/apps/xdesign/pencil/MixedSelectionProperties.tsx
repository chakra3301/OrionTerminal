import { usePencilWorkspace } from "./runtime";
import { InspectorSection } from "../EditorChrome";
import { recordInstanceOverride, type SceneNode, type Fill, type SceneGraph } from "@open-pencil/scene-graph";
import { editPencilGraph } from "./toolExecution";
import { BLEND_LABELS, colorHex, displayNumber, hexColor } from "./AppearancePanel";
import { isLibraryDefinition } from "./librarySession";
import { LayoutPanel } from "./LayoutPanel";
import { SharedStylesPanel } from "./SharedStylesPanel";

function isLocked(graph:SceneGraph,node:SceneNode):boolean {
  if(node.locked)return true;
  const parent=node.parentId&&graph.getNode(node.parentId);
  return !!parent&&isLocked(graph,parent);
}

export function MixedSelectionProperties({nodes}:{nodes:SceneNode[]}) {
  const editor=usePencilWorkspace(state=>state.editor)!;
  const editable=nodes.filter(node=>!isLocked(editor.graph,node)&&!isLibraryDefinition(editor.graph,node));
  const change=(label:string,patch:(node:SceneNode)=>Partial<SceneNode>)=>{
    try {editPencilGraph(editor,label,()=>{for(const node of editable){const changes=patch(node);if(Object.keys(changes).length){editor.updateNode(node.id,changes);recordInstanceOverride(editor.graph,node.id,Object.keys(changes));}}});}
    catch(error){usePencilWorkspace.setState({error:String(error)});}
  };
  const numeric=(field:"width"|"height"|"rotation"|"cornerRadius"|"opacity"|"fontSize",label:string,min?:number,max?:number)=>{
    const targets=field==="fontSize"?editable.filter(node=>node.type==="TEXT"):editable;
    if(!targets.length)return null;
    const first=targets[0]![field],same=targets.every(node=>node[field]===first),multiplier=field==="opacity"?100:1,shown=displayNumber(first*multiplier);
    return <label>{label}<input aria-label={`Selection ${label}`} key={`${targets.map(node=>`${node.id}:${node[field]}`).join(",")}`} type="number" min={min} max={max} step="any" placeholder={same?undefined:"Mixed"} defaultValue={same?shown:""} disabled={!editable.length} onBlur={event=>{const value=event.target.valueAsNumber;if(Number.isFinite(value)&&!(same&&value===shown)&&(min===undefined||value>=min)&&(max===undefined||value<=max))change(`Change selection ${label}`,node=>targets.includes(node)?{[field]:value/multiplier}:{});}} onKeyDown={event=>{if(event.key==="Enter")event.currentTarget.blur();}}/></label>;
  };
  const solid=editable.length>0&&editable.every(node=>node.fills.length===1&&node.fills[0]?.type==="SOLID");
  const firstFill=editable[0]?.fills[0];
  const sameColor=solid&&editable.every(node=>colorHex(node.fills[0]!.color)===colorHex(firstFill!.color));
  return <><div className="xd-pencil-selection-head"><strong>{nodes.length} layers selected</strong>{editable.length!==nodes.length&&<small>{editable.length} editable · locked and library layers retained</small>}</div>
    <InspectorSection title="Layer dimensions" defaultOpen><div className="xd-pencil-grid">{numeric("width","Layer width",0)}{numeric("height","Layer height",0)}{numeric("rotation","Rotation")}{numeric("cornerRadius","Corner radius",0)}</div><p className="xd-pencil-section-help">Each value applies to the selected layers. Canvas handles scale the selection together.</p></InspectorSection>
    <InspectorSection title="Appearance" defaultOpen>{numeric("opacity","Opacity %",0,100)}<label>Blend<select aria-label="Selection blend" disabled={!editable.length} value={editable.every(node=>node.blendMode===editable[0]?.blendMode)?editable[0]?.blendMode??"MIXED":"MIXED"} onChange={event=>change("Change selection blend",()=>({blendMode:event.target.value as SceneNode["blendMode"]}))}><option value="MIXED" disabled>Mixed</option>{Object.entries(BLEND_LABELS).map(([mode,label])=><option key={mode} value={mode}>{label}</option>)}</select></label>
    {solid&&<label>{sameColor?"Fill color":"Fill color · mixed"}<input aria-label="Selection fill color" type="color" key={editable.map(node=>colorHex(node.fills[0]!.color)).join(",")} defaultValue={colorHex(firstFill!.color)} onBlur={event=>{const color=event.target.value;change("Change selection fill",node=>({fills:node.fills.map(fill=>({...fill,color:hexColor(color,fill.color.a)}))}));}}/></label>}
    <div className="xd-pencil-buttons"><button disabled={!editable.length} onClick={()=>change("Add selection fill",node=>({fills:[...node.fills,{type:"SOLID",color:{r:.75,g:.75,b:.75,a:1},opacity:1,visible:true} as Fill]}))}>Add fill</button><button disabled={!editable.length} onClick={()=>change("Add selection stroke",node=>({strokes:[...node.strokes,{color:{r:0,g:0,b:0,a:1},weight:1,opacity:1,visible:true,align:"INSIDE"}]}))}>Add stroke</button><button disabled={!editable.length} onClick={()=>change("Show selection",()=>({visible:true}))}>Show all</button><button disabled={!editable.length} onClick={()=>change("Hide selection",()=>({visible:false}))}>Hide all</button></div><SharedStylesPanel nodes={editable}/></InspectorSection>
    {editable.some(node=>node.type==="TEXT")&&<InspectorSection title="Typography" defaultOpen>{numeric("fontSize","Font size",1)}<label>Font family<input aria-label="Selection font family" key={editable.filter(node=>node.type==="TEXT").map(node=>node.fontFamily).join(",")} defaultValue={editable.filter(node=>node.type==="TEXT").every(node=>node.fontFamily===editable.find(node=>node.type==="TEXT")?.fontFamily)?editable.find(node=>node.type==="TEXT")?.fontFamily:""} placeholder={editable.filter(node=>node.type==="TEXT").every(node=>node.fontFamily===editable.find(node=>node.type==="TEXT")?.fontFamily)?undefined:"Mixed"} onBlur={event=>{if(event.target.value.trim()){change("Change selection font",node=>node.type==="TEXT"?{fontFamily:event.target.value.trim()}:{});void editor.loadFontsForNodes(editable.filter(node=>node.type==="TEXT").map(node=>node.id)).catch(error=>usePencilWorkspace.setState({error:String(error)}));}}}/></label></InspectorSection>}
    <InspectorSection title="Components & vectors"><div className="xd-pencil-buttons">{nodes.every(node=>node.type==="COMPONENT")&&<button onClick={()=>editor.createComponentSetFromComponents()}>Combine variants</button>}{(["UNION","SUBTRACT","INTERSECT","EXCLUDE"] as const).map(operation=><button key={operation} onClick={()=>editor.booleanOperationSelected(operation)}>{operation.toLowerCase()}</button>)}{nodes.some(node=>node.strokes.length)&&<button onClick={()=>editor.outlineStrokeSelected()}>Outline stroke</button>}{nodes.some(node=>node.type==="TEXT")&&<button onClick={()=>editor.outlineTextSelected()}>Outline text</button>}</div></InspectorSection>
    <InspectorSection title="Arrange" defaultOpen>{nodes[0]&&<LayoutPanel node={nodes[0]} part="arrange"/>}<div className="xd-pencil-buttons"><button onClick={()=>editor.duplicateSelected()}>Duplicate</button><button onClick={()=>editor.createComponentFromSelection()}>Create component</button><button onClick={()=>editor.deleteSelected()}>Delete selected</button></div></InspectorSection>
  </>;
}
