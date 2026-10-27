import { useEffect, useRef, useState } from "react";
import { runPhotoCommand } from "./runtime";
import { textReplacement } from "./ImageDialogs";
import type { PhotoLayer } from "./types";

/** Where the caret was when a type layer's text was last edited on canvas, in characters, for Edit › Paste Special ›
 *  Paste without Formatting once the editor has closed. */
export const lastTextCaret:{current:{layer:number;range:[number,number]}|null}={current:null};

export type CanvasText={layer:PhotoLayer;point?:undefined}|{layer?:undefined;point:[number,number]};

export function findTextLayer(layers:PhotoLayer[],x:number,y:number):PhotoLayer|undefined {
  for(const layer of layers){
    const bounds=layer.bounds;
    if(layer.text&&layer.visible&&bounds&&x>=bounds[0]&&y>=bounds[1]&&x<=bounds[0]+bounds[2]&&y<=bounds[1]+bounds[3])return layer;
    const child=layer.children&&findTextLayer(layer.children,x,y);if(child)return child;
  }
}

// Point text is anchored at its baseline; existing layers open over their bounds.
export function CanvasTextEditor({target,zoom,resolution,font,size,color,create,after,close}:{target:CanvasText;zoom:number;resolution:number;font:string;size:number;color:string;create?:Record<string,unknown>;after?:{antialias:string;orientation:string};close:(work?:Promise<unknown>)=>void}) {
  const original=target.layer?.text?.text??"",[text,setText]=useState(original),[committing,setCommitting]=useState(false),field=useRef<HTMLTextAreaElement>(null),done=useRef(false);
  const pointSize=target.layer?.text?.sizePt??size,pixels=pointSize*resolution/72*zoom,lines=text.split("\n");
  const left=(target.layer?.bounds?.[0]??target.point![0])*zoom,top=target.layer?.bounds?(target.layer.bounds[1]*zoom):(target.point![1]*zoom-pixels*.8);
  useEffect(()=>{field.current?.focus();field.current?.select();},[]);
  // A committed edit stays in the field until the image shows it.
  const finish=(commit:boolean)=>{
    if(done.current)return;done.current=true;
    const chars=(index:number)=>Array.from(text.slice(0,index)).length;
    if(commit&&target.layer&&field.current)lastTextCaret.current={layer:target.layer.id,range:[chars(field.current.selectionStart),chars(field.current.selectionEnd)]};
    const replace=commit&&target.layer?textReplacement(original,text):null;
    const work=!commit?null:!target.layer?(text.trim()?runPhotoCommand("type.create",{text,font,size,color,x:target.point[0],y:target.point[1],...create}).then(async result=>{const layer=(result as {layer?:number}|undefined)?.layer;if(layer===undefined)return result;if(after&&after.antialias!=="smooth")await runPhotoCommand("type.edit",{layer,antialias:after.antialias});if(after&&after.orientation!=="horizontal")await runPhotoCommand(`type.orientation.${after.orientation}`,{layer});return result;}):null):replace?runPhotoCommand("type.edit",{layer:target.layer.id,replace}):null;
    if(!work){close();return;}
    void work.catch(()=>{});setCommitting(true);close(work);
  };
  return <textarea ref={field} className="xd-photo-canvas-text" aria-label="Text on canvas" spellCheck={false} value={text} readOnly={committing}
    style={{left,top,fontFamily:target.layer?.text?.font??font,fontSize:pixels,lineHeight:1.2,...(target.layer?{}:{color}),width:Math.max(4,...lines.map(line=>line.length))*pixels*.62+16,height:lines.length*pixels*1.2+8}}
    onChange={event=>setText(event.target.value)} onBlur={()=>finish(true)}
    onKeyDown={event=>{event.stopPropagation();if(event.key==="Escape"){event.preventDefault();finish(false);}else if(event.key==="Enter"&&(event.metaKey||event.ctrlKey)){event.preventDefault();finish(true);}}}/>;
}
