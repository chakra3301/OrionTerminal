import { createApp, defineComponent, h, ref, watchEffect } from "vue";
import { useCanvas, useCanvasInput, useTextEdit, toolCursor } from "@open-pencil/vue";
import { usePhotoWorkspace } from "../photo/runtime";
import type { Editor } from "@open-pencil/core/editor";
import { editPencilImage, placePencilVideo, usePencilWorkspace } from "./runtime";
import { isVideoFile } from './videoPaints';
import { isDesignDialogOpen } from "../useDesignDialog";
import { installCanvasGrid } from "./canvasGrid";
import { installImageDoubleClick } from "./imageDoubleClick";
import { installViewerInput } from './viewerInput';
import { useCanvasView } from "./canvasView";

// Keep Orion's React shell and use upstream input/rendering behavior as one
// isolated component. Vue owns only this element and removes its listeners on unmount.
export function mountPencilCanvas(element:HTMLElement,editor:Editor,onReady:()=>void,onError:(error:unknown)=>void) {
  const available=()=>!isDesignDialogOpen()&&!usePhotoWorkspace.getState().shapeId&&!usePhotoWorkspace.getState().busy&&!usePencilWorkspace.getState().busy;
  const enabled=()=>available()&&!usePencilWorkspace.getState().readOnly;
  const removeViewerInput=installViewerInput(element,editor,()=>available()&&usePencilWorkspace.getState().readOnly);
  const restoreGrid=installCanvasGrid(editor,element,()=>useCanvasView.getState().grid);
  const stopView=useCanvasView.subscribe(()=>editor.requestRender());
  const dropVideo=(event:DragEvent)=>{
    const files=Array.from(event.dataTransfer?.files??[]);if(!files.some(isVideoFile))return;
    event.preventDefault();event.stopImmediatePropagation();if(!enabled())return;
    if(files.length!==1){usePencilWorkspace.setState({error:'Drop one video at a time, or import images separately.'});return;}
    void placePencilVideo(files[0]!).catch(error=>usePencilWorkspace.setState({error:String(error)}));
  };
  element.addEventListener('drop',dropVideo,true);
  const removeImageDoubleClick=installImageDoubleClick(element,editor,enabled,id=>{
    usePencilWorkspace.setState({error:null});return editPencilImage(id);
  },error=>usePencilWorkspace.setState({error:String(error)}));
  const app=createApp(defineComponent({setup(){
    const canvas=ref<HTMLCanvasElement|null>(null);
    // Read per frame, so Figma's Shift+R ruler toggle applies without remounting.
    const surface=useCanvas(canvas,editor,{get showRulers(){return useCanvasView.getState().rulers;},onReady,onViewportResize:()=>editor.requestRender()});
    const input=useCanvasInput(canvas,editor,surface.hitTestSectionTitle,surface.hitTestComponentLabel,surface.hitTestFrameTitle,undefined,undefined,enabled);
    useTextEdit(canvas,editor,{isEnabled:enabled});
    watchEffect(()=>{if(canvas.value)canvas.value.style.cursor=input.cursorOverride.value ?? toolCursor(editor.state.activeTool);});
    return()=>h("canvas",{ref:canvas,tabindex:0,"aria-label":"Design canvas",style:{width:"100%",height:"100%",display:"block",touchAction:"none"}});
  }}));
  app.config.errorHandler=onError;
  try { app.mount(element); } catch(error) { stopView();element.removeEventListener('drop',dropVideo,true);removeImageDoubleClick();removeViewerInput();restoreGrid();throw error; }
  return()=>{stopView();element.removeEventListener('drop',dropVideo,true);removeImageDoubleClick();removeViewerInput();app.unmount();restoreGrid();};
}
