import type { PhotoHistorySource } from "./types";

export function historyBrushSource(sources:PhotoHistorySource[]|undefined,selected:string|null){return selected?sources?.find(source=>source.id===selected):sources?.[0];}
