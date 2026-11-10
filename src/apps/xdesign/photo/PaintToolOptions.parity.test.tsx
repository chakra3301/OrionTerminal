import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaintToolOptions, paintToolDefaults, sanitizePaintOptions, strokeParameters, type PaintOptions } from "./PaintToolOptions";
import type { PhotoState } from "./types";
let root: Root, container: HTMLDivElement, values: PaintOptions;
function Harness({tool}:{tool:string}) {const [options,setOptions]=useState(paintToolDefaults(tool,null));values=options;return <PaintToolOptions tool={tool} values={options} disabled={false} change={setOptions}/>;}
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const HEALING_MODES=["Normal","Replace","Multiply","Screen","Darken","Lighten","Color","Luminosity"];

describe("Photoshop paint and retouch option values",()=>{
  it.each(["paint.stroke","paint.pencil","erase","paint.mixerBrush"])("starts %s Smoothing at Photoshop's 10 percent until the brush carries its own amount",tool=>{
    expect(paintToolDefaults(tool,null).smoothing).toBe(10);
    expect(paintToolDefaults(tool,{brush:{settings:{smoothing:{amount:0}}}} as unknown as PhotoState).smoothing).toBe(10);
    expect(paintToolDefaults(tool,{brush:{settings:{smoothing:{amount:.35}}}} as unknown as PhotoState).smoothing).toBe(35);
    expect(sanitizePaintOptions(tool,{smoothing:0})).toEqual({smoothing:0});
    expect(sanitizePaintOptions(tool,{smoothing:140})).toEqual({});
  });
  it("lists Photoshop's eight Healing Brush modes with Replace and keeps Clone Stamp's full list",async()=>{
    await act(async()=>root.render(<Harness tool="paint.healingBrush"/>));
    const select=container.querySelector<HTMLSelectElement>('[aria-label="Tool Blend"]')!;
    expect([...select.options].map(option=>option.value)).toEqual(HEALING_MODES);
    expect(select.parentElement!.firstChild!.textContent).toBe("Mode");
    await act(async()=>{select.value="Luminosity";select.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(values.mode).toBe("Luminosity");
    expect(sanitizePaintOptions("paint.healingBrush",{mode:"luminosity"})).toEqual({mode:"Luminosity"});
    expect(sanitizePaintOptions("paint.healingBrush",{mode:"Overlay"})).toEqual({});
    expect(sanitizePaintOptions("paint.healingBrush",{mode:"replace"})).toEqual({mode:"Replace"});
    expect(sanitizePaintOptions("paint.cloneStamp",{mode:"Replace"})).toEqual({});
    expect(sanitizePaintOptions("paint.cloneStamp",{mode:"Overlay"})).toEqual({mode:"Overlay"});
    await act(async()=>root.render(<Harness key="clone" tool="paint.cloneStamp"/>));
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Tool Blend"]')!.options.length).toBe(27);
  });
  it("sends the Block eraser at full strength without the options-bar Opacity or Flow",()=>{
    const block=strokeParameters("erase",[[4,5,.6]],12,.4,.42,"#ff0000",2,85,{eraserMode:"block",flow:30,spacing:10,smoothing:10},false,null,null);
    expect(block).not.toHaveProperty("opacity");expect(block).not.toHaveProperty("flow");
    expect(block).toMatchObject({erase:true,size:8,brush:{aliased:true,opacity:1,flow:1}});
    expect(strokeParameters("erase",[[4,5,.6]],12,.4,.42,"#ff0000",2,85,{eraserMode:"brush",flow:30},false,null,null)).toMatchObject({opacity:.4,flow:.3});
  });
  it("hides Flow in the Block eraser's options and restores it for Brush mode",async()=>{
    await act(async()=>root.render(<Harness tool="erase"/>));
    expect(container.querySelector('[aria-label="Tool Flow (%)"]')).not.toBeNull();
    const mode=container.querySelector<HTMLSelectElement>('[aria-label="Tool Mode"]')!;
    await act(async()=>{mode.value="block";mode.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(values.eraserMode).toBe("block");
    expect(container.querySelector('[aria-label="Tool Flow (%)"]')).toBeNull();
    await act(async()=>{mode.value="brush";mode.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(container.querySelector('[aria-label="Tool Flow (%)"]')).not.toBeNull();
  });
  it("offers Photoshop's Mixer Brush combinations before Wet, setting Wet, Load and Mix in one change and naming a hand-set mix Custom",async()=>{
    const change=vi.fn();
    await act(async()=>root.render(<PaintToolOptions tool="paint.mixerBrush" values={paintToolDefaults("paint.mixerBrush",null)} disabled={false} change={change}/>));
    const combo=container.querySelector<HTMLSelectElement>('[aria-label="Mixer brush combination"]')!;
    expect([...combo.options].map(option=>option.value)).toEqual(["Custom","Dry","Dry, Light Load","Dry, Heavy Load","Moist","Moist, Light Mix","Moist, Heavy Mix","Wet","Wet, Light Mix","Wet, Heavy Mix","Very Wet","Very Wet, Light Mix","Very Wet, Heavy Mix"]);
    expect(combo.value).toBe("Wet");
    expect(combo.compareDocumentPosition(container.querySelector('[aria-label="Tool Wet (%)"]')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async()=>{combo.value="Very Wet, Heavy Mix";combo.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(change.mock.calls).toEqual([[{...paintToolDefaults("paint.mixerBrush",null),wet:100,load:50,mix:90}]]);
    await act(async()=>root.render(<PaintToolOptions tool="paint.mixerBrush" values={{...paintToolDefaults("paint.mixerBrush",null),wet:33}} disabled={true} change={change}/>));
    expect(combo.value).toBe("Custom");expect(combo.disabled).toBe(true);
  });
  it("keeps the Mixer combination off every other tool",async()=>{
    await act(async()=>root.render(<Harness tool="paint.stroke"/>));
    expect(container.querySelector('[aria-label="Mixer brush combination"]')).toBeNull();
  });
});

const choose=async(label:string,value:string)=>{await act(async()=>{const select=container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;select.value=value;select.dispatchEvent(new Event("change",{bubbles:true}));});};
const type=async(label:string,value:string)=>{const input=container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});};
const optionsOf=(label:string)=>[...container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!.options].map(option=>option.value);
const field=(label:string)=>container.querySelector<HTMLInputElement|HTMLSelectElement>(`[aria-label="${label}"]`);
const BUCKET_MODES=["Normal","Dissolve","Behind","Clear","Darken","Multiply","Color Burn","Linear Burn","Darker Color","Lighten","Screen","Color Dodge","Linear Dodge (Add)","Lighter Color","Overlay","Soft Light","Hard Light","Vivid Light","Linear Light","Pin Light","Hard Mix","Difference","Exclusion","Subtract","Divide","Hue","Saturation","Color","Luminosity"];

describe("Photoshop retouch and fill options the image engine now takes",()=>{
  it("gives Spot Healing Photoshop's healing Mode and the Sample choice, sent with each stroke",async()=>{
    await act(async()=>root.render(<Harness tool="paint.spotHealing"/>));
    expect(optionsOf("Tool Blend")).toEqual(HEALING_MODES);
    expect(field("Tool Blend")!.parentElement!.firstChild!.textContent).toBe("Mode");
    expect(optionsOf("Tool Sample")).toEqual(["current","currentAndBelow","all"]);
    expect(values).toMatchObject({mode:"Normal",sampleLayer:"current",type:"contentAware"});
    await choose("Tool Blend","Replace");await choose("Tool Sample","all");
    expect(values).toMatchObject({mode:"Replace",sampleLayer:"all"});
    expect(sanitizePaintOptions("paint.spotHealing",{mode:"luminosity",sampleLayer:"everything"})).toEqual({mode:"Luminosity"});
    expect(strokeParameters("paint.spotHealing",[[4,5,1]],20,1,1,"#ff0000",1,null,values,false,null,null)).toMatchObject({mode:"Replace",sampleLayer:"all",type:"contentAware"});
  });
  it("switches the Healing Brush Source between Sampled and Pattern, with the pattern picker only for Pattern",async()=>{
    const selectPattern=vi.fn(),presets={pattern:"b",patterns:[{name:"Basics",presets:[{id:"a",name:"Bubbles"},{id:"b",name:"Burlap"}]}]} as unknown as PhotoState["presets"];
    function Patterns(){const [options,setOptions]=useState(paintToolDefaults("paint.healingBrush",null));values=options;return <PaintToolOptions tool="paint.healingBrush" values={options} disabled={false} presets={presets} selectPattern={selectPattern} change={setOptions}/>;}
    await act(async()=>root.render(<Patterns/>));
    expect(optionsOf("Tool Source")).toEqual(["sampled","pattern"]);
    expect(values.sourceType).toBe("sampled");expect(field("Tool Pattern")).toBeNull();
    await choose("Tool Source","pattern");
    expect(values.sourceType).toBe("pattern");expect(field("Tool Pattern")!.value).toBe("b");
    await choose("Tool Pattern","a");
    expect(selectPattern.mock.calls).toEqual([["a"]]);
    expect(sanitizePaintOptions("paint.healingBrush",{sourceType:"texture"})).toEqual({});
    expect(sanitizePaintOptions("paint.cloneStamp",{sourceType:"pattern"})).toEqual({});
  });
  it.each(["paint.healingBrush","paint.patch"])("takes %s Diffusion as a whole number from 1 to 7 on a popup slider",async tool=>{
    await act(async()=>root.render(<Harness tool={tool}/>));
    expect(values.diffusion).toBe(5);
    expect(container.querySelector('[aria-label="Show diffusion slider"]')).not.toBeNull();
    await type("Tool Diffusion","3");expect(values.diffusion).toBe(3);
    await type("Tool Diffusion","2.5");await type("Tool Diffusion","8");expect(values.diffusion).toBe(3);
    expect(sanitizePaintOptions(tool,{diffusion:7})).toEqual({diffusion:7});
    for(const diffusion of [0,2.5,8,"5"])expect(sanitizePaintOptions(tool,{diffusion})).toEqual({});
  });
  it.each(["paint.healingBrush","paint.cloneStamp"])("offers %s Ignore Adjustment Layers, dimmed while sampling the current layer",async tool=>{
    await act(async()=>root.render(<Harness tool={tool}/>));
    const ignore=()=>field("Tool Ignore adjustment layers") as HTMLInputElement;
    expect(values.ignoreAdjustmentLayers).toBe(false);expect(ignore().disabled).toBe(true);
    await choose("Tool Sample","currentAndBelow");expect(ignore().disabled).toBe(false);
    await act(async()=>ignore().click());
    expect(values.ignoreAdjustmentLayers).toBe(true);
    expect(sanitizePaintOptions(tool,{ignoreAdjustmentLayers:"yes"})).toEqual({});
  });
  it("shows Patch's Normal fields or its Content-Aware fields, never both",async()=>{
    await act(async()=>root.render(<Harness tool="paint.patch"/>));
    expect(values).toEqual({type:"normal",mode:"source",diffusion:5,structure:4,colorAdaptation:0,sampleAllLayers:false});
    expect(optionsOf("Tool Patch")).toEqual(["normal","contentAware"]);
    expect([...field("Tool Patch")!.querySelectorAll("option")].map(option=>option.textContent)).toEqual(["Normal","Content-Aware"]);
    const shown=()=>["Tool Diffusion","Tool Structure","Tool Color","Tool Sample all layers"].filter(label=>field(label));
    expect(shown()).toEqual(["Tool Diffusion"]);
    await choose("Tool Patch","contentAware");
    expect(shown()).toEqual(["Tool Structure","Tool Color","Tool Sample all layers"]);
    await type("Tool Structure","7");await type("Tool Color","10");await type("Tool Color","10.5");
    expect(values).toMatchObject({type:"contentAware",structure:7,colorAdaptation:10});
    expect(sanitizePaintOptions("paint.patch",{type:"contentaware",structure:0,colorAdaptation:11})).toEqual({});
    expect(sanitizePaintOptions("paint.patch",{type:"contentAware",structure:1,colorAdaptation:0,sampleAllLayers:true})).toEqual({type:"contentAware",structure:1,colorAdaptation:0,sampleAllLayers:true});
  });
  it("puts the Paint Bucket's Mode first, with Behind and Clear after Dissolve, and All Layers last",async()=>{
    await act(async()=>root.render(<Harness tool="paint.bucket"/>));
    const bar=container.querySelector(".xd-photo-paint-options")!;
    expect(bar.firstElementChild!.firstChild!.textContent).toBe("Mode");
    expect(optionsOf("Tool Blend")).toEqual(BUCKET_MODES);
    expect(bar.lastElementChild!.textContent).toBe("All layers");
    expect(values).toMatchObject({mode:"Normal",sampleAllLayers:false});
    await choose("Tool Blend","Behind");await act(async()=>(field("Tool All layers") as HTMLInputElement).click());
    expect(values).toMatchObject({mode:"Behind",sampleAllLayers:true});
    expect(sanitizePaintOptions("paint.bucket",{mode:"clear"})).toEqual({mode:"Clear"});
    expect(strokeParameters("paint.bucket",[[4,5,1]],20,1,1,"#ff0000",1,null,values,false,null,null)).toMatchObject({mode:"Behind",sampleAllLayers:true});
  });
  it.each(["paint.stroke","paint.pencil"])("gives %s Behind and Clear after Dissolve, sent with the stroke and kept from saved values, while the Eraser keeps erasing",async tool=>{
    await act(async()=>root.render(<Harness tool={tool}/>));
    expect(optionsOf("Tool Blend")).toEqual(BUCKET_MODES);
    await choose("Tool Blend","Clear");
    expect(values.mode).toBe("Clear");
    expect(sanitizePaintOptions(tool,{mode:"behind"})).toEqual({mode:"Behind"});
    expect(paintToolDefaults(tool,{brush:{settings:{mode:"Behind"}}} as unknown as PhotoState).mode).toBe("Behind");
    expect(strokeParameters(tool,[[4,5,1]],20,1,1,"#ff0000",1,null,values,false,null,null)).toMatchObject({mode:"Clear"});
    expect(strokeParameters("erase",[[4,5,1]],20,1,1,"#ff0000",1,null,paintToolDefaults("erase",null),false,null,null)).not.toHaveProperty("mode");
  });
  it("greys Behind and Clear, and only those, on a target without transparency",async()=>{
    await act(async()=>root.render(<PaintToolOptions tool="paint.stroke" values={paintToolDefaults("paint.stroke",null)} disabled={false} opaque change={vi.fn()}/>));
    const select=field("Tool Blend") as HTMLSelectElement;
    expect([select.disabled,[...select.options].filter(option=>option.disabled).map(option=>option.value)]).toEqual([false,["Behind","Clear"]]);
  });
  it("dims the options a mask or channel cannot take and leaves the rest editable",async()=>{
    await act(async()=>root.render(<PaintToolOptions tool="paint.bucket" values={paintToolDefaults("paint.bucket",null)} disabled={false} locked={["mode","sampleAllLayers"]} change={vi.fn()}/>));
    expect([field("Tool Blend")!.disabled,field("Tool All layers")!.disabled,field("Tool Tolerance")!.disabled]).toEqual([true,true,false]);
  });
});

describe("Photoshop selection options the image engine now takes",()=>{
  it("leads the Magic Wand bar with Photoshop's Sample Size and drops a size the engine does not take",async()=>{
    await act(async()=>root.render(<Harness tool="select.magicWand"/>));
    const size=field("Tool Sample Size") as HTMLSelectElement;
    expect([...size.options].map(option=>[option.value,option.textContent])).toEqual([["1","Point Sample"],["3","3 by 3 Average"],["5","5 by 5 Average"],["11","11 by 11 Average"],["31","31 by 31 Average"],["51","51 by 51 Average"],["101","101 by 101 Average"]]);
    expect(container.querySelector(".xd-photo-paint-options")!.firstElementChild!.contains(size)).toBe(true);
    expect(values.sampleSize).toBe(1);
    await act(async()=>{size.value="11";size.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(values.sampleSize).toBe(11);
    expect(sanitizePaintOptions("select.magicWand",{sampleSize:31})).toEqual({sampleSize:31});
    for(const stale of [7,"3",0])expect(sanitizePaintOptions("select.magicWand",{sampleSize:stale})).toEqual({});
  });
  it("lets Object Selection draw a Lasso and turn on Hard Edge",async()=>{
    await act(async()=>root.render(<Harness tool="select.object"/>));
    const mode=field("Tool Mode") as HTMLSelectElement,hard=field("Tool Hard Edge") as HTMLInputElement;
    expect([...mode.options].map(option=>option.disabled)).toEqual([false,false]);
    expect(hard.checked).toBe(false);
    await act(async()=>{mode.value="lasso";mode.dispatchEvent(new Event("change",{bubbles:true}));});
    await act(async()=>hard.click());
    expect(values).toEqual({objectMode:"lasso",sampleAllLayers:false,hardEdge:true});
    expect(sanitizePaintOptions("select.object",{objectMode:"lasso",hardEdge:true,sampleAllLayers:"yes"})).toEqual({objectMode:"lasso",hardEdge:true});
  });
});
