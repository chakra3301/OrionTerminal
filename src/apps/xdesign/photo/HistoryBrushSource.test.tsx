import { describe, expect, it } from "vitest";
import { historyBrushSource } from "./HistoryBrushSource";
import type { PhotoHistorySource } from "./types";
const sources:PhotoHistorySource[]=[{id:"open",index:0,label:"Open",current:false,available:false,reason:"The target did not exist"},{id:"paint",index:1,label:"Brush Tool",current:true,available:true}];
describe("History Brush sources",()=>{
  it("keeps explicit snapshot identity across index shifts and refuses stale identities",()=>{expect(historyBrushSource(sources,null)).toBe(sources[0]);expect(historyBrushSource(sources,"paint")).toBe(sources[1]);expect(historyBrushSource([{...sources[1]!,index:0}],"paint")?.id).toBe("paint");expect(historyBrushSource(sources,"expired")).toBeUndefined();});
});
