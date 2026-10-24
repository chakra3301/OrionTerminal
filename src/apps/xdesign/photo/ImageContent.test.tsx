import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageTextDialog, textReplacement } from "./ImageDialogs";
import { ImageTypographyPanel, characterRange, parseFontSettings, rangeStyle } from "./ImageTypographyPanel";
import { GradientFillDialog } from "./GradientFillDialog";
import { usePhotoWorkspace } from "./runtime";
import type { GradientFill, PhotoDocument, PhotoLayer } from "./types";
const native=vi.hoisted(()=>({run:vi.fn(),invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>false,invoke:native.invoke,convertFileSrc:(path:string)=>path}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),runPhotoCommand:native.run}));
const gradient:GradientFill={style:"linear",angle:0,scale:80,offset:[0,0],reverse:false,dither:true,align:false,from:[10,50],to:[90,50],stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[[0,20],[1,100]],midpoints:[.3]};
const layer:PhotoLayer={id:1,name:"Type",kind:"Text",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false,text:{text:"A🖌éZ",font:"Arial",sizePt:12,runs:[{start:0,end:1,style:{font:"Arial",size:12,weight:400,color:"#000000ff"}},{start:1,end:3,style:{font:"Inter",size:18,weight:700,color:"#12345680"}},{start:3,end:4,style:{font:"Arial",size:12,weight:400,color:"#000000ff"}}],paragraphs:[{start:0,end:4,style:{align:"left",direction:"auto"}}]}};
const doc:PhotoDocument={id:"photo",version:"v1",name:"Image",width:100,height:100,previewWidth:100,previewHeight:100,bundlePath:"",previewPath:"image.png",originalPath:null};
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);native.run.mockReset().mockResolvedValue({});native.invoke.mockReset();usePhotoWorkspace.setState({projectId:"project",busy:false,error:null});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const submit=()=>act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
const setInput=async(label:string,value:string,blur=false)=>act(async()=>{const element=container.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[aria-label="${label}"]`)!;const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));if(blur)element.dispatchEvent(new FocusEvent("focusout",{bubbles:true}));});
describe("editable image text and live gradients",()=>{
  it("computes Unicode replacements and ranges without splitting astral characters",()=>{
    expect(textReplacement("A🖌éZ","A🖌é!Z")).toEqual({start:3,end:3,text:"!"});expect(textReplacement("A🖌éZ","A🎨Z")).toEqual({start:1,end:3,text:"🎨"});expect(textReplacement("same","same")).toBeNull();expect(textReplacement("a\r\nb","a\nb")).toBeNull();
    expect(characterRange("A🖌éZ",1,4)).toEqual([1,3]);expect(rangeStyle(layer.text!.runs!,[0,4],"weight")).toBeUndefined();expect(rangeStyle(layer.text!.runs!,[1,3],"weight")).toBe(700);
    expect(parseFontSettings("wght=650, opsz=14.5","variations")).toEqual({wght:650,opsz:14.5});expect(parseFontSettings("ss01=1","features")).toEqual({ss01:1});expect(()=>parseFontSettings("ss01=-1","features")).toThrow();expect(()=>parseFontSettings("garbage","variations")).toThrow();
  });
  it("edits only the changed text span and leaves existing character formatting intact",async()=>{
    await act(async()=>root.render(<ImageTextDialog layer={layer} close={()=>{}}/>));await setInput("Image text","A🖌é!Z");await submit();
    expect(native.run).toHaveBeenCalledWith("type.edit",{layer:1,replace:{start:3,end:3,text:"!"}});
  });
  it("does not create an image version when unchanged text is submitted",async()=>{
    const close=vi.fn();await act(async()=>root.render(<ImageTextDialog layer={layer} close={close}/>));await submit();expect(native.run).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();
  });
  it("formats a selected Unicode range with only the requested property",async()=>{
    await act(async()=>root.render(<ImageTypographyPanel layer={layer}/>));
    const text=container.querySelector<HTMLTextAreaElement>('[aria-label="Select image text range"]')!;
    await act(async()=>{text.focus();text.setSelectionRange(1,4);text.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));document.dispatchEvent(new Event("selectionchange",{bubbles:true}));});
    expect(container.textContent).toContain("Characters 2–3");await setInput("Image type Weight","600",true);
    expect(native.run).toHaveBeenCalledWith("type.setStyle",{layer:1,range:[1,3],weight:600});
    expect(native.run.mock.calls[0]![1]).not.toHaveProperty("font");
  });
  it("leaves mixed attributes untouched on blur and uses the selected range for paragraph edits",async()=>{
    await act(async()=>root.render(<ImageTypographyPanel layer={layer}/>));expect(container.querySelector<HTMLInputElement>('[aria-label="Image type Weight"]')!.value).toBe("");
    for(const name of ["Font","Color","Language","features","variations"])await act(async()=>container.querySelector(`[aria-label="Image type ${name}"]`)!.dispatchEvent(new FocusEvent("focusout",{bubbles:true})));
    expect(native.run).not.toHaveBeenCalled();
    await act(async()=>{const select=container.querySelector<HTMLSelectElement>('[aria-label="Image type Direction"]')!;select.value="rtl";select.dispatchEvent(new Event("change",{bubbles:true}));});expect(native.run).toHaveBeenCalledWith("type.setStyle",{layer:1,range:[0,4],direction:"rtl"});
  });
  it("nudges gradient handles and commits one geometry edit while retaining imported stops",async()=>{
    await act(async()=>root.render(<GradientFillDialog document={doc} layer={{...layer,gradientFill:gradient}} close={()=>{}}/>));
    await act(async()=>container.querySelector('[aria-label="Gradient from handle"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",shiftKey:true,bubbles:true})));
    await submit();expect(native.run).toHaveBeenCalledWith("gradient.fill.set",{layer:1,from:[20,50],to:[90,50]});expect(native.run.mock.calls[0]![1]).not.toHaveProperty("stops");
  });
  it("restores the opening gradient on Alt-click Reset and offers the frame Preview box",async()=>{
    await act(async()=>root.render(<GradientFillDialog document={doc} layer={{...layer,gradientFill:gradient}} close={()=>{}}/>));
    expect([...container.querySelectorAll(".xd-ps-dialog-buttons label")].some(label=>label.textContent==="Preview")).toBe(true);
    await setInput("Fill gradient angle","90");expect(container.querySelector<HTMLInputElement>('[aria-label="Fill gradient angle"]')!.value).toBe("90");
    await act(async()=>{window.dispatchEvent(new KeyboardEvent("keydown",{key:"Alt",altKey:true}));});
    await act(async()=>{[...container.querySelectorAll("button")].find(b=>b.textContent==="Reset")!.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,altKey:true}));});
    expect(container.querySelector<HTMLInputElement>('[aria-label="Fill gradient angle"]')!.value).toBe("0");
  });
  it("switches from handle geometry to numeric geometry without sending conflicting positions",async()=>{
    await act(async()=>root.render(<GradientFillDialog document={doc} layer={{...layer,gradientFill:gradient}} close={()=>{}}/>));
    await act(async()=>container.querySelector('[aria-label="Gradient from handle"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true})));
    await setInput("Fill gradient angle","90");await setInput("Fill transparency 1 opacity (%)","45");await submit();
    expect(native.run).toHaveBeenCalledWith("gradient.fill.set",{layer:1,angle:90,transparency:[[0,45],[1,100]]});
  });
});
