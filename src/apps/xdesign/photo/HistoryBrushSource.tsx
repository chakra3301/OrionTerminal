import type { PhotoHistorySource } from "./types";

export function historyBrushSource(sources:PhotoHistorySource[]|undefined,selected:string|null){return selected?sources?.find(source=>source.id===selected):sources?.[0];}
export function HistoryBrushSource({sources,selected,disabled,change}:{sources:PhotoHistorySource[]|undefined;selected:string|null;disabled:boolean;change:(id:string)=>void}){
  const source=historyBrushSource(sources,selected),unavailable=!!selected&&!source;
  return <><label className="xd-photo-property">History source<select aria-label="History Brush source" disabled={disabled||!sources?.length} value={selected??source?.id??""} onChange={event=>change(event.target.value)}>
    {!sources?.length&&<option value="">No history sources available</option>}
    {unavailable&&<option value={selected!} disabled>Source unavailable — choose another</option>}
    {sources?.map(source=><option key={`${source.index}/${source.id}`} value={source.id} disabled={!source.available}>{source.index+1} · {source.label}{source.current?" (current)":""}{!source.available?" — target unavailable":""}</option>)}
  </select></label><p className="xd-photo-section-help">{unavailable?"This source is no longer retained. Choose another history state.":source&&!source.available?source.reason??"The paint target did not exist in this history state.":!sources?.length?"Reopen the image to load its available history sources.":"Paint from a saved image history state."}</p></>;
}
