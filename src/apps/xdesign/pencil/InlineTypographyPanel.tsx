import { useRef, useState } from "react";
import type { CharacterStyleOverride, SceneNode } from "@open-pencil/scene-graph";
import { getStyleAt } from "@open-pencil/core/text";
import { usePencilWorkspace } from "./runtime";
import { formatTextRange, textRange } from "./inlineTypography";

export function InlineTypographyPanel({node}:{node:SceneNode}) {
  const editor=usePencilWorkspace(workspace=>workspace.editor)!;
  const [range,setRange]=useState<[number,number]>([0,0]),[error,setError]=useState("");
  const selected=useRef(range);selected.current=range;
  const current=editor.textEditor?.nodeId===node.id?editor.textEditor.getSelectionRange():null;
  selected.current=current??range;
  const text=editor.textEditor?.nodeId===node.id?editor.textEditor.state?.text??node.text:node.text;
  const shown=current??range,[start,end]=textRange(text,...shown);
  const style={...node,...getStyleAt(node.styleRuns,start)};
  const capture=()=>{if(current){selected.current=current;setRange(current);}};
  const apply=(patch:CharacterStyleOverride|null)=>{void formatTextRange(editor,node,selected.current,patch).then(()=>setError("")).catch(error=>setError(String(error)));};
  const number=(label:string,key:"fontSize"|"fontWeight"|"letterSpacing"|"lineHeight",value:number|null,min:number,max:number)=><label>{label}<input aria-label={`Selected text ${label.toLowerCase()}`} type="number" key={`${start}/${end}/${value}`} step="any" min={min} max={max} defaultValue={value??""} onBlur={event=>{const value=event.currentTarget.valueAsNumber;if(Number.isFinite(value)&&value>=min&&value<=max)apply({[key]:value});}}/></label>;
  return <details className="xd-pencil-property-card" onPointerDownCapture={capture} onFocusCapture={capture}><summary>Selected characters</summary>
    <p className="xd-pencil-section-help">Select characters on the canvas or in this text preview.</p>
    <textarea aria-label="Select characters to format" readOnly value={text} onFocus={()=>{if(editor.state.editingTextId===node.id)editor.commitTextEdit();}} onSelect={event=>{const input=event.currentTarget;const range=textRange(text,input.selectionStart,input.selectionEnd);selected.current=range;setRange(range);}}/>
    <p role="status">{start===end?"No characters selected":`${end-start} characters selected`}</p>
    <fieldset disabled={start===end||node.locked}>
      <label>Font<input aria-label="Selected text font" key={`${start}/${end}/${style.fontFamily}`} defaultValue={style.fontFamily} onBlur={event=>{if(event.target.value.trim())apply({fontFamily:event.target.value.trim()});}}/></label>
      <div className="xd-pencil-grid">{number("Size","fontSize",style.fontSize,1,10000)}{number("Weight","fontWeight",style.fontWeight,1,1000)}{number("Letter spacing","letterSpacing",style.letterSpacing,-10000,10000)}{number("Line height","lineHeight",style.lineHeight,1,10000)}</div>
      <label><input aria-label="Selected text italic" type="checkbox" checked={style.italic} onChange={event=>apply({italic:event.target.checked})}/>Italic</label>
      <label>Decoration<select aria-label="Selected text decoration" value={style.textDecoration} onChange={event=>apply({textDecoration:event.target.value as CharacterStyleOverride["textDecoration"]})}>{["NONE","UNDERLINE","STRIKETHROUGH"].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Decoration style<select aria-label="Selected text decoration style" value={style.textDecorationStyle} onChange={event=>apply({textDecorationStyle:event.target.value as CharacterStyleOverride["textDecorationStyle"]})}>{["SOLID","DOTTED","WAVY"].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Color<input aria-label="Selected text color" type="color" key={`${start}/${end}/${JSON.stringify(style.fills)}`} defaultValue={`#${[style.fills[0]?.color.r??1,style.fills[0]?.color.g??1,style.fills[0]?.color.b??1].map(value=>Math.round(Math.max(0,Math.min(1,value))*255).toString(16).padStart(2,"0")).join("")}`} onChange={event=>{const hex=event.target.value;apply({fills:[{type:"SOLID",color:{r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255,a:1},opacity:1,visible:true}]});}}/></label>
      <label>Language<input aria-label="Selected text language" key={`${start}/${end}/${style.textLanguage}`} defaultValue={style.textLanguage??""} onBlur={event=>apply({textLanguage:event.target.value.trim()||null})}/></label>
      <button type="button" onClick={()=>apply(null)}>Clear character formatting</button>
    </fieldset>{error&&<p role="alert">{error}</p>}
  </details>;
}
