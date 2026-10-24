import type { Editor } from "@open-pencil/core/editor";
import { trackXDesignActivity } from "../runtimeActivity";
import { withPencilTask, persistPencil, assertPencilEditable, pencilCanvasPoint } from "./runtime";
import { withClipboardVideoResources } from './videoClipboard';

let copied:Awaited<ReturnType<Editor["prepareCopy"]>>|null=null;
export async function copyPencilSelection(editor:Editor,cut=false):Promise<void> {
  if(cut)assertPencilEditable();
  return withPencilTask(()=>trackXDesignActivity("canvas-image-import","Wait for clipboard preparation before changing projects.",async()=>{
    const ids=[...editor.state.selectedIds];const payload=await editor.prepareCopy();if(!payload.html)return;
    withClipboardVideoResources(editor.graph,payload);
    if(navigator.clipboard?.write&&typeof ClipboardItem!=="undefined")await navigator.clipboard.write([new ClipboardItem({"text/html":new Blob([payload.html],{type:"text/html"}),"text/plain":new Blob([payload.plainText],{type:"text/plain"})})]);
    else await navigator.clipboard.writeText(payload.plainText);
    copied=payload;if(cut){editor.select(ids);editor.deleteSelected();}
  }));
}
export async function pastePencilData(editor:Editor,data:{html:string;text:string;files:File[]}):Promise<void> {
  assertPencilEditable();
  return withPencilTask(()=>trackXDesignActivity("canvas-image-import","Wait for clipboard import before changing projects.",async()=>{
    editor.undo.beginBatch("Paste");
    let rolledBack=false;
    try {
    if(data.files.length){const at=pencilCanvasPoint()??{x:100,y:100};await editor.placeFiles(data.files,at.x,at.y);return;}
    if(data.html&&copied?.snapshot&&data.html===copied.html){await editor.pasteSnapshot(copied.snapshot);return;}
    if(data.html){await editor.pasteFromHTML(data.html);return;}
    if(copied?.snapshot&&data.text===copied.plainText){await editor.pasteSnapshot(copied.snapshot);return;}
    if(data.text){const id=editor.createShape("TEXT",100,100,300,80);editor.updateNodeWithUndo(id,{text:data.text,fontFamily:"Inter"});await editor.loadFontsForNodes([id]);}
    } catch(error){rolledBack=true;editor.undo.rollbackBatch();throw error;}
    finally{if(!rolledBack)editor.undo.commitBatch();persistPencil();}
  }));
}
export function clearPencilClipboard():void {copied=null;}
