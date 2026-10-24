type Schema={type?:string;enum?:unknown[];properties?:Record<string,Schema>;anyOf?:Schema[];minimum?:number;maximum?:number;description?:string;default?:unknown};
export type ActionField={key:string;kind:"string"|"number"|"boolean"|"color"|"enum";options?:string[];min?:number;max?:number;hint?:string};
const forbidden=new Set(["__proto__","constructor","prototype"]);
export function schemaFields(input:unknown):ActionField[] {
  if(!input||typeof input!=="object")return [];
  return Object.entries((input as Schema).properties??{}).flatMap<ActionField>(([key,original])=>{
    if(forbidden.has(key))return [];
    const schema=original.anyOf?.find(s=>s.type==="number")??original;
    const options=schema.enum?.filter((v):v is string=>typeof v==="string");
    const hint=schema.description??original.description;
    if(options?.length)return [{key,kind:"enum" as const,options,hint}];
    if(["number","integer"].includes(schema.type??""))return [{key,kind:"number" as const,min:schema.minimum,max:schema.maximum,hint}];
    if(schema.type==="boolean")return [{key,kind:"boolean" as const,hint}];
    if(schema.type==="string")return [{key,kind:"string" as const,hint}];
    return [];
  });
}

/** Read only top-level fields in the engine's human-readable parameter notation. */
export function photoFields(spec:string):ActionField[] {
  const opening=spec.indexOf("{");if(opening<0)return [];
  const entries:string[]=[];let start=opening+1,depth=0,quoted=false,escaped=false;
  for(let i=start;i<spec.length;i++){
    const c=spec[i]!;
    if(escaped){escaped=false;continue;}if(c==="\\"&&quoted){escaped=true;continue;}if(c==='"'){quoted=!quoted;continue;}if(quoted)continue;
    if(c==="["||c==="{")depth++;if(c==="]")depth--;
    if(c==="}"&&depth>0){depth--;continue;}
    if(c===","&&depth===0){entries.push(spec.slice(start,i));start=i+1;}
    if(c==="}"&&depth===0){entries.push(spec.slice(start,i));break;}
  }
  return entries.flatMap<ActionField>(entry=>{
    const match=entry.trim().match(/^"([A-Za-z0-9_]+)"\s*:\s*(.*)$/);if(!match||forbidden.has(match[1]!))return [];
    const key=match[1]!,type=match[2]!;
    const options=type.match(/^"([^"#]+\|[^"#]+)"/)?.[1]?.split("|");
    if(options)return [{key,kind:"enum" as const,options}];
    if(type.startsWith('"#'))return [{key,kind:"color" as const}];
    if(type.startsWith("bool"))return [{key,kind:"boolean" as const}];
    const range=type.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)/);
    if(range)return [{key,kind:"number" as const,min:Number(range[1]),max:Number(range[2])}];
    if(/^(?:px|pt|ppi|deg|i32|u32|f32|f64|int|float|number|index|id)(?:[?= ]|$)/.test(type))return [{key,kind:"number" as const}];
    if(/^str(?:[?= ]|$)/.test(type)||type.startsWith('"'))return [{key,kind:"string" as const}];
    return [];
  });
}

export function ActionFields({fields,values,change,disabled=false}:{fields:ActionField[];values:Record<string,unknown>;change:(key:string,value:unknown)=>void;disabled?:boolean}) {
  const label=(key:string)=>key.replaceAll("_"," ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,v=>v.toUpperCase());
  return <div className="xd-action-fields">{fields.map(field=><label key={field.key} title={field.hint}><span>{label(field.key)}</span>{field.kind==="boolean"?<select disabled={disabled} value={values[field.key]===undefined?"":String(values[field.key])} onChange={e=>change(field.key,e.target.value===""?undefined:e.target.value==="true")}><option value="">Use default</option><option value="true">Yes</option><option value="false">No</option></select>:field.kind==="enum"?<select disabled={disabled} value={String(values[field.key]??"")} onChange={e=>change(field.key,e.target.value||undefined)}><option value="">Use default</option>{field.options?.map(v=><option key={v}>{v}</option>)}</select>:field.kind==="color"?<div><input type="color" disabled={disabled} value={String(values[field.key]??"#000000")} onChange={e=>change(field.key,e.target.value)}/><button type="button" disabled={disabled||values[field.key]===undefined} onClick={()=>change(field.key,undefined)}>Reset</button></div>:<input disabled={disabled} type={field.kind==="number"?"number":"text"} step={field.kind==="number"?"any":undefined} min={field.min} max={field.max} value={String(values[field.key]??"")} placeholder="Default" onChange={e=>change(field.key,e.target.value===""?undefined:field.kind==="number"?e.target.valueAsNumber:e.target.value)}/>}</label>)}</div>;
}
