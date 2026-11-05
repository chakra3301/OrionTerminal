import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EffectSettings } from "./LayerEffects";
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const field=(label:string)=>container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const caption=(label:string)=>field(label).parentElement!.firstChild!.textContent;
const type=async(label:string,value:string)=>{const input=field(label);await act(async()=>{input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));input.blur();});};
const brush={colorDynamics:{enabled:true,hueJitter:.25,saturationJitter:.1,brightnessJitter:0,purity:-.5},texture:{enabled:true,brightness:.5,contrast:-1},smoothing:{amount:.1,pulledString:false}};

describe("Brush Settings units",()=>{
  it("shows Color Dynamics jitters, Purity and Smoothing as Photoshop percentages and Texture tone on its -150..150 scale",async()=>{
    const commit=vi.fn();
    await act(async()=>root.render(<EffectSettings value={brush} commit={commit} effectType="BrushSettings"/>));
    expect([["Color Dynamics · Hue Jitter","25"],["Color Dynamics · Saturation Jitter","10"],["Color Dynamics · Brightness Jitter","0"],["Color Dynamics · Purity","-50"],["Texture · Brightness","75"],["Texture · Contrast","-150"],["Smoothing · Amount","10"]].map(([label])=>[label,field(label!).value])).toEqual([["Color Dynamics · Hue Jitter","25"],["Color Dynamics · Saturation Jitter","10"],["Color Dynamics · Brightness Jitter","0"],["Color Dynamics · Purity","-50"],["Texture · Brightness","75"],["Texture · Contrast","-150"],["Smoothing · Amount","10"]]);
    expect(caption("Color Dynamics · Hue Jitter")).toBe("Hue Jitter (%)");expect(caption("Color Dynamics · Purity")).toBe("Purity (%)");expect(caption("Smoothing · Amount")).toBe("Amount (%)");expect(caption("Texture · Brightness")).toBe("Brightness");
    expect([field("Color Dynamics · Purity").min,field("Color Dynamics · Purity").max,field("Texture · Contrast").min,field("Texture · Contrast").max]).toEqual(["-100","100","-150","150"]);
  });
  it("commits engine fractions and refuses values outside Photoshop's ranges",async()=>{
    const commit=vi.fn();
    await act(async()=>root.render(<EffectSettings value={brush} commit={commit} effectType="BrushSettings"/>));
    await type("Color Dynamics · Hue Jitter","40");await type("Color Dynamics · Purity","100");await type("Texture · Brightness","-150");await type("Smoothing · Amount","35");
    expect(commit.mock.calls).toEqual([[["colorDynamics","hueJitter"],.4],[["colorDynamics","purity"],1],[["texture","brightness"],-1],[["smoothing","amount"],.35]]);
    commit.mockClear();
    await type("Color Dynamics · Purity","-101");await type("Texture · Contrast","151");await type("Color Dynamics · Saturation Jitter","120");await type("Smoothing · Amount","-5");
    expect(commit).not.toHaveBeenCalled();
  });
});
