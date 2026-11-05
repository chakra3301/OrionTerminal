import { invoke, isTauri } from "@tauri-apps/api/core";
import { getIconData, iconToSVG } from "@iconify/utils";
import type { IconifyJSON } from "@iconify/types";
import { prepareSVGImport, type SVGImportData } from "@open-pencil/core/io/formats/svg";

export type PhotoProvider = "pexels" | "unsplash";
export type StockPhoto = {sourceId:string;url:string;thumbnail:string;width:number;height:number;photographer:string;page:string;artist:string;provider:PhotoProvider};
export type AssetCredit = {provider:string;sourceId:string;source:string;author?:string;authorURL?:string;license?:string;licenseURL?:string};
export type CachedIcon = {name:string;body:string;width:number;height:number;credit:AssetCredit};
const cache = new Map<string,CachedIcon>(); let cacheBytes=0;
const MAX_CACHE=8*1024*1024;
export const keyRef=(provider:PhotoProvider)=>`xdesign-stock-${provider}`;
export function photoProvider(value:unknown):PhotoProvider {if(value!=="pexels"&&value!=="unsplash")throw new Error("Choose Pexels or Unsplash.");return value;}
export function iconName(value:unknown):string {if(typeof value!=="string"||value.length>257||!/^[-a-z0-9]+:[-a-z0-9]+$/.test(value)||value.split(":").some(part=>part.length>128))throw new Error("Use an icon name such as lucide:heart.");return value;}
export function assetQuery(value:unknown):string {if(typeof value!=="string"||!value.trim()||new TextEncoder().encode(value).length>512||/[\x00-\x1f\x7f]/.test(value))throw new Error("Enter a search query up to 512 bytes.");return value.trim();}
export function numeric(value:unknown,min:number,max:number,fallback:number):number {const number=value===undefined?fallback:Number(value);if(!Number.isFinite(number)||number<min||number>max)throw new Error(`Choose a value from ${min} to ${max}.`);return number;}
export function assetLink(value:unknown):string {if(typeof value!=="string"||value.length>4096)throw new Error("Invalid asset link.");const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password)throw new Error("Invalid asset link.");return url.href;}
export async function assetInvoke<T>(command:string,args:Record<string,unknown>,signal?:AbortSignal):Promise<T> {
  if(!isTauri())throw new Error("Open XDesign in Orion Terminal desktop to use online resources.");
  if(signal?.aborted)throw new Error("Asset request cancelled.");
  return new Promise((resolve,reject)=>{
    let finished=false;
    const end=(error?:unknown,value?:T)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener("abort",abort);if(error)reject(error);else resolve(value!);};
    const abort=()=>end(new Error("Asset request cancelled."));const timer=setTimeout(()=>end(new Error("The asset request timed out.")),30_000);
    signal?.addEventListener("abort",abort,{once:true});void invoke<T>(command,args).then(value=>end(undefined,value),error=>end(error));
  });
}
const request=<T>(request:Record<string,unknown>,signal?:AbortSignal)=>assetInvoke<T>("xdesign_asset_request",{request},signal);
export async function connectionStatus():Promise<Record<PhotoProvider,boolean>> {const status=await Promise.all(["pexels","unsplash"].map(provider=>assetInvoke<boolean>("provider_key_status",{keyRef:keyRef(provider as PhotoProvider)})));return{pexels:status[0]!,unsplash:status[1]!};}
export async function setConnection(provider:PhotoProvider,key:string):Promise<void> {photoProvider(provider);if(!key.trim()||key.length>4096||/[\r\n\x00]/.test(key))throw new Error("Enter a valid provider key.");await assetInvoke("provider_key_set",{keyRef:keyRef(provider),key:key.trim()});}
export async function clearConnection(provider:PhotoProvider):Promise<void> {photoProvider(provider);await assetInvoke("provider_key_clear",{keyRef:keyRef(provider)});}
export function activeStockProvider():PhotoProvider {try{return photoProvider(localStorage.getItem("orion.xdesign.stock-provider")??"pexels");}catch{return"pexels";}}
export function chooseStockProvider(provider:PhotoProvider):void {localStorage.setItem("orion.xdesign.stock-provider",photoProvider(provider));}
export function clearAssetCache():void {cache.clear();cacheBytes=0;}
function remember(icon:CachedIcon):void {const prior=cache.get(icon.name);if(prior){cacheBytes-=prior.body.length;cache.delete(icon.name);}cache.set(icon.name,icon);cacheBytes+=icon.body.length;while(cache.size>500||cacheBytes>MAX_CACHE){const name=cache.keys().next().value!;cacheBytes-=cache.get(name)!.body.length;cache.delete(name);}}
function safeBody(body:unknown):string {
  if(typeof body!=="string"||body.length>128*1024||/<!(?:DOCTYPE|ENTITY)|\bon[a-z]+\s*=|\b(?:href|src)\s*=|javascript:/i.test(body)||/url\s*\(/i.test(body.replace(/url\(#[\w-]+\)/g,"")))throw new Error("Unsupported icon SVG content.");
  for(const match of body.matchAll(/<\/?([\w:-]+)/g))if(!["svg","g","path","circle","ellipse","rect","line","polygon","polyline","defs","clipPath","title","desc","linearGradient","radialGradient","stop"].includes(match[1]!))throw new Error("Unsupported icon SVG element.");
  return body;
}
export async function searchIcons(queries:string[],limit=5,prefix?:string,signal?:AbortSignal):Promise<Record<string,{icons:string[];total:number;collections:unknown}>> {
  if(!Array.isArray(queries)||!queries.length||queries.length>16)throw new Error("Search 1–16 icon queries.");numeric(limit,1,100,5);if(prefix&&!/^[-a-z0-9]{1,128}$/.test(prefix))throw new Error("Invalid icon set.");
  const result:Record<string,{icons:string[];total:number;collections:unknown}>=Object.create(null);
  for(const query of [...new Set(queries)]){const data=await request<{icons:unknown[];total:number;collections:unknown}>({kind:"iconSearch",query:assetQuery(query),limit,prefix:prefix||null},signal);if(!Array.isArray(data.icons)||!Number.isFinite(data.total)||data.total<0)throw new Error("Invalid icon search response.");result[query]={icons:data.icons.slice(0,limit).map(iconName),total:data.total,collections:data.collections};}
  return result;
}
export async function fetchIcons(names:string[],signal?:AbortSignal):Promise<Map<string,CachedIcon>> {
  if(!Array.isArray(names)||!names.length||names.length>64)throw new Error("Fetch 1–64 icons.");const groups=new Map<string,string[]>(),result=new Map<string,CachedIcon>();
  for(const name of [...new Set(names.map(iconName))]){const known=cache.get(name);if(known){remember(known);result.set(name,known);continue;}const[prefix,short]=name.split(":");groups.set(prefix!,[...groups.get(prefix!)??[],short!]);}
  for(const[prefix,shorts]of groups){
    const raw=await request<IconifyJSON>({kind:"iconCollection",prefix,names:shorts},signal);if(raw.prefix!==prefix||!raw.icons||typeof raw.icons!=="object")throw new Error("Invalid icon collection response.");
    let info:Record<string,any>={};try{const reply=await request<{info?:Record<string,any>}>({kind:"iconInfo",prefix},signal);info=reply.info??{};}catch(error){if(signal?.aborted)throw error;}
    for(const short of shorts){if(!Object.hasOwn(raw.icons,short)&&!Object.hasOwn(raw.aliases??{},short))continue;const data=getIconData(raw,short);if(!data)continue;safeBody(data.body);const svg=iconToSVG(data);const width=svg.viewBox[2],height=svg.viewBox[3];if(![width,height].every(n=>Number.isFinite(n)&&n>0&&n<=16384))throw new Error("Invalid icon dimensions.");
      const name=`${prefix}:${short}`,credit:AssetCredit={provider:"Iconify",sourceId:name,source:`https://icon-sets.iconify.design/${prefix}/${short}/`};
      if(typeof info.author?.name==="string")credit.author=info.author.name.slice(0,512);if(typeof info.license?.title==="string")credit.license=info.license.title.slice(0,512);if(info.author?.url)try{credit.authorURL=assetLink(info.author.url);}catch{}if(info.license?.url)try{credit.licenseURL=assetLink(info.license.url);}catch{}
      const icon={name,body:safeBody(svg.body),width,height,credit};remember(icon);result.set(name,icon);
    }
  }
  return result;
}
export function iconPaths(icon:CachedIcon,size:number,color="#000000"):SVGImportData|null {numeric(size,1,4096,24);const paths=prepareSVGImport(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${icon.width} ${icon.height}">${icon.body}</svg>`,{defaultColor:color});if(!paths||!paths.paths.length)return null;if(paths.paths.length>512||paths.paths.some(path=>path.vectorNetwork.vertices.length>32768||path.vectorNetwork.segments.length>32768))throw new Error("This icon exceeds the vector import limit.");return paths;}
export function iconPreview(icon:CachedIcon):string {return`data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width} ${icon.height}">${icon.body}</svg>`)}`;}
export async function searchPhotos(provider:PhotoProvider,query:string,orientation="landscape",targetDim=1080,perPage=15,signal?:AbortSignal):Promise<StockPhoto[]> {
  photoProvider(provider);assetQuery(query);numeric(targetDim,1,16384,1080);numeric(perPage,1,30,15);if(!["landscape","portrait","square"].includes(orientation))throw new Error("Choose a photo orientation.");
  const data=await request<{photos:StockPhoto[]}>({kind:"photos",provider,query,orientation,per_page:perPage,target_dim:Math.ceil(targetDim)},signal);if(!Array.isArray(data.photos)||data.photos.length>30)throw new Error("Invalid stock photo response.");
  return data.photos.map(photo=>{if(photo.provider!==provider||typeof photo.sourceId!=="string"||!/^[-\w]{1,128}$/.test(photo.sourceId)||typeof photo.photographer!=="string"||photo.photographer.length>512||![photo.width,photo.height].every(n=>Number.isFinite(n)&&n>0&&n<=100000))throw new Error("Invalid stock photo metadata.");return{...photo,url:assetLink(photo.url),thumbnail:assetLink(photo.thumbnail),page:assetLink(photo.page),artist:assetLink(photo.artist)};});
}
export async function downloadStockPhoto(photo:StockPhoto,signal?:AbortSignal):Promise<{bytes:Uint8Array;width:number;height:number}> {
  const image=await assetInvoke<{base64:string;width:number;height:number}>("xdesign_stock_image",{provider:photoProvider(photo.provider),url:assetLink(photo.url)},signal);
  if(typeof image.base64!=="string"||image.base64.length>Math.ceil(16*1024*1024/3)*4||![image.width,image.height].every(n=>Number.isInteger(n)&&n>0)||image.width*image.height>16_777_216)throw new Error("Invalid or oversized stock image.");return{bytes:Uint8Array.from(atob(image.base64),char=>char.charCodeAt(0)),width:image.width,height:image.height};
}
export async function notifyStockDownload(photo:StockPhoto,signal?:AbortSignal):Promise<void> {if(photo.provider==="unsplash")await request({kind:"photoDownload",source_id:photo.sourceId},signal);}
export function photoCredit(photo:StockPhoto):AssetCredit {return{provider:photo.provider,sourceId:photo.sourceId,source:photo.page,author:photo.photographer,authorURL:photo.artist};}
