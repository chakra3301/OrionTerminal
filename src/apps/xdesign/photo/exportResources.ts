import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { useXDesign } from "../store";
import { useXDProjects } from "../projectsStore";

export async function fullResolutionPhotoPath(photoId:string):Promise<string> {
  const projectId=useXDProjects.getState().activeId;
  const doc=useXDesign.getState().photoDocuments[photoId];
  if(!projectId||!doc||!isTauri())throw new Error("Open the image in Orion Terminal before exporting its full resolution");
  return invoke<string>("xdesign_photo_render",{projectId,photoId,version:doc.version});
}
export async function resolvePhotoExportImages(svg:string):Promise<string> {
  const parsed=new DOMParser().parseFromString(svg,"image/svg+xml");
  const cache=new Map<string,string>();
  for(const image of parsed.querySelectorAll("image[data-photo-document]")){
    const id=image.getAttribute("data-photo-document")!;
    let path=cache.get(id);if(!path){path=await fullResolutionPhotoPath(id);cache.set(id,path);}
    image.setAttribute("href",convertFileSrc(path));image.removeAttribute("data-photo-document");
  }
  return new XMLSerializer().serializeToString(parsed.documentElement);
}
