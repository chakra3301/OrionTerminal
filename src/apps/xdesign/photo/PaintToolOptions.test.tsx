import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { PaintToolOptions, paintToolDefaults, rebaseBrushOptions, sanitizePaintOptions, strokeParameters, type PaintOptions } from "./PaintToolOptions";
import type { PhotoState } from "./types";
let root: Root, container: HTMLDivElement, values: PaintOptions;
let setHarnessOptions: ((value: PaintOptions | ((previous: PaintOptions) => PaintOptions)) => void) | undefined;
function Harness({tool,disabled=false}:{tool:string;disabled?:boolean}) {const [options,setOptions]=useState(paintToolDefaults(tool,null));values=options;setHarnessOptions=setOptions;return <PaintToolOptions tool={tool} values={options} disabled={disabled} change={setOptions}/>;}
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe("image tool controls and command units",()=>{
  it.each(["paint.cloneStamp","paint.healingBrush"])("edits independent %s source transforms and restores identity defaults",async tool=>{
    await act(async()=>root.render(<Harness tool={tool}/>));
    expect(values).toMatchObject({transformSource:false,sourceWidth:100,sourceHeight:100,rotation:0,flipH:false,flipV:false});
    expect(container.querySelector('[aria-label="Tool Source width (%)"]')).toBeNull();
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Transform source"]')!.click());
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;
    for(const [label,value] of [["Source width (%)",80],["Source height (%)",135],["Source rotation (°)",-27.5]] as const)await act(async()=>{const input=container.querySelector<HTMLInputElement>(`[aria-label="Tool ${label}"]`)!;setter.call(input,String(value));input.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Flip source horizontally"]')!.click());
    expect(values).toMatchObject({sourceWidth:80,sourceHeight:135,rotation:-27.5,flipH:true,flipV:false});
    await act(async()=>root.render(<Harness tool={tool} disabled/>));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Source width (%)"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Flip source horizontally"]')!.disabled).toBe(true);
    await act(async()=>root.render(<Harness tool={tool}/>));
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Transform source"]')!.click());
    expect(container.querySelector('[aria-label="Tool Source rotation (°)"]')).toBeNull();
    await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Tool Transform source"]')!.click());
    expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Source width (%)"]')!.value).toBe("80");
    await act(async()=>setHarnessOptions!(paintToolDefaults(tool,null)));
    expect(values).toMatchObject({transformSource:false,sourceWidth:100,sourceHeight:100,rotation:0,flipH:false,flipV:false});
    expect(container.querySelector('[aria-label="Tool Source width (%)"]')).toBeNull();
    await act(async()=>root.render(<Harness tool={tool} disabled/>));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Transform source"]')!.disabled).toBe(true);
  });
  it("sanitizes source bounds and native rotation wrapping without leaking transform preferences to other tools",()=>{
    const transform={sourceWidth:80,sourceHeight:135,rotation:387.5,flipH:true,flipV:false};
    for(const tool of ["paint.cloneStamp","paint.healingBrush"]){
      expect(sanitizePaintOptions(tool,transform)).toEqual({...transform,rotation:27.5});
      expect(sanitizePaintOptions(tool,{sourceWidth:0,sourceHeight:1001,rotation:Infinity,flipH:1,flipV:"true"})).toEqual({});
      expect(sanitizePaintOptions(tool,{sourceWidth:1,sourceHeight:1000,rotation:-540})).toEqual({sourceWidth:1,sourceHeight:1000,rotation:-180});
      const params=strokeParameters(tool,[[12,18,.4]],20,.6,.8,"#ff0000",1,42,{...transform,rotation:27.5,transformSource:true,aligned:false},false,[5,5],[-7,-13]);
      expect(params).toMatchObject({scale:[80,135],rotation:27.5,flipH:true,flipV:false,source:[5,5]});
      expect(params).not.toHaveProperty("transformSource");expect(params).not.toHaveProperty("sourceWidth");expect(params).not.toHaveProperty("sourceHeight");expect(params).not.toHaveProperty("offset");
      const legacy=strokeParameters(tool,[[12,18]],20,1,1,"#ff0000",1,null,{...paintToolDefaults(tool,null),aligned:true},false,[5,5],[-7,-13]);
      expect(legacy).toMatchObject({offset:[-7,-13]});for(const key of ["scale","rotation","flipH","flipV","transformSource"])expect(legacy).not.toHaveProperty(key);
      const off=strokeParameters(tool,[[12,18]],20,1,1,"#ff0000",1,null,{...transform,transformSource:false},false,[5,5],null);for(const key of ["scale","rotation","flipH","flipV","transformSource"])expect(off).not.toHaveProperty(key);
      expect(strokeParameters(tool,[[12,18]],20,1,1,"#ff0000",1,null,{...paintToolDefaults(tool,null),transformSource:true},false,[5,5],null)).toMatchObject({scale:[100,100],rotation:0,flipH:false,flipV:false});
    }
    for(const tool of ["paint.stroke","paint.spotHealing","paint.historyBrush"]){expect(sanitizePaintOptions(tool,transform)).toEqual({});expect(strokeParameters(tool,[[1,2]],20,1,1,"#ff0000",1,null,sanitizePaintOptions(tool,transform),false,null,null)).not.toHaveProperty("scale");}
  });

  it("puts each checkbox before its label, as Photoshop's options bar does",async()=>{await act(async()=>root.render(<Harness tool="crop"/>));const box=container.querySelector<HTMLInputElement>('[aria-label="Tool Delete Cropped Pixels"]')!;expect(box.parentElement!.firstChild).toBe(box);expect(box.parentElement!.textContent).toBe("Delete Cropped Pixels");});
  it("renders native History Brush blend labels without changing their command values",async()=>{await act(async()=>root.render(<Harness tool="paint.historyBrush"/>));const select=container.querySelector<HTMLSelectElement>('[aria-label="Tool Blend"]')!;expect(select.options[0]!.textContent).toBe("Normal");expect([...select.querySelectorAll("hr")].map(hr=>hr.nextElementSibling!.textContent)).toEqual(["Darken","Lighten","Overlay","Difference","Hue"]);expect([...select.options].find(option=>option.value==="Linear Dodge (Add)")?.textContent).toBe("Linear Dodge (Add)");});
  it("edits dodge tone range/exposure and preserves protection independently",async()=>{
    await act(async()=>root.render(<Harness tool="paint.dodge"/>));
    await act(async()=>{const element=container.querySelector<HTMLSelectElement>('[aria-label="Tool Range"]')!;element.value="highlights";element.dispatchEvent(new Event("change",{bubbles:true}));const protection=container.querySelector<HTMLInputElement>('[aria-label="Tool Protect tones"]')!;protection.click();});
    expect(values).toEqual({range:"highlights",exposure:50,protectTones:false,flow:100,spacing:25});
  });
  it("offers source and destination patch modes as native command values",async()=>{
    await act(async()=>root.render(<Harness tool="paint.patch"/>));
    const select=container.querySelector<HTMLSelectElement>('[aria-label="Tool Patch mode"]')!;
    expect(select.value).toBe("source");
    await act(async()=>{select.value="destination";select.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(values).toEqual({type:"normal",mode:"destination",diffusion:5,structure:4,colorAdaptation:0,sampleAllLayers:false});
    expect(sanitizePaintOptions("paint.patch",{mode:"invalid"})).toEqual({});
  });
  it("exposes pinned Magic and Background Eraser settings with their engine enums",async()=>{
    await act(async()=>root.render(<Harness tool="paint.magicEraser"/>));
    expect(values).toEqual({tolerance:32,opacity:100,antiAlias:true,contiguous:true,sampleAllLayers:false});
    const tolerance=container.querySelector<HTMLInputElement>('[aria-label="Tool Tolerance"]')!;
    await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;setter.call(tolerance,"72");tolerance.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(values.tolerance).toBe(72);
    await act(async()=>root.render(<Harness key="background-eraser" tool="paint.backgroundEraser"/>));
    expect(values).toEqual({sampling:"continuous",limits:"contiguous",tolerance:50,protectForegroundColor:false});
    const sampling=container.querySelector<HTMLSelectElement>('[aria-label="Tool Sampling"]')!;
    await act(async()=>{sampling.value="once";sampling.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(values.sampling).toBe("once");
  });
  it("keeps numeric drafts while replacing them and immediately publishes valid negative fractions",async()=>{
    await act(async()=>root.render(<Harness tool="paint.bucket"/>));
    await act(async()=>{const select=container.querySelector<HTMLSelectElement>('[aria-label="Tool Fill"]')!;select.value="pattern";select.dispatchEvent(new Event("change",{bubbles:true}));});
    const angle=container.querySelector<HTMLInputElement>('[aria-label="Tool Pattern angle"]')!;
    const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;
    await act(async()=>{setValue.call(angle,"");angle.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(angle.value).toBe("");expect(values.angle).toBe(0);
    await act(async()=>{setValue.call(angle,"-45.5");angle.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(values.angle).toBe(-45.5);expect(angle.value).toBe("-45.5");
  });
  it("restores invalid drafts and follows external values, disabled state, and tool changes",async()=>{
    await act(async()=>root.render(<Harness tool="paint.bucket"/>));
    await act(async()=>{const select=container.querySelector<HTMLSelectElement>('[aria-label="Tool Fill"]')!;select.value="pattern";select.dispatchEvent(new Event("change",{bubbles:true}));});
    const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;
    let angle=container.querySelector<HTMLInputElement>('[aria-label="Tool Pattern angle"]')!;
    await act(async()=>{setValue.call(angle,"361");angle.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(values.angle).toBe(0);await act(async()=>angle.dispatchEvent(new FocusEvent("focusout",{bubbles:true})));expect(angle.value).toBe("0");
    await act(async()=>setHarnessOptions!(current=>({...current,angle:27.25})));
    expect(angle.value).toBe("27.25");
    await act(async()=>{setValue.call(angle,"-");angle.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(angle.value).toBe("");expect(values.angle).toBe(27.25);
    await act(async()=>root.render(<Harness tool="paint.bucket" disabled/>));
    angle=container.querySelector<HTMLInputElement>('[aria-label="Tool Pattern angle"]')!;
    expect(angle.value).toBe("27.25");
    await act(async()=>root.render(<Harness key="other-tool" tool="paint.magicEraser"/>));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Tool Tolerance"]')!.value).toBe("32");
  });
  it("orders Mode, the lead Opacity and Flow like Photoshop's options bar, with popup sliders for percentages",async()=>{
    const change=vi.fn();
    await act(async()=>root.render(<PaintToolOptions tool="paint.stroke" values={paintToolDefaults("paint.stroke",null)} disabled={false} change={change} lead={<span data-lead>Opacity</span>}/>));
    expect([...container.querySelector(".xd-photo-paint-options")!.children].map(child=>child.firstChild?.textContent)).toEqual(["Mode","Opacity","Flow","Spacing (%)","Smoothing"]);
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Show flow slider"]')!.click());
    const range=container.querySelector<HTMLInputElement>('[aria-label="Tool Flow (%) slider"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(range,"40");range.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({flow:40}));
    await act(async()=>root.render(<PaintToolOptions tool="erase" values={paintToolDefaults("erase",null)} disabled={false} change={change} lead={<span data-lead>Opacity</span>}/>));
    expect(container.querySelector(".xd-photo-paint-options")!.children[1]!.hasAttribute("data-lead")).toBe(true);
  });
  it("normalizes or restores numeric drafts on Enter and Escape without changing committed settings",async()=>{
    await act(async()=>root.render(<Harness tool="paint.dodge"/>));
    const exposure=container.querySelector<HTMLInputElement>('[aria-label="Tool Exposure (%)"]')!,setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;
    expect([exposure.type,exposure.min,exposure.max,exposure.step]).toEqual(["number","1","100","any"]);
    await act(async()=>{setValue.call(exposure,"101");exposure.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(values.exposure).toBe(50);
    await act(async()=>exposure.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
    expect(exposure.value).toBe("50");expect(values.exposure).toBe(50);
    await act(async()=>{setValue.call(exposure,"");exposure.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>exposure.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
    expect(exposure.value).toBe("50");expect(values.exposure).toBe(50);
  });
  it("discards numeric drafts when the option is hidden or its tool changes",async()=>{
    await act(async()=>root.render(<Harness tool="paint.bucket"/>));
    const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;
    await act(async()=>setHarnessOptions!(current=>({...current,contents:"pattern",angle:-12.5})));
    let angle=container.querySelector<HTMLInputElement>('[aria-label="Tool Pattern angle"]')!;
    await act(async()=>{setValue.call(angle,"999");angle.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>setHarnessOptions!(current=>({...current,contents:"foreground"})));
    expect(container.querySelector('[aria-label="Tool Pattern angle"]')).toBeNull();
    await act(async()=>setHarnessOptions!(current=>({...current,contents:"pattern"})));
    angle=container.querySelector<HTMLInputElement>('[aria-label="Tool Pattern angle"]')!;expect(angle.value).toBe("-12.5");
    const tolerance=container.querySelector<HTMLInputElement>('[aria-label="Tool Tolerance"]')!;
    await act(async()=>{setValue.call(tolerance,"999");tolerance.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>root.render(<Harness tool="paint.magicEraser"/>));
    const replacement=container.querySelector<HTMLInputElement>('[aria-label="Tool Tolerance"]')!;
    expect(replacement).not.toBe(tolerance);expect(replacement.value).toBe("32");
  });
  it("sends background-eraser brush controls in native units with pressure-bearing points",()=>{
    const points=[[12,18,.4,12,-5,30,101],[24,32,.9,-8,14,0,133]];
    expect(strokeParameters("paint.backgroundEraser",points,20,.6,.8,"#ff0000",1,42,{sampling:"once",limits:"findEdges",tolerance:25,protectForegroundColor:true},false,null,null)).toMatchObject({points,size:20,opacity:.6,hardness:.8,seed:42,sampling:"once",limits:"findEdges",tolerance:25,protectForegroundColor:true});
  });
  it("keeps brush normalized units and retouch percentage units identical for preview and commit",()=>{
    const points=[[12,18,.4],[24,32,.9]];
    const brush=strokeParameters("paint.mixerBrush",points,20,.6,.8,"#ff0000",1,42,{wet:70,flow:45},false,null,null);
    expect(brush).toMatchObject({opacity:.6,hardness:.8,seed:42,wet:70,flow:45});
    const retouch=strokeParameters("paint.cloneStamp",points,20,.6,.8,"#ff0000",1,42,{aligned:true,sampleLayer:"all"},true,[5,5],[-7,-13]);
    expect(retouch).toMatchObject({opacity:60,hardness:80,seed:42,target:"mask",offset:[-7,-13],sampleLayer:"all"});expect(retouch).not.toHaveProperty("source");
    expect(strokeParameters("paint.cloneStamp",points,20,1,1,"#ff0000",1,42,{aligned:false},false,[5,5],[-7,-13])).toMatchObject({source:[5,5]});
  });
  it("gives Object Selection its own Rectangle or Lasso Mode and none of the marquee fields",async()=>{
    await act(async()=>root.render(<Harness tool="select.object"/>));
    const mode=container.querySelector<HTMLSelectElement>('[aria-label="Tool Mode"]')!;
    expect([...mode.options].map(option=>[option.value,option.textContent,option.disabled,option.title])).toEqual([["rectangle","Rectangle",false,""],["lasso","Lasso",false,""]]);
    expect(mode.value).toBe("rectangle");expect(values).toEqual({objectMode:"rectangle",sampleAllLayers:false,hardEdge:false});
    for(const label of ["Style","Width","Height","Width (px)","Height (px)","Draw from center"])expect(container.querySelector(`[aria-label="Tool ${label}"]`)).toBeNull();
    expect(container.querySelector('[aria-label="Tool Sample all layers"]')).not.toBeNull();
    expect(sanitizePaintOptions("select.object",{objectMode:"lasso",style:"fixedRatio",ratioWidth:2,fromCenter:true,sampleAllLayers:true})).toEqual({objectMode:"lasso",sampleAllLayers:true});
    await act(async()=>root.render(<Harness tool="select.object" disabled/>));expect(container.querySelector<HTMLSelectElement>('[aria-label="Tool Mode"]')!.disabled).toBe(true);
  });
  it("restores only valid tool-specific preset settings",()=>{
    expect(sanitizePaintOptions("paint.colorReplacement",{mode:"hue",sampling:"once",tolerance:75,antiAlias:false,source:[0,0],flow:900})).toEqual({mode:"hue",sampling:"once",tolerance:75,antiAlias:false});
    expect(sanitizePaintOptions("paint.blur",{strength:NaN,sampleAllLayers:true,mode:"hue"})).toEqual({sampleAllLayers:true});
    expect(sanitizePaintOptions("paint.historyBrush",{mode:"Multiply",flow:55,historySource:"session-source",state:8})).toEqual({mode:"Multiply",flow:55});
    expect(strokeParameters("paint.historyBrush",[[4,5,.6]],12,.65,.42,"#ff0000",1,85,{mode:"Multiply",flow:55,historySource:"session-source"},true,null,null)).toMatchObject({opacity:65,hardness:42,mode:"Multiply",flow:55,historySource:"session-source",target:"mask",seed:85});
  });
  it("converts ordinary/color-replacement percentages without changing Mixer or retouch flow units",()=>{
    const points=[[4,5,.6]];
    for(const tool of ["paint.stroke","paint.pencil","erase","paint.colorReplacement"])expect(strokeParameters(tool,points,12,.65,.42,"#ff0000",1,85,{flow:37.5,spacing:12.5,smoothing:20},false,null,null)).toMatchObject({opacity:.65,hardness:.42,flow:.375,spacing:.125,smoothing:.2});
    expect(strokeParameters("paint.mixerBrush",points,12,.65,.42,"#ff0000",1,85,{flow:37.5,spacing:12.5,smoothing:20},false,null,null)).toMatchObject({flow:37.5,spacing:.125,smoothing:.2});
    expect(strokeParameters("paint.historyBrush",points,12,.65,.42,"#ff0000",1,85,{flow:37.5,spacing:12.5},false,null,null)).toMatchObject({flow:37.5,spacing:12.5});
  });
  it("inherits native brush options precisely while keeping native Pencil and retouch defaults",()=>{
    const state={brush:{settings:{flow:.375,spacing:.125,smoothing:{amount:.2},mode:"LinearDodge",mixer:{flow:.415,wet:.315,sampleAllLayers:true}}}} as unknown as PhotoState;
    expect(paintToolDefaults("paint.stroke",state)).toEqual({mode:"Linear Dodge (Add)",flow:37.5,spacing:12.5,smoothing:20});
    expect(paintToolDefaults("paint.pencil",state)).toMatchObject({flow:100,spacing:12.5,smoothing:20,autoErase:false});
    expect(paintToolDefaults("paint.cloneStamp",state)).toMatchObject({mode:"Normal",flow:100,spacing:25});
    expect(paintToolDefaults("paint.mixerBrush",state)).toMatchObject({flow:41.5,wet:31.5,spacing:12.5,smoothing:20,sampleAllLayers:true});
    const single={brush:{settings:{flow:Math.fround(.1),spacing:Math.fround(.07),smoothing:{amount:Math.fround(.1)},mixer:{wet:Math.fround(.1)}}}} as unknown as PhotoState;
    expect(paintToolDefaults("paint.stroke",single)).toMatchObject({flow:10,spacing:7,smoothing:10});expect(paintToolDefaults("paint.mixerBrush",single)).toMatchObject({wet:10});
    expect(sanitizePaintOptions("paint.cloneStamp",{mode:"soft_light"})).toEqual({mode:"Soft Light"});
    expect(sanitizePaintOptions("paint.cloneStamp",{mode:"lineardodge"})).toEqual({mode:"Linear Dodge (Add)"});expect(sanitizePaintOptions("paint.healingBrush",{mode:"lineardodge"})).toEqual({});
    expect(sanitizePaintOptions("paint.colorReplacement",{mode:"SoftLight"})).toEqual({});
  });
  it("lets a newly selected brush replace inherited controls without losing unrelated tool choices",()=>{
    expect(rebaseBrushOptions({"paint.pencil":{mode:"Multiply",flow:20,spacing:50,smoothing:15,autoErase:true},"paint.mixerBrush":{wet:25,load:25,mix:25,flow:25,sampleAllLayers:true,cleanAfterStroke:false},"paint.colorReplacement":{mode:"hue",sampling:"once",flow:20},"paint.dodge":{range:"shadows",flow:40}})).toEqual({"paint.pencil":{autoErase:true},"paint.mixerBrush":{cleanAfterStroke:false},"paint.colorReplacement":{mode:"hue",sampling:"once"},"paint.dodge":{range:"shadows",flow:40}});
  });
});
