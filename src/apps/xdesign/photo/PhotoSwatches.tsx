import { useEffect, useState } from "react";

export const IMAGE_SWATCHES_KEY="orion.xdesign.image-swatches.v1";
const DEFAULT_SWATCHES=["#000000","#ffffff","#808080","#c0c0c0","#ff0000","#ff8000","#ffff00","#00ff00","#00ffff","#0000ff","#8000ff","#ff00ff"];
const MAX_SWATCHES=64;
const isHex=(value:unknown):value is string=>typeof value==="string"&&/^#[0-9a-f]{6}$/.test(value);
function readSwatches():string[] {
  try {const saved:unknown=JSON.parse(localStorage.getItem(IMAGE_SWATCHES_KEY)??"[]");return Array.isArray(saved)?saved.filter(isHex).slice(0,MAX_SWATCHES):[];}
  catch {return [];}
}
const SWATCHES_CHANGED="orion:image-swatches";
function storeSwatches(next:string[]) {
  try{localStorage.setItem(IMAGE_SWATCHES_KEY,JSON.stringify(next));}catch{/* Swatches stay for this session when storage is unavailable. */}
  window.dispatchEvent(new CustomEvent(SWATCHES_CHANGED,{detail:next}));
}
/** The Color panel and Color Picker add swatches too; an open Swatches panel shows them at once. */
export function addImageSwatch(color:string) {
  const saved=readSwatches(),hex=color.toLowerCase();
  if(isHex(hex)&&saved.length<MAX_SWATCHES&&!saved.includes(hex))storeSwatches([...saved,hex]);
}

export function PhotoSwatches({foreground,disabled,choose}:{foreground:string;disabled:boolean;choose:(key:"foreground"|"background",color:string)=>void}) {
  const [saved,setSaved]=useState(readSwatches);
  useEffect(()=>{const sync=(event:Event)=>setSaved((event as CustomEvent<string[]>).detail);window.addEventListener(SWATCHES_CHANGED,sync);return()=>window.removeEventListener(SWATCHES_CHANGED,sync);},[]);
  const store=storeSwatches;
  return <>
    <div className="xd-photo-swatches" role="group" aria-label="Swatches">{[...DEFAULT_SWATCHES,...saved].map((color,index)=>{const custom=index-DEFAULT_SWATCHES.length;return <button key={`${index}/${color}`} disabled={disabled} aria-label={`Swatch ${color}`} title={`${color} · Click: foreground · ⌘/Ctrl-click: background${custom>=0?" · Alt-click: remove":""}`} onClick={event=>{if(custom>=0&&event.altKey)store(saved.filter((_,item)=>item!==custom));else choose(event.metaKey||event.ctrlKey?"background":"foreground",color);}}><span style={{background:color}}/></button>;})}</div>
    <button disabled={disabled||!isHex(foreground)||saved.length>=MAX_SWATCHES||saved.includes(foreground)} onClick={()=>store([...saved,foreground])}>Add foreground to swatches</button>
  </>;
}
