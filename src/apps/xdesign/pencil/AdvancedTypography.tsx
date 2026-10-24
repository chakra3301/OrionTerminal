import { useState } from "react";
import type { SceneNode } from "@open-pencil/scene-graph";
import { usePencilWorkspace } from "./runtime";
import { NumericValue } from "./AppearancePanel";
import { OptionalNumber } from "./LayoutChildPanel";

const FEATURES:Record<string,string>={liga:"Standard ligatures",clig:"Contextual ligatures",dlig:"Discretionary ligatures",calt:"Contextual alternates",kern:"Kerning",tnum:"Tabular numbers",pnum:"Proportional numbers",lnum:"Lining numbers",onum:"Oldstyle numbers",frac:"Fractions",zero:"Slashed zero",smcp:"Small capitals",c2sc:"Capitals to small capitals",ss01:"Stylistic set 1",ss02:"Stylistic set 2"};
export function AdvancedTypography({node}:{node:SceneNode}) {
  const editor=usePencilWorkspace(state=>state.editor)!;
  const [axis,setAxis]=useState("wght"),[feature,setFeature]=useState("liga");
  const update=(changes:Partial<SceneNode>)=>editor.updateNodeWithUndo(node.id,changes,"Change advanced typography");
  return <details className="xd-pencil-property-card"><summary>Advanced typography</summary>
    <OptionalNumber label="Line height" value={node.lineHeight} min={1} onCommit={lineHeight=>update({lineHeight})}/>
    <label>Language<input aria-label="Text language" key={node.textLanguage??""} defaultValue={node.textLanguage??""} placeholder="Auto · en, ar, ja…" onBlur={event=>update({textLanguage:event.target.value.trim()||null})}/></label>
    <label>Leading trim<select aria-label="Leading trim" value={node.leadingTrim} onChange={event=>update({leadingTrim:event.target.value as SceneNode["leadingTrim"]})}>{["NONE","CAP_HEIGHT"].map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Truncation<select aria-label="Text truncation" value={node.textTruncation} onChange={event=>update({textTruncation:event.target.value as SceneNode["textTruncation"]})}>{["DISABLED","ENDING"].map(value=><option key={value}>{value}</option>)}</select></label>
    <OptionalNumber label="Maximum lines" value={node.maxLines} min={1} onCommit={maxLines=>{if(maxLines===null||Number.isInteger(maxLines))update({maxLines});}}/>
    {node.textDecoration!=="NONE"&&<><label>Decoration style<select aria-label="Decoration style" value={node.textDecorationStyle} onChange={event=>update({textDecorationStyle:event.target.value as SceneNode["textDecorationStyle"]})}>{["SOLID","DOTTED","WAVY"].map(value=><option key={value}>{value}</option>)}</select></label><OptionalNumber label="Decoration thickness" value={node.textDecorationThickness} onCommit={textDecorationThickness=>update({textDecorationThickness})}/><OptionalNumber label="Underline offset" min={-10000} value={node.textUnderlineOffset} onCommit={textUnderlineOffset=>update({textUnderlineOffset})}/><label><input aria-label="Skip ink" type="checkbox" checked={node.textDecorationSkipInk} onChange={event=>update({textDecorationSkipInk:event.target.checked})}/>Skip ink</label></>}
    <h3>OpenType features</h3>{node.fontFeatures.map((entry,index)=><div className="xd-pencil-track" key={entry.tag}><label><input aria-label={`Feature ${entry.tag}`} type="checkbox" checked={entry.enabled} onChange={event=>update({fontFeatures:node.fontFeatures.map((current,i)=>i===index?{...current,enabled:event.target.checked}:current)})}/>{FEATURES[entry.tag]??entry.tag}</label><button aria-label={`Remove feature ${entry.tag}`} onClick={()=>update({fontFeatures:node.fontFeatures.filter((_,i)=>i!==index)})}>×</button></div>)}
    <label>Feature tag<input aria-label="OpenType feature tag" list="xd-font-feature-tags" value={feature} maxLength={4} onChange={event=>setFeature(event.target.value)}/><datalist id="xd-font-feature-tags">{Object.entries(FEATURES).map(([tag,label])=><option key={tag} value={tag}>{label}</option>)}</datalist></label><button disabled={!/^[a-zA-Z0-9]{4}$/.test(feature)||node.fontFeatures.some(entry=>entry.tag===feature)} onClick={()=>update({fontFeatures:[...node.fontFeatures,{tag:feature,enabled:true}]})}>Add font feature</button>
    <h3>Variable font axes</h3>{node.fontVariations.map((entry,index)=><div className="xd-pencil-track" key={entry.axis}><NumericValue label={`Axis ${entry.axis}`} min={-100000} value={entry.value} onCommit={value=>update({fontVariations:node.fontVariations.map((current,i)=>i===index?{...current,value}:current)})}/><button aria-label={`Remove axis ${entry.axis}`} onClick={()=>update({fontVariations:node.fontVariations.filter((_,i)=>i!==index)})}>×</button></div>)}
    <label>Axis tag<input aria-label="Variable font axis tag" value={axis} maxLength={4} onChange={event=>setAxis(event.target.value)}/></label><button disabled={!/^[a-zA-Z0-9]{4}$/.test(axis)||node.fontVariations.some(entry=>entry.axis===axis)} onClick={()=>update({fontVariations:[...node.fontVariations,{axis,value:axis==="wght"?node.fontWeight:axis==="wdth"?100:axis==="opsz"?node.fontSize:0}]})}>Add font axis</button>
    <p className="xd-pencil-section-help">Features and axes apply when the chosen font supports them.</p>
  </details>;
}
