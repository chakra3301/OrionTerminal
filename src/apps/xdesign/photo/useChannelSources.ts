import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useXDesign } from "../store";
import type { ChannelSource } from "./channelSources";
import type { PhotoDocument, PhotoState } from "./types";

/** Inspect immutable source versions without changing any image's active view. */
export function useChannelSources(document: PhotoDocument, current: PhotoState | null, projectId: string | null, sources: ChannelSource[]) {
  const registry = useXDesign(store => store.photoDocuments);
  const documents = Object.values({...registry, [document.id]:document}).filter(photo => photo.width === document.width && photo.height === document.height);
  const [loaded, setLoaded] = useState<Record<string, {state?:PhotoState;error?:string}>>({});
  const refs = [...new Map(sources.filter(source=>source.document).map(source=>[`${source.document!.photoId}/${source.document!.version}`, source.document!])).entries()];
  const key = JSON.stringify(refs);
  useEffect(()=>{
    let active=true;
    for(const [sourceKey, source] of JSON.parse(key) as typeof refs) {
      if(loaded[sourceKey] || !projectId)continue;
      void invoke<PhotoState>("xdesign_photo_source_inspect",{projectId,source}).then(state=>{if(active)setLoaded(values=>({...values,[sourceKey]:{state}}));}).catch(error=>{if(active)setLoaded(values=>({...values,[sourceKey]:{error:String(error)}}));});
    }
    return()=>{active=false;};
  },[key,projectId]);
  const resolve = (source:ChannelSource) => source.document ? loaded[`${source.document.photoId}/${source.document.version}`]?.state ?? null : current;
  const valid = (source:ChannelSource) => !source.document || registry[source.document.photoId]?.version === source.document.version;
  const error = refs.map(([key])=>loaded[key]?.error).find(Boolean) ?? null;
  return {documents,resolve,valid,error};
}
