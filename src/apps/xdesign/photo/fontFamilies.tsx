import { useEffect, useId, useState, type ReactElement } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

let families:Promise<string[]>|null=null;
export function useFontFamilies():{listId:string;list:ReactElement} {
  const listId=useId(),[fonts,setFonts]=useState<string[]>([]);
  useEffect(()=>{
    if(!isTauri())return;
    let alive=true;families??=invoke<string[]>("xdesign_font_families");
    void families.then(names=>{if(alive)setFonts(names);}).catch(()=>{families=null;});
    return()=>{alive=false;};
  },[]);
  return {listId,list:<datalist id={listId}>{fonts.map(font=><option key={font} value={font}/>)}</datalist>};
}
