import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { ListRestart, Plus, RemoveFormatting, Trash2 } from "lucide-react";
import { runPhotoCommand, usePhotoWorkspace } from "./runtime";
import { useDesignDialog } from "../useDesignDialog";
import { PhotoDialog } from "./photoDialog";
import { faceName } from "./CharacterPanel";
import { useFontFamilies } from "./fontFamilies";
import { rgbHex } from "./analysisTool";
import type { MenuEntry } from "../menuModel";
import type { PhotoPanels } from "./types";

type Kind="character"|"paragraph";
type Styles=PhotoPanels["textStyles"];
type Style={id:number;name:string};
type Store={selected:Record<Kind,number|null>;dialog:{kind:Kind;id:number}|null;set:(patch:Partial<Omit<Store,"set">>)=>void};
export const useTypeStyles=create<Store>(set=>({selected:{character:null,paragraph:null},dialog:null,set:patch=>set(patch)}));

const run=(command:string,params:Record<string,unknown>={})=>runPhotoCommand(command,params).catch(()=>undefined);
const verb=(kind:Kind,name:string)=>`type.${kind}Style.${name}`;
const TITLE={character:"Character",paragraph:"Paragraph"} as const;
/** The clicked style, else the one on the selected text. */
const chosenStyle=(kind:Kind,styles:Styles,selected:number|null)=>(styles[kind] as Style[]).find(style=>style.id===(selected??styles.current?.[kind]));
const overridden=(kind:Kind,styles:Styles)=>!!styles.current?.[kind==="character"?"characterOverride":"paragraphOverride"];
const choose=(kind:Kind,id:number)=>{const {selected,set}=useTypeStyles.getState();set({selected:{...selected,[kind]:id}});};
const openOptions=(kind:Kind,id:number)=>{choose(kind,id);useTypeStyles.getState().set({dialog:{kind,id}});};

export function TypeStylesPanel({kind,styles}:{kind:Kind;styles:Styles}) {
  const busy=usePhotoWorkspace(s=>s.busy),selected=useTypeStyles(s=>s.selected[kind]);
  const current=styles.current,currentId=current?.[kind]??null,override=overridden(kind,styles),chosen=chosenStyle(kind,styles,selected),title=TITLE[kind];
  return <div className="xd-photo-rows" role="group" aria-label={`${title} Styles`}>
    <ul>{(styles[kind] as Style[]).map(style=><li key={style.id} className={`xd-photo-row${style.id===chosen?.id?" selected":""}`}>
      <button className="xd-photo-row-name" aria-label={style.name} aria-current={style.id===currentId?"true":undefined} aria-pressed={style.id===chosen?.id} disabled={busy}
        onClick={event=>{choose(kind,style.id);if(current)void run(verb(kind,"apply"),{id:style.id,...(event.altKey?{clearOverrides:true}:{})});}}
        onDoubleClick={()=>{if(kind==="paragraph"||style.id!==0)openOptions(kind,style.id);}}>{style.name}{style.id===currentId&&override?"+":""}</button>
    </li>)}</ul>
    <div className="xd-photo-notes-bar">
      <button aria-label="Clear Override" title="Clear Override" disabled={busy||!override} onClick={()=>void run(verb(kind,"clearOverride"))}><RemoveFormatting size={14}/></button>
      <button aria-label={`Redefine ${title} Style by Merging Overrides`} title={`Redefine ${title} Style by Merging Overrides`} disabled={busy||!override||!chosen||kind==="character"&&chosen.id===0} onClick={()=>void run(verb(kind,"redefine"),{id:chosen!.id})}><ListRestart size={14}/></button>
      <button aria-label={`Create New ${title} Style`} title={`Create New ${title} Style`} disabled={busy} onClick={()=>void run(verb(kind,"new"))}><Plus size={14}/></button>
      <button aria-label={`Delete ${title} Style`} title={`Delete ${title} Style`} disabled={busy||!chosen||chosen.id===0} onClick={()=>void run(verb(kind,"delete"),{id:chosen!.id})}><Trash2 size={14}/></button>
    </div>
  </div>;
}

export function typeStylesPanelMenu(kind:Kind,styles:Styles,busy:boolean):MenuEntry[] {
  const chosen=chosenStyle(kind,styles,useTypeStyles.getState().selected[kind]),override=overridden(kind,styles),id=chosen?.id;
  const none=busy||!chosen,real=none||kind==="character"&&id===0;
  return [
    {label:`New ${TITLE[kind]} Style…`,disabled:busy,run:()=>void run(verb(kind,"new")).then(result=>{const created=(result as {id?:unknown}|undefined)?.id;if(typeof created==="number")openOptions(kind,created);})},
    {label:"Duplicate Style",disabled:real,run:()=>void run(verb(kind,"duplicate"),{id})},
    {label:"Delete Style",disabled:none||id===0,run:()=>void run(verb(kind,"delete"),{id})},
    {label:"Redefine Style",disabled:real||!override,run:()=>void run(verb(kind,"redefine"),{id})},
    {label:"Style Options…",disabled:real,run:()=>openOptions(kind,id!)},
    {label:"Clear Override",disabled:busy||!override,run:()=>void run(verb(kind,"clearOverride"))},
  ];
}

type Draft=Record<string,string|number|boolean>;
type Face={weight:number;italic:boolean};
const round=(value:unknown,scale=1)=>typeof value==="number"?Math.round(value*scale*100)/100:0;
const CAPS:Record<string,string>={Normal:"normal",AllCaps:"all",SmallCaps:"small"};
const characterDraft=(r:Record<string,unknown>):Draft=>({
  font:String(r.font_family??""),weight:round(r.weight),italic:r.italic===true,size:round(r.size_pt),leading:typeof r.leading_pt==="number"?round(r.leading_pt):"",
  kerning:String(r.kerning??"Metrics").toLowerCase(),tracking:round(r.tracking),caps:CAPS[String(r.caps)]??"normal",color:rgbHex((r.color as {c?:number[]}|undefined)?.c??[0,0,0]),
  underline:r.underline===true,strikethrough:r.strikethrough===true,fauxBold:r.faux_bold===true,fauxItalic:r.faux_italic===true,
  horizontalScale:round(r.horizontal_scale,100),verticalScale:round(r.vertical_scale,100),baselineShift:round(r.baseline_shift_pt),
});
const paragraphDraft=(p:Record<string,unknown>):Draft=>({
  align:String(p.align??"Left").replace(/^./,first=>first.toLowerCase()),startIndent:round(p.start_indent_pt),firstLineIndent:round(p.first_line_indent_pt),endIndent:round(p.end_indent_pt),
  spaceBefore:round(p.space_before_pt),spaceAfter:round(p.space_after_pt),hyphenate:p.hyphenate===true,
});
const PAGES={character:["Basic Character Formats","Advanced Character Formats"],paragraph:["Basic Character Formats","Advanced Character Formats","Indents and Spacing","Hyphenation"]} as const;
const ALIGN:[string,string][]=[["left","Left"],["center","Center"],["right","Right"],["justifyLeft","Justify Last Left"],["justifyCenter","Justify Last Centered"],["justifyRight","Justify Last Right"],["justifyAll","Justify All"]];

function StyleOptionsDialog({kind,style,resolved,close}:{kind:Kind;style:Style;resolved:{character:Record<string,unknown>;paragraph?:Record<string,unknown>};close:()=>void}) {
  const busy=usePhotoWorkspace(s=>s.busy),error=usePhotoWorkspace(s=>s.error),dialog=useDesignDialog<HTMLFormElement>(close,busy),fonts=useFontFamilies();
  const [initial]=useState<Draft>(()=>({...characterDraft(resolved.character),...(resolved.paragraph?paragraphDraft(resolved.paragraph):{})}));
  const [draft,setDraft]=useState(initial),[name,setName]=useState(style.name),[page,setPage]=useState<string>(PAGES[kind][0]);
  const [faces,setFaces]=useState<Face[]>([]),loaded=useRef("");
  const change=(key:string,value:string|number|boolean)=>setDraft(current=>({...current,[key]:value}));
  const family=String(draft.font);
  useEffect(()=>{
    if(!family||loaded.current===family)return;
    loaded.current=family;
    void runPhotoCommand("type.fonts",{family}).then(result=>{const list=(result as {faces?:Face[]}|undefined)?.faces;setFaces(Array.isArray(list)?list.filter(face=>typeof face.weight==="number"):[]);}).catch(()=>{loaded.current="";});
  },[family]);
  const face={weight:Number(draft.weight),italic:draft.italic===true},faceKey=(item:Face)=>`${item.weight}/${item.italic}`;
  const known=faces.some(item=>faceKey(item)===faceKey(face))?faces:[...faces,face];
  const submit=()=>{
    const attrs:Record<string,unknown>={};
    for(const [key,value] of Object.entries(draft)){
      if(value===initial[key])continue;
      if(value===""){if(key==="leading")attrs.leading="auto";continue;}
      attrs[key]=value;
    }
    const renamed=name.trim()&&name.trim()!==style.name?{name:name.trim()}:{};
    if(!Object.keys(attrs).length&&!("name" in renamed)){close();return;}
    void runPhotoCommand(verb(kind,"set"),{id:style.id,...renamed,attrs}).then(close,()=>{});
  };
  const number=(key:string,label:string,title:string,unit?:string)=><label className="xd-ps-dialog-field"><span>{title}:</span>
    <input type="number" step="any" aria-label={label} placeholder={key==="leading"?"(Auto)":undefined} value={draft[key] as number|string} onChange={event=>{const value=event.target.valueAsNumber;change(key,Number.isFinite(value)?value:"");}}/>{unit&&<span>{unit}</span>}</label>;
  const check=(key:string,label:string)=><label className="xd-ps-dialog-check"><input type="checkbox" aria-label={label} checked={draft[key]===true} onChange={event=>change(key,event.target.checked)}/>{label}</label>;
  const select=(key:string,label:string,title:string,options:[string,string][])=><label className="xd-ps-dialog-field"><span>{title}:</span>
    <select aria-label={label} value={String(draft[key])} onChange={event=>change(key,event.target.value)}>{options.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></label>;
  return <PhotoDialog dialog={dialog} title={`${TITLE[kind]} Style Options`} className="xd-photo-style-options" busy={busy} close={close} onSubmit={event=>{event.preventDefault();submit();}}>
    <label className="xd-ps-dialog-field"><span>Style Name:</span><input aria-label="Style name" disabled={kind==="paragraph"&&style.id===0} value={name} onChange={event=>setName(event.target.value)}/></label>
    <div className="xd-photo-style-pages">
      <nav aria-label="Style option categories">{PAGES[kind].map(title=><button key={title} type="button" aria-label={title} aria-pressed={page===title} onClick={()=>setPage(title)}>{title}</button>)}</nav>
      <div className="xd-ps-dialog-grid">
        {page==="Basic Character Formats"&&<>
          <label className="xd-ps-dialog-field"><span>Font Family:</span>{fonts.list}<input aria-label="Font family" list={fonts.listId} key={family} defaultValue={family}
            onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();event.currentTarget.blur();}}} onBlur={event=>{if(event.target.value&&event.target.value!==family)change("font",event.target.value);}}/></label>
          <label className="xd-ps-dialog-field"><span>Font Style:</span><select aria-label="Font style" value={faceKey(face)} onChange={event=>{const next=known.find(item=>faceKey(item)===event.target.value);if(next)setDraft(current=>({...current,weight:next.weight,italic:next.italic}));}}>
            {known.map(item=><option key={faceKey(item)} value={faceKey(item)}>{faceName(item)}</option>)}</select></label>
          {number("size","Size","Size","pt")}
          {number("leading","Leading","Leading","pt")}
          {select("kerning","Kerning","Kerning",[["metrics","Metrics"],["optical","Optical"],["off","0"]])}
          {number("tracking","Tracking","Tracking")}
          {select("caps","Case","Case",[["normal","Normal"],["all","All Caps"],["small","Small Caps"]])}
          <label className="xd-ps-dialog-field"><span>Color:</span><input type="color" aria-label="Color" value={String(draft.color)} onChange={event=>change("color",event.target.value)}/></label>
          {check("underline","Underline")}{check("strikethrough","Strikethrough")}{check("fauxBold","Faux Bold")}{check("fauxItalic","Faux Italic")}
        </>}
        {page==="Advanced Character Formats"&&<>{number("horizontalScale","Horizontal scale","Horizontal Scale","%")}{number("verticalScale","Vertical scale","Vertical Scale","%")}{number("baselineShift","Baseline shift","Baseline Shift","pt")}</>}
        {page==="Indents and Spacing"&&<>
          {select("align","Alignment","Alignment",ALIGN)}
          {number("startIndent","Left indent","Left Indent","pt")}{number("firstLineIndent","First line indent","First Line Indent","pt")}{number("endIndent","Right indent","Right Indent","pt")}
          {number("spaceBefore","Space before","Space Before","pt")}{number("spaceAfter","Space after","Space After","pt")}
        </>}
        {page==="Hyphenation"&&check("hyphenate","Hyphenate")}
      </div>
    </div>
    {error&&<p role="alert">{error}</p>}
  </PhotoDialog>;
}

/** Character / Paragraph Style Options, opened by double-clicking a style. */
export function TypeStyleDialogs({styles}:{styles:Styles|undefined}) {
  const dialog=useTypeStyles(s=>s.dialog),set=useTypeStyles(s=>s.set);
  if(!dialog||!styles)return null;
  const close=()=>set({dialog:null});
  if(dialog.kind==="character"){
    const style=styles.character.find(item=>item.id===dialog.id);
    return style?<StyleOptionsDialog key={`character/${style.id}`} kind="character" style={style} resolved={{character:style.resolved}} close={close}/>:null;
  }
  const style=styles.paragraph.find(item=>item.id===dialog.id);
  return style?<StyleOptionsDialog key={`paragraph/${style.id}`} kind="paragraph" style={style} resolved={style.resolved} close={close}/>:null;
}
