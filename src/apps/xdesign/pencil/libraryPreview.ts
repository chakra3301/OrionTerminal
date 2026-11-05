import { renderDesignNodes } from "./proceduralPaints";
import { SkiaRenderer } from "@open-pencil/core/canvas";
import { computeContentBounds } from "@open-pencil/core/io";
import type { CanvasKit } from "canvaskit-wasm";
import { deserializeGraph } from "./document";
import type { LibraryUpdateReview } from "./librarySession";

export function libraryPreviewChoices(review:LibraryUpdateReview):{id:string;name:string}[] {
  const graph=deserializeGraph(review.originalGraph);
  return [...graph.nodes.values()].filter(node=>{if(node.type!=="INSTANCE")return false;let definition=graph.getNode(node.componentId??"");while(definition){if(definition.librarySource)return definition.librarySource.identity.libraryId===review.libraryId;definition=definition.parentId?graph.getNode(definition.parentId):undefined;}return false;}).map(node=>({id:node.id,name:node.name}));
}
export async function renderLibraryPreview(review:LibraryUpdateReview,id:string,ck:CanvasKit):Promise<{before:string;after:string;beforeSize:string;afterSize:string}> {
  const renderer=new SkiaRenderer(ck,ck.MakeSurface(64,64)!);
  const render=(source:string)=>{
    const graph=deserializeGraph(source),node=graph.getNode(id);if(!node)throw new Error("This instance is unavailable in the reviewed update");
    let page=node;while(page.parentId&&page.type!=="CANVAS")page=graph.getNode(page.parentId)!;
    const bounds=computeContentBounds(graph,[id]);if(!bounds||(bounds.maxX-bounds.minX)<=0||(bounds.maxY-bounds.minY)<=0)throw new Error("This instance has no visible preview");
    renderer.invalidateAllPictures();const bytes=renderDesignNodes(ck,renderer,graph,page.id,[id],{format:"PNG",scale:Math.min(1,384/Math.max((bounds.maxX-bounds.minX),(bounds.maxY-bounds.minY)))});if(!bytes)throw new Error("The component preview could not render");
    let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return {url:`data:image/png;base64,${btoa(binary)}`,size:`${Math.round(node.width)} × ${Math.round(node.height)}`};
  };
  try{await renderer.loadFonts();const before=render(review.originalGraph),after=render(review.updatedGraph);return {before:before.url,after:after.url,beforeSize:before.size,afterSize:after.size};}finally{renderer.destroy();}
}
