import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoHistory } from "./PhotoHistory";
import type { PhotoState } from "./types";
const run=vi.hoisted(()=>vi.fn(()=>Promise.resolve(true)));
vi.mock("./runtime",()=>({runPhotoCommand:run}));
let root:Root,container:HTMLDivElement;
const src=(id:string,index:number,label:string,current=false,available=true)=>({id,index,label,current,available});
const make=(sources=[src("a",0,"Open"),src("b",1,"Blur",false,false),src("c",2,"Brush",true)],redo=["Fill"])=>({name:"Photo",historySources:sources,historyRedo:redo}) as unknown as PhotoState;
const show=(state:PhotoState,extra:Partial<Parameters<typeof PhotoHistory>[0]>={})=>act(async()=>root.render(<PhotoHistory state={state} disabled={false} contents={false} name="Portrait.jpg" preview="p.png" {...extra}/>));
const btn=(label:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].filter(b=>b.getAttribute("aria-label")===label);
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);run.mockClear();container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe("PhotoHistory",()=>{
  it("shows the opening snapshot with the document name and returns to it",async()=>{
    await show(make());const snap=container.querySelector<HTMLButtonElement>(".xd-photo-history-snapshot .xd-photo-layer-name")!;expect(snap.textContent).toBe("Portrait.jpg");expect(container.querySelector("hr")).toBeTruthy();
    await act(async()=>snap.click());expect(run).toHaveBeenCalledWith("history.select",{index:0});
  });
  it("disables the snapshot row when the opening state was evicted",async()=>{
    await show(make([src("b",0,"Blur"),src("c",1,"Brush",true)]));const snap=container.querySelector<HTMLButtonElement>(".xd-photo-history-snapshot .xd-photo-layer-name")!;expect(snap.disabled).toBe(true);expect(snap.title).toContain("no longer retained");
  });
  it("sets the History Brush source from enabled source boxes only and marks the chosen one",async()=>{
    const choose=vi.fn();await show(make(),{source:"c",chooseSource:choose});const boxes=btn("Sets the source for the history brush");
    expect(boxes.map(b=>b.disabled)).toEqual([false,false,true,false]);expect(boxes.map(b=>!!b.querySelector("svg"))).toEqual([false,false,false,true]);
    await act(async()=>boxes[1]!.click());expect(choose).toHaveBeenCalledWith("a");await act(async()=>boxes[2]!.click());expect(choose).toHaveBeenCalledOnce();
    await show(make(),{source:null,chooseSource:choose});expect(btn("Sets the source for the history brush")[0]!.querySelector("svg")).toBeTruthy();
  });
  it("keeps redo states greyed and shows the three footer buttons disabled with Photoshop tooltips",async()=>{
    await show(make());expect(container.querySelector(".xd-photo-history-redo")?.textContent).toBe("Fill");
    for(const tip of ["Create new document from current state","Create new snapshot","Delete current state"]){const [b]=btn(tip);expect(b!.disabled).toBe(true);expect(b!.title).toBe(tip);}
  });
  it("keeps the smart-object and empty messages",async()=>{
    await show(make(),{contents:true});expect(container.textContent).toContain("smart-object contents");await show(make([],[]));expect(container.textContent).toContain("Reopen the image");
  });
});
