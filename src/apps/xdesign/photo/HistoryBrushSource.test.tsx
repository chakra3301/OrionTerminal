import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryBrushSource, historyBrushSource } from "./HistoryBrushSource";
import type { PhotoHistorySource } from "./types";
let root:Root,container:HTMLDivElement;
const sources:PhotoHistorySource[]=[{id:"open",index:0,label:"Open",current:false,available:false,reason:"The target did not exist"},{id:"paint",index:1,label:"Brush Tool",current:true,available:true}];
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe("History Brush sources",()=>{
  it("keeps explicit snapshot identity across index shifts and refuses stale identities",()=>{expect(historyBrushSource(sources,null)).toBe(sources[0]);expect(historyBrushSource(sources,"paint")).toBe(sources[1]);expect(historyBrushSource([{...sources[1]!,index:0}],"paint")?.id).toBe("paint");expect(historyBrushSource(sources,"expired")).toBeUndefined();});
  it("disables absent targets, shows native reasons and requires a new choice after eviction",async()=>{
    const change=vi.fn();await act(async()=>root.render(<HistoryBrushSource sources={sources} selected={null} disabled={false} change={change}/>));let select=container.querySelector("select")!;expect(select.value).toBe("open");expect(select.options[0]!.disabled).toBe(true);expect(container.textContent).toContain("The target did not exist");
    await act(async()=>{select.value="paint";select.dispatchEvent(new Event("change",{bubbles:true}));});expect(change).toHaveBeenCalledWith("paint");await act(async()=>root.render(<HistoryBrushSource sources={sources} selected="expired" disabled={false} change={change}/>));select=container.querySelector("select")!;expect(select.value).toBe("expired");expect(container.textContent).toContain("no longer retained");expect(change).toHaveBeenCalledOnce();
    await act(async()=>root.render(<HistoryBrushSource sources={sources} selected="paint" disabled={true} change={change}/>));expect(container.querySelector("select")!.disabled).toBe(true);await act(async()=>root.render(<HistoryBrushSource sources={[]} selected={null} disabled={false} change={change}/>));expect(container.querySelector("select")!.disabled).toBe(true);expect(container.textContent).toContain("No history sources available");
  });
});
