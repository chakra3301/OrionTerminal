import { invoke, isTauri } from "@tauri-apps/api/core";
export type ImageCompactionOutcome={schemaVersion:number;status:"completed"|"failed";versions:number;converted:number;relinked:number;recovered:number;beforeBytes:number;afterBytes:number;error:string|null};
export type ImageStorageReport={files:number;bytes:number;physicalBytes?:number;versions:number;protectedVersions:number;reclaimedBytes:number;reclaimedFiles:number;notes:string[];compactionPending?:boolean;compaction?:ImageCompactionOutcome|null};
let initialized:Promise<void>|null=null;
/** Called before a project is opened. Native also refuses later collection. */
export function initializeImageStorage():Promise<void>{
  if(!isTauri())return Promise.resolve();
  return initialized??=invoke<ImageStorageReport>("xdesign_storage_startup").then(()=>{}).catch(()=>{});
}
export function imageStorageReport():Promise<ImageStorageReport|null>{return isTauri()?invoke("xdesign_storage_report"):Promise.resolve(null);}
export function scheduleImageCompaction(enabled:boolean):Promise<boolean>{if(!isTauri())return Promise.reject(new Error("Image history compaction is available in the Orion Terminal desktop app."));return invoke("xdesign_storage_schedule_compaction",{enabled});}
