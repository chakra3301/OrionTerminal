import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageTextDialog, textReplacement } from "./ImageDialogs";
import { ImageTypographyPanel, characterRange, parseFontSettings, rangeStyle } from "./ImageTypographyPanel";
import { GradientFillDialog } from "./GradientFillDialog";
import { usePhotoWorkspace } from "./runtime";
import { bakeGradient, bakeRemembered } from "./gradientMethod";
import type { GradientFill, PhotoDocument, PhotoLayer } from "./types";
const native=vi.hoisted(()=>({enabled:false,run:vi.fn(),invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>native.enabled,invoke:native.invoke,convertFileSrc:(path:string)=>path}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),runPhotoCommand:native.run}));
const gradient:GradientFill={style:"linear",angle:0,scale:80,offset:[0,0],reverse:false,dither:true,align:false,from:[10,50],to:[90,50],stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[[0,20],[1,100]],midpoints:[.3]};
const layer:PhotoLayer={id:1,name:"Type",kind:"Text",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false,text:{text:"A🖌éZ",font:"Arial",sizePt:12,runs:[{start:0,end:1,style:{font:"Arial",size:12,weight:400,color:"#000000ff"}},{start:1,end:3,style:{font:"Inter",size:18,weight:700,color:"#12345680"}},{start:3,end:4,style:{font:"Arial",size:12,weight:400,color:"#000000ff"}}],paragraphs:[{start:0,end:4,style:{align:"left",direction:"auto"}}]}};
const doc:PhotoDocument={id:"photo",version:"v1",name:"Image",width:100,height:100,previewWidth:100,previewHeight:100,bundlePath:"",previewPath:"image.png",originalPath:null};
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);native.enabled=false;native.run.mockReset().mockResolvedValue({});native.invoke.mockReset();usePhotoWorkspace.setState({projectId:"project",busy:false,error:null});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
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
  describe("Gradient Fill dialog",()=>{
    const wide:PhotoDocument={...doc,width:200,height:100};
    const open=async(fill:GradientFill=gradient,photo=doc)=>{act(()=>root.unmount());root=createRoot(container);canvas?.remove();canvas=document.createElement("div");canvas.getBoundingClientRect=()=>({width:photo.width*2,height:photo.height*2,left:0,top:0,right:photo.width*2,bottom:photo.height*2,x:0,y:0,toJSON(){}});document.body.append(canvas);await act(async()=>root.render(<GradientFillDialog document={photo} layer={{...layer,gradientFill:fill}} canvas={canvas} close={()=>{}}/>));};
    let canvas:HTMLDivElement|undefined,host:HTMLDivElement;
    // The editor and the preset list open in the workspace, outside the dialog's form.
    beforeEach(()=>{host=document.createElement("div");host.className="xd-photo";container.replaceWith(host);host.append(container);});
    afterEach(()=>{canvas?.remove();canvas=undefined;host.remove();});
    const button=(text:string,within:ParentNode=container)=>[...within.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===text)!;
    const select=(label:string,value:string)=>act(async()=>{const element=container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;element.value=value;element.dispatchEvent(new Event("change",{bubbles:true}));});
    it("lays out Photoshop's controls without stop, offset or Preview fields",async()=>{
      await open();
      const text=container.querySelector("form")!.textContent!;
      const order=["Gradient:","Style:","Angle:","Scale:","Reverse","Dither","Align with layer","Reset Alignment","Fit to document","Method:"].map(label=>text.indexOf(label));
      expect(order.every(at=>at>=0)).toBe(true);expect([...order].sort((a,b)=>a-b)).toEqual(order);
      expect(container.querySelector('[aria-label="Edit gradient"]')).not.toBeNull();expect(container.querySelector('[aria-label="Fill gradient angle dial"]')).not.toBeNull();expect(container.querySelector('[aria-label="Show scale slider"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Fill gradient offset X (%)"]')).toBeNull();expect(container.querySelector("details")).toBeNull();expect(container.querySelector("svg.xd-photo-geometry-stage")).toBeNull();
      expect([...container.querySelectorAll(".xd-ps-dialog-buttons label")].some(label=>label.textContent==="Preview")).toBe(false);
    });
    it("previews each change on the canvas and shows the engine's geometry",async()=>{
      native.enabled=true;vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:fill");vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
      native.invoke.mockResolvedValue({width:100,height:100,png:"AA==",result:{...gradient,style:"radial",scale:120,from:[50,50],to:[110,50]}});
      await open();await select("Fill gradient style","radial");await act(async()=>{await new Promise(resolve=>setTimeout(resolve,250));});
      expect(native.invoke).toHaveBeenCalledWith("xdesign_photo_command_preview",expect.objectContaining({command:"gradient.fill.set",params:{layer:1,style:"radial",scale:150}}));
      expect(canvas!.querySelector("img.xd-photo-canvas-preview")!.getAttribute("src")).toBe("blob:fill");expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector<HTMLInputElement>('[aria-label="Fill gradient scale"]')!.value).toBe("75");
    });
    it("moves the gradient when the image is dragged, in document pixels",async()=>{
      await open();
      await act(async()=>{container.querySelector(".xd-ps-dialog-scrim")!.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:50,clientY:50}));});
      await act(async()=>{window.dispatchEvent(new MouseEvent("pointermove",{clientX:70,clientY:60}));});
      await act(async()=>{window.dispatchEvent(new MouseEvent("pointerup"));});
      await submit();expect(native.run).toHaveBeenCalledWith("gradient.fill.set",{layer:1,from:[20,55],to:[100,55]});
    });
    it("Reset Alignment centres the gradient and keeps a dragged gradient's angle and scale",async()=>{
      await open({...gradient,offset:[10,5]});await act(async()=>button("Reset Alignment").click());await submit();
      expect(native.run).toHaveBeenLastCalledWith("gradient.fill.set",{layer:1,offset:[0,0]});
      native.run.mockClear();await open({...gradient,offset:[10,5]});
      await act(async()=>{container.querySelector(".xd-ps-dialog-scrim")!.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:0,clientY:0}));});
      await act(async()=>{window.dispatchEvent(new MouseEvent("pointermove",{clientX:20,clientY:0}));});
      await act(async()=>{window.dispatchEvent(new MouseEvent("pointerup"));});
      await act(async()=>button("Reset Alignment").click());await submit();
      expect(native.run).toHaveBeenLastCalledWith("gradient.fill.set",{layer:1,angle:0,scale:80,offset:[0,0]});
    });
    it("Fit to document spans the document through its centre at the angle",async()=>{
      await open({...gradient,angle:45},wide);await act(async()=>button("Fit to document").click());await submit();
      expect(native.run).toHaveBeenLastCalledWith("gradient.fill.set",{layer:1,from:[50,100],to:[150,0]});
      native.run.mockClear();await open({...gradient,style:"radial",angle:0},wide);await act(async()=>button("Fit to document").click());await submit();
      expect(native.run).toHaveBeenLastCalledWith("gradient.fill.set",{layer:1,from:[100,50],to:[200,50]});
    });
    it("shows the scale against the document's short side as Photoshop does and keeps it through angle and style changes",async()=>{
      const photo:PhotoDocument={...doc,width:800,height:600},scale=()=>container.querySelector<HTMLInputElement>('[aria-label="Fill gradient scale"]')!.value;
      await open({...gradient,scale:100},photo);expect(scale()).toBe("133");
      await setInput("Fill gradient scale","60");await setInput("Fill gradient angle","90");expect(scale()).toBe("60");
      await select("Fill gradient style","radial");expect(scale()).toBe("60");await submit();
      expect(native.run).toHaveBeenLastCalledWith("gradient.fill.set",{layer:1,angle:90,scale:120,style:"radial"});
      // The engine stores at most 150%, which a Radial fill at 90° shows as 75%.
      await setInput("Fill gradient scale","100");expect(scale()).toBe("75");
      await open({...gradient,style:"radial",scale:100},photo);expect(scale()).toBe("67");
    });
    it("types an angle or a scale and Alt-click Reset restores the opening values",async()=>{
      await open();await setInput("Fill gradient angle","90");await setInput("Fill gradient scale","120");
      await act(async()=>{window.dispatchEvent(new KeyboardEvent("keydown",{key:"Alt",altKey:true}));});
      await act(async()=>{button("Reset").dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,altKey:true}));});
      await act(async()=>{window.dispatchEvent(new KeyboardEvent("keyup",{key:"Alt"}));});
      expect(container.querySelector<HTMLInputElement>('[aria-label="Fill gradient angle"]')!.value).toBe("0");
      await setInput("Fill gradient angle","90");await setInput("Fill gradient scale","120");await submit();
      expect(native.run).toHaveBeenCalledWith("gradient.fill.set",{layer:1,angle:90,scale:120});
    });
    it("edits the gradient in the Gradient Editor: each edit previews, Cancel restores and OK keeps",async()=>{
      await open();await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Edit gradient"]')!.click());
      const editor=()=>document.querySelector<HTMLFormElement>('form[aria-label="Gradient Editor"]');
      expect(editor()).not.toBeNull();
      await act(async()=>editor()!.querySelector('[aria-label="Color stop 1"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",shiftKey:true,bubbles:true})));
      await act(async()=>button("Cancel",editor()!).click());expect(editor()).toBeNull();
      await submit();expect(native.run).toHaveBeenLastCalledWith("gradient.fill.set",{layer:1});
      await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Edit gradient"]')!.click());
      await act(async()=>editor()!.querySelector('[aria-label="Color stop 1"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",shiftKey:true,bubbles:true})));
      await act(async()=>editor()!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));expect(editor()).toBeNull();
      await submit();expect(native.run).toHaveBeenLastCalledWith("gradient.fill.set",{layer:1,stops:[[.1,"#000000"],[1,"#ffffff"]],transparency:[[0,20],[1,100]],midpoints:[.3]});
    });
    it("moves a Classic fill's colour midpoint in the Gradient Editor, and shows none on a baked Method's stops",async()=>{
      const editor=()=>document.querySelector<HTMLFormElement>('form[aria-label="Gradient Editor"]')!,edit=()=>act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Edit gradient"]')!.click());
      await open();await edit();
      await act(async()=>editor().querySelector<HTMLElement>('[aria-label="Color stop 1"]')!.click());
      await act(async()=>editor().querySelector<HTMLElement>('[aria-label="Color midpoint 1"]')!.click());
      const location=editor().querySelector<HTMLInputElement>('[aria-label="Color midpoint location"]')!;expect(location.value).toBe("30");
      await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(location,"60");location.dispatchEvent(new Event("input",{bubbles:true}));});
      await act(async()=>editor().dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
      await submit();expect(native.run).toHaveBeenLastCalledWith("gradient.fill.set",{layer:1,stops:[[0,"#000000"],[1,"#ffffff"]],transparency:[[0,20],[1,100]],midpoints:[.6]});
      native.run.mockClear();await open({...gradient,stops:bakeRemembered([[0,"#ff0000"],[1,"#0000ff"]],"linear")!,midpoints:[]});await edit();
      await act(async()=>editor().querySelector<HTMLElement>('[aria-label="Color stop 1"]')!.click());
      expect(editor().querySelector('[aria-label="Color midpoint 1"]')).toBeNull();
    });
    it("applies a preset from the arrow beside the swatch, with its saved midpoints",async()=>{
      usePhotoWorkspace.setState({state:{presets:{gradient:{name:"Custom",stops:[],transparency:[]},styles:[],gradients:[{name:"Basics",presets:[{name:"Red, Green",stops:[[0,"#ff0000"],[.4,"#00ff00"],[1,"#0000ff"]],transparency:[[0,100],[1,50]],midpoints:[.3,.7]}]}]}} as never});
      await open();await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Gradient presets"]')!.click());
      await act(async()=>button("Basics",host).click());await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Red, Green"]')!.click());
      await submit();expect(native.run).toHaveBeenLastCalledWith("gradient.fill.set",{layer:1,stops:[[0,"#ff0000"],[.4,"#00ff00"],[1,"#0000ff"]],transparency:[[0,100],[1,50]],midpoints:[.3,.7]});
    });
    it("bakes the Method into the stops and reopens a baked gradient with its Method",async()=>{
      await open();expect(container.querySelector<HTMLSelectElement>('select[aria-label="Fill gradient method"]')!.value).toBe("classic");
      await select("Fill gradient method","perceptual");await submit();
      const sent=native.run.mock.calls.at(-1)![1] as {stops:[number,string][];midpoints:number[]};
      expect(sent.stops).toEqual(bakeGradient([[0,"#000000"],[1,"#ffffff"]],"perceptual"));expect(sent.midpoints).toEqual([]);
      native.run.mockClear();await open({...gradient,stops:bakeRemembered([[0,"#ff0000"],[1,"#0000ff"]],"linear")!,midpoints:[]});
      expect(container.querySelector<HTMLSelectElement>('select[aria-label="Fill gradient method"]')!.value).toBe("linear");
      await select("Fill gradient method","classic");await submit();
      expect(native.run).toHaveBeenLastCalledWith("gradient.fill.set",{layer:1,stops:[[0,"#ff0000"],[1,"#0000ff"]],midpoints:[]});
    });
  });
});
