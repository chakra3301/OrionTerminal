import type { Editor } from '@open-pencil/core/editor';

/** Only viewport presentation omits the source control. Saved graph, exports,
 * and the private preview renderer retain it. Invalidate ancestor pictures so
 * transparent preview pixels reveal the real background instead of old art. */
export function hidePreviewSource(editor:Editor,nodeId:string) {
  const renderer=editor.renderer;if(!renderer)return()=>{};
  const render=renderer.renderFromEditorState,node=renderer.renderNode,destroy=renderer.destroy;
  let presenting=false,restored=false;
  renderer.renderFromEditorState=function(...args){const previous=presenting;presenting=args[6]!=='overlays';try{return render.apply(this,args);}finally{presenting=previous;}};
  renderer.renderNode=function(...args){if(presenting&&args[1]===editor.graph&&args[2]===nodeId)return;return node.apply(this,args);};
  const restore=(alive=true)=>{if(restored)return;restored=true;renderer.renderFromEditorState=render;renderer.renderNode=node;renderer.destroy=destroy;if(alive){renderer.invalidateAllPictures();editor.requestRender();}};
  renderer.destroy=function(){restore(false);return destroy.call(this);};
  renderer.invalidateAllPictures();editor.requestRender();return()=>restore();
}
export function canvasPreviewPosition(source:{x:number;y:number},privateRoot:{x:number;y:number},bounds:{minX:number;minY:number},viewport:{panX:number;panY:number;zoom:number}) {
  return {left:viewport.panX+(bounds.minX+source.x-privateRoot.x)*viewport.zoom,top:viewport.panY+(bounds.minY+source.y-privateRoot.y)*viewport.zoom,transform:`scale(${viewport.zoom})`,transformOrigin:'0 0'};
}
