import type { SceneNode } from "@open-pencil/scene-graph";
import type { AssetCredit } from "./assetService";

export function assetCredits(node:SceneNode):AssetCredit[] {
  const entry=node.pluginData.find(item=>item.pluginId==="orion.xdesign.asset"&&item.key==="source");if(!entry||entry.value.length>8192)return[];
  try{
    const value=JSON.parse(entry.value);for(const key of ["provider","sourceId"])if(typeof value[key]!=="string"||!value[key]||value[key].length>512)return[];
    for(const key of ["author","license"])if(value[key]!==undefined&&(typeof value[key]!=="string"||value[key].length>512))return[];
    for(const key of ["source","authorURL","licenseURL"]){if(key!=="source"&&value[key]===undefined)continue;if(typeof value[key]!=="string"||value[key].length>4096)return[];const url=new URL(value[key]);if(url.protocol!=="https:"||url.username||url.password)return[];}
    return[value];
  }catch{return[];}
}
