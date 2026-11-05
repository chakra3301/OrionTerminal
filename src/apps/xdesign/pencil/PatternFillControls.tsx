import { useState } from "react";
import type { Fill, SceneNode } from "@open-pencil/scene-graph";
import { usePencilWorkspace } from "./runtime";
import { NumericValue } from "./AppearancePanel";

export function PatternFillControls({node,fill,index,change}:{node:SceneNode;fill:Fill;index:number;change:(patch:Partial<Fill>)=>void}) {
  const [search,setSearch]=useState("");
  const graph=usePencilWorkspace(workspace=>workspace.editor)!.graph;
  const safe=(id:string,visited=new Set<string>()):boolean=>{if(id===node.id||visited.has(id)||visited.size>=128)return false;visited.add(id);const source=graph.getNode(id);return !!source&&source.fills.filter(fill=>fill.type==="PATTERN"&&fill.sourceNodeId).every(fill=>safe(fill.sourceNodeId!,new Set(visited)));};
  const sources=[...graph.nodes.values()].filter(source=>(source.id===fill.sourceNodeId||source.name.toLowerCase().includes(search.toLowerCase()))&&source.width>0&&source.height>0&&source.fills.length&&safe(source.id));
  const prefix=`Pattern ${index+1}`,spacing=fill.patternSpacing??{x:0,y:0};
  return <><label>Find source<input aria-label={`Find ${prefix.toLowerCase()} source`} value={search} onChange={event=>setSearch(event.target.value)}/></label><label>Source layer<select aria-label={`${prefix} source`} value={fill.sourceNodeId??""} onChange={event=>change({sourceNodeId:event.target.value})}><option value="">Choose layer</option>{fill.sourceNodeId&&!sources.slice(0,200).some(source=>source.id===fill.sourceNodeId)&&<option value={fill.sourceNodeId}>{graph.getNode(fill.sourceNodeId)?.name??"Unavailable source"}</option>}{sources.slice(0,200).map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
    {sources.length>200&&<p role="status">Showing 200 matches. Narrow the source search.</p>}
    <NumericValue label={`${prefix} scale %`} value={(fill.scale??1)*100} min={.1} max={10000} onCommit={scale=>change({scale:scale/100})}/>
    <div className="xd-pencil-grid"><NumericValue label={`${prefix} horizontal gap %`} value={spacing.x*100} min={0} max={10000} onCommit={x=>change({patternSpacing:{...spacing,x:x/100}})}/><NumericValue label={`${prefix} vertical gap %`} value={spacing.y*100} min={0} max={10000} onCommit={y=>change({patternSpacing:{...spacing,y:y/100}})}/></div>
    <label>Tile arrangement<select aria-label={`${prefix} arrangement`} value={fill.patternTileType??"RECTANGULAR"} onChange={event=>change({patternTileType:event.target.value as Fill["patternTileType"]})}>{["RECTANGULAR","HORIZONTAL_HEXAGONAL","VERTICAL_HEXAGONAL"].map(value=><option key={value}>{value}</option>)}</select></label>
    {(["horizontalAlignment","verticalAlignment"] as const).map(key=><label key={key}>{key==="horizontalAlignment"?"Horizontal":"Vertical"} alignment<select aria-label={`${prefix} ${key}`} value={fill[key]??"START"} onChange={event=>change({[key]:event.target.value})}>{["START","CENTER","END"].map(value=><option key={value}>{value}</option>)}</select></label>)}
    {!fill.sourceNodeId&&<p role="status">Choose the layer whose fills will repeat.</p>}
  </>;
}
