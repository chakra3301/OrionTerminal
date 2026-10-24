import { useEffect, useId, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { fontManager } from "@open-pencil/core/text";
import type { SceneNode } from "@open-pencil/scene-graph";
import { usePencilWorkspace } from "./runtime";
import { AdvancedTypography } from "./AdvancedTypography";
import { InlineTypographyPanel } from "./InlineTypographyPanel";

let families:Promise<string[]>|null=null;
export function TypographyPanel({node}:{node:SceneNode}) {
  const editor=usePencilWorkspace(s=>s.editor)!;const listId=useId();const [fonts,setFonts]=useState(["Inter"]);
  useEffect(()=>{let alive=true;families??=isTauri()?invoke<string[]>("xdesign_font_families"):fontManager.listFamilies();void families.then(names=>{if(alive)setFonts([...new Set(["Inter",...names])]);}).catch(error=>{families=null;if(alive)usePencilWorkspace.setState({error:String(error)});});return()=>{alive=false;};},[]);
  const update=(patch:Partial<SceneNode>)=>editor.updateNodeWithUndo(node.id,patch,"Change typography");
  return <><label>Font<input aria-label="Font family" list={listId} defaultValue={node.fontFamily} key={`${node.id}/${node.fontFamily}`} onBlur={e=>{if(e.target.value!==node.fontFamily){update({fontFamily:e.target.value});void editor.loadFontsForNodes([node.id]).catch(error=>usePencilWorkspace.setState({error:String(error)}));}}}/><datalist id={listId}>{fonts.map(font=><option key={font} value={font}/>)}</datalist></label>
    {([ ["textAlignHorizontal","Alignment",["LEFT","CENTER","RIGHT","JUSTIFIED"]],["textAlignVertical","Vertical alignment",["TOP","CENTER","BOTTOM"]],["textAutoResize","Text resizing",["NONE","HEIGHT","WIDTH_AND_HEIGHT","TRUNCATE"]],["textCase","Case",["ORIGINAL","UPPER","LOWER","TITLE"]],["textDecoration","Decoration",["NONE","UNDERLINE","STRIKETHROUGH"]],["textDirection","Direction",["AUTO","LTR","RTL"]] ] as const).map(([field,label,options])=><label key={field}>{label}<select aria-label={label} value={node[field]} onChange={e=>update({[field]:e.target.value})}>{options.map(v=><option key={v}>{v}</option>)}</select></label>)}
    <label><input type="checkbox" checked={node.italic} onChange={e=>{update({italic:e.target.checked});void editor.loadFontsForNodes([node.id]).catch(error=>usePencilWorkspace.setState({error:String(error)}));}}/>Italic</label>
    <AdvancedTypography node={node}/>
    <InlineTypographyPanel key={node.id} node={node}/>
    {!fontManager.isLoaded(node.fontFamily)&&<p>Font is loading or unavailable on this device. Imported glyph outlines remain available where present.</p>}
  </>;
}
