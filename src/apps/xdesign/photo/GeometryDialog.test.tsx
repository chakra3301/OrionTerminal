import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeometryDialog, geometryPoint, identityWarpMesh, movePlaneCorner, appendLiquifyPoint, MAX_LIQUIFY_POINTS } from "./GeometryDialog";
import { DevelopDialog } from "./DevelopDialog";
import { CurveEditor } from "./PhotoActionDialog";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument, PhotoLayer } from "./types";
import { xdesignActivityReason } from "../runtimeActivity";
const native=vi.hoisted(()=>({run:vi.fn(),invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>false,invoke:native.invoke,convertFileSrc:(path:string)=>path}));
vi.mock("./runtime",async original=>({...await original<typeof import("./runtime")>(),runPhotoCommand:native.run}));
const doc:PhotoDocument={id:"photo",version:"v1",name:"Image",width:100,height:100,previewWidth:100,previewHeight:100,bundlePath:"",previewPath:"image.png",originalPath:null};
const layer:PhotoLayer={id:1,name:"Pixels",kind:"Pixels",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false,bounds:[10,20,80,60]};
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);native.run.mockReset().mockResolvedValue({});native.invoke.mockReset();usePhotoWorkspace.setState({projectId:"project",busy:false,error:null});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
const button=(label:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent===label)!;
describe("interactive image geometry and develop controls",()=>{
  it("retains long Liquify stroke samples and reports overflow instead of truncating a gesture",()=>{
    const points:[number,number][]=Array.from({length:1024},(_,index)=>[index,0]);expect(appendLiquifyPoint(points,[1024,1])).toBe("added");expect(points.at(-1)).toEqual([1024,1]);expect(appendLiquifyPoint(points,[1024,1])).toBe("same");
    const full:[number,number][]=Array.from({length:MAX_LIQUIFY_POINTS},(_,index)=>[index,0]);expect(appendLiquifyPoint(full,[MAX_LIQUIFY_POINTS,0])).toBe("limit");expect(full).toHaveLength(MAX_LIQUIFY_POINTS);
  });
  it("maps letterboxed image coordinates, creates valid Bézier grids and links adjacent perspective corners",()=>{
    expect(geometryPoint(70,45,{left:10,top:20,width:200,height:100},100,100)).toEqual([10,25]);
    const mesh=identityWarpMesh([10,20,90,80],2);expect(mesh.points).toHaveLength(49);expect(mesh.us).toEqual([0,.5,1]);expect(mesh.points[0]).toEqual([10,20]);expect(mesh.points.at(-1)).toEqual([90,80]);
    const planes=[{src:[[0,0],[1,0],[1,1],[0,1]] as [number,number][],dst:[[0,0],[1,0],[1,1],[0,1]] as [number,number][]},{src:[[1,0],[2,0],[2,1],[1,1]] as [number,number][],dst:[[1,0],[2,0],[2,1],[1,1]] as [number,number][]}];
    const result=movePlaneCorner(planes,0,1,[1.2,-.2]);expect(result[0]?.dst[1]).toEqual([1.2,-.2]);expect(result[1]?.dst[0]).toEqual([1.2,-.2]);expect(planes[0]?.dst[1]).toEqual([1,0]);
  });
  it("nudges mesh points and applies one native warp with the complete mesh",async()=>{
    const close=vi.fn();await act(async()=>root.render(<GeometryDialog kind="warp" document={doc} layer={layer} close={close}/>));
    const point=container.querySelector('[aria-label="Warp point 1"]')!;
    await act(async()=>point.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",shiftKey:true,bubbles:true})));
    await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    expect(native.run).toHaveBeenCalledOnce();expect(native.run).toHaveBeenCalledWith("edit.transform.warp",expect.objectContaining({layer:1,style:"custom",rect:[10,20,90,80],mesh:expect.objectContaining({points:expect.arrayContaining([[20,20]])})}));expect(close).toHaveBeenCalledOnce();
  });
  it("cancels geometry changes without submitting an image edit",async()=>{
    const close=vi.fn();await act(async()=>root.render(<GeometryDialog kind="perspective" document={doc} layer={layer} close={close}/>));
    await act(async()=>container.querySelector('[aria-label="Plane 1 corner 1"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true})));
    await act(async()=>button("Cancel").click());expect(close).toHaveBeenCalledOnce();expect(native.run).not.toHaveBeenCalled();
  });
  it("applies structured develop controls through the native Camera Raw command",async()=>{
    await act(async()=>root.render(<DevelopDialog document={doc} layer={layer} close={()=>{}}/>));
    const input=container.querySelector<HTMLInputElement>('[aria-label="Develop exposure"]')!;
    await act(async()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;setter.call(input,"1.5");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    expect(native.run).toHaveBeenCalledWith("filter.cameraRaw",{layer:1,exposure:1.5});
  });
  it("edits the existing zoomed image canvas with inspector controls and rolls back cancelled drags",async()=>{
    const canvas=document.createElement('div');container.append(canvas);const close=vi.fn();
    // Portal target lives outside the React root, as the real image surface does.
    document.body.append(canvas);
    await act(async()=>root.render(<GeometryDialog kind="warp" document={doc} layer={layer} close={close} canvas={{element:canvas,zoom:2}}/>));
    expect(container.querySelector('.xd-photo-dialog-scrim')).toBeNull();expect(canvas.querySelector('image')).toBeNull();
    const svg=canvas.querySelector('svg')!,handle=canvas.querySelector('[aria-label="Warp point 1"]')!;
    svg.getBoundingClientRect=()=>({left:50,top:40,width:200,height:200} as DOMRect);svg.setPointerCapture=vi.fn();
    const pointer=(type:string,x:number,y:number)=>Object.assign(new MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0}),{pointerId:1});
    expect(handle.getAttribute('r')).toBe('2.5');
    await act(async()=>handle.dispatchEvent(pointer('pointerdown',70,80)));
    await act(async()=>svg.dispatchEvent(pointer('pointermove',110,120)));expect(handle.getAttribute('cx')).toBe('30');expect(handle.getAttribute('cy')).toBe('40');
    await act(async()=>svg.dispatchEvent(pointer('pointercancel',110,120)));expect(handle.getAttribute('cx')).toBe('10');expect(handle.getAttribute('cy')).toBe('20');
    await act(async()=>handle.dispatchEvent(pointer('pointerdown',70,80)));
    await act(async()=>svg.dispatchEvent(pointer('pointermove',110,120)));
    await act(async()=>svg.dispatchEvent(pointer('pointerup',110,120)));
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.run).toHaveBeenCalledOnce();expect(native.run).toHaveBeenCalledWith('edit.transform.warp',expect.objectContaining({mesh:expect.objectContaining({points:expect.arrayContaining([[30,40]])})}));
    await act(async()=>root.render(null));expect(canvas.children).toHaveLength(0);expect(xdesignActivityReason()).toBeNull();canvas.remove();
  });
  it.each(['liquify','puppet','perspective'] as const)("keeps %s gestures on the main image surface and applies once",async kind=>{
    const canvas=document.createElement('div');document.body.append(canvas);const close=vi.fn();
    await act(async()=>root.render(<GeometryDialog kind={kind} document={doc} layer={layer} close={close} canvas={{element:canvas,zoom:1}}/>));
    const svg=canvas.querySelector('svg')!;svg.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100} as DOMRect);svg.setPointerCapture=vi.fn();
    const pointer=(type:string,x:number,y:number)=>Object.assign(new MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0}),{pointerId:1});
    const target=kind==='perspective'?canvas.querySelector('[aria-label="Plane 1 corner 1"]')!:svg;
    await act(async()=>target.dispatchEvent(pointer('pointerdown',10,20)));
    await act(async()=>svg.dispatchEvent(pointer('pointermove',30,40)));
    await act(async()=>svg.dispatchEvent(pointer('pointerup',30,40)));
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.run).toHaveBeenCalledOnce();expect(native.run).toHaveBeenCalledWith(kind==='liquify'?'filter.liquify':kind==='puppet'?'edit.puppetWarp':'edit.perspectiveWarp',expect.objectContaining({layer:1}));
    expect(close).toHaveBeenCalledOnce();await act(async()=>root.render(null));canvas.remove();
  });
  it("closes a stale deformation without applying it to a newer version",async()=>{
    const close=vi.fn();await act(async()=>root.render(<GeometryDialog kind="warp" document={doc} layer={layer} close={close}/>));
    await act(async()=>root.render(<GeometryDialog kind="warp" document={{...doc,version:'v2'}} layer={layer} close={close}/>));
    expect(close).toHaveBeenCalledOnce();await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.run).not.toHaveBeenCalled();
  });
});

type CurvePoints = [number,number][];
function CurveFixture({initial,disabled=false,maxPoints,changed}:{initial:CurvePoints;disabled?:boolean;maxPoints?:number;changed:(points:CurvePoints)=>void}) {
  const [points,setPoints]=useState(initial);
  return <CurveEditor points={points} disabled={disabled} maxPoints={maxPoints} change={next=>{changed(next);setPoints(next);}}/>;
}
const curveStage=()=>container.querySelector<SVGSVGElement>('svg[aria-label="Develop point curve"],svg[aria-label="Adjustment curve"]')!;
function curveCapture(svg=curveStage()) {
  const captured=new Set<number>();
  svg.getBoundingClientRect=()=>({left:10,top:20,width:265,height:265} as DOMRect);
  svg.setPointerCapture=vi.fn(id=>{captured.add(id);});
  svg.hasPointerCapture=vi.fn(id=>captured.has(id));
  svg.releasePointerCapture=vi.fn(id=>{captured.delete(id);});
  return svg;
}
const curvePointer=(type:string,x:number,y:number,id=11,init:MouseEventInit={})=>Object.assign(new MouseEvent(type,{bubbles:true,button:0,clientX:15+x,clientY:280-y,...init}),{pointerId:id});
const pointEvent=(target:Element,type:string,x:number,y:number,id=11,init:MouseEventInit={})=>act(async()=>{target.dispatchEvent(curvePointer(type,x,y,id,init));});
const curveData=()=>[...curveStage().querySelectorAll('[data-curve-index]')].map(point=>{const [x,y]=point.getAttribute('transform')!.slice(10,-1).split(',').map(Number);return [x!,255-y!];});
const editCurveNumber=(label:string,value:string)=>act(async()=>{const input=container.querySelector<HTMLInputElement>(`[aria-label="Curve ${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
const chooseCurve=(label:string,value:string)=>act(async()=>{const select=container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});
const curveKey=(index:number,key:string,shiftKey=false)=>act(async()=>{container.querySelector(`[aria-label="Curve point ${index+1}"]`)!.dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true}));});
async function addCurvePoint(x:number,y:number) {const svg=curveCapture();await pointEvent(svg,'pointerdown',x,y);await pointEvent(svg,'pointerup',x,y);}
const previewBox=()=>[...container.querySelectorAll('.xd-ps-dialog-buttons label')].find(label=>label.textContent==='Preview')!.querySelector('input')!;
const preview=async()=>{if(previewBox().checked)await act(async()=>previewBox().click());await act(async()=>previewBox().click());};
async function develop(close=vi.fn(),document=doc,selectedLayer=layer) {
  await act(async()=>root.render(<DevelopDialog document={document} layer={selectedLayer} close={close}/>));
  if(previewBox().checked)await act(async()=>previewBox().click());
  return close;
}
function nativeCurveValid(points:CurvePoints) {
  const inputs=Float32Array.from(points,point=>point[0]);
  const differences=Float32Array.from(inputs.slice(1),(value,index)=>value-inputs[index]!);
  expect([...inputs].every(value=>Number.isFinite(value)&&value>=0&&value<=255)).toBe(true);
  expect([...differences].every(value=>value>=1)).toBe(true);
  expect(points.every(point=>Number.isFinite(point[1])&&point[1]>=0&&point[1]<=255)).toBe(true);
}

const splitInput=(index:number,slider=false)=>container.querySelector<HTMLInputElement>(`[aria-label="Develop curveSplit${index}${slider?' slider':''}"]`)!;
const splitValues=()=>[0,1,2].map(index=>splitInput(index).valueAsNumber);
const editDevelopNumber=(label:string,value:string)=>act(async()=>{const input=container.querySelector<HTMLInputElement>(`[aria-label="Develop ${label}"]`)!;input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.blur();});

describe('Camera Raw parametric region boundaries',()=>{
  it('shows native defaults without adding split parameters to an untouched Apply',async()=>{
    await develop();expect(splitValues()).toEqual([25,50,75]);
    expect(splitInput(0).min).toBe('5');expect(splitInput(2).max).toBe('95');
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.run).toHaveBeenCalledWith('filter.cameraRaw',{layer:1});
  });

  it('keeps finite ordered integer boundaries within the host range through numeric and slider edits',async()=>{
    await develop();await editDevelopNumber('curveSplit0','1000');expect(splitValues()).toEqual([49,50,75]);
    await editDevelopNumber('curveSplit1','-100');expect(splitValues()).toEqual([49,50,75]);
    await editDevelopNumber('curveSplit2','-100');expect(splitValues()).toEqual([49,50,51]);
    await editDevelopNumber('curveSplit0','-100');expect(splitValues()).toEqual([5,50,51]);
    await editDevelopNumber('curveSplit2','1000');expect(splitValues()).toEqual([5,50,95]);
    await editDevelopNumber('curveSplit1','45.4');expect(splitValues()).toEqual([5,45,95]);
    await editDevelopNumber('curveSplit1','');await editDevelopNumber('curveSplit1','Infinity');expect(splitValues()).toEqual([5,45,95]);
    await editDevelopNumber('curveSplit0 slider','15');await editDevelopNumber('curveSplit2 slider','85');expect(splitValues()).toEqual([15,45,85]);
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.run).toHaveBeenCalledWith('filter.cameraRaw',{layer:1,curveSplits:[15,45,85]});
  });

  it('allows multi-keystroke numeric drafts and restores blank or nonfinite entries on blur',async()=>{
    await develop();const input=splitInput(0);
    const type=(value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>input.focus());await type('4');expect(input.value).toBe('4');expect(splitInput(0,true).valueAsNumber).toBe(25);
    await type('40');expect(input.value).toBe('40');expect(splitInput(0,true).valueAsNumber).toBe(25);
    await act(async()=>input.blur());expect(splitValues()).toEqual([40,50,75]);expect(splitInput(0,true).valueAsNumber).toBe(40);
    for(const text of ['', 'Infinity']){await act(async()=>input.focus());await type(text);expect(input.value).toBe('');await act(async()=>input.blur());expect(input.value).toBe('40');}
    await act(async()=>input.focus());await type('1000');expect(input.value).toBe('1000');expect(splitInput(0,true).valueAsNumber).toBe(40);
    await act(async()=>input.blur());expect(input.value).toBe('49');
    await act(async()=>input.focus());await type('35');await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
    expect(splitValues()).toEqual([35,50,75]);expect(splitInput(0,true).valueAsNumber).toBe(35);expect(native.run).not.toHaveBeenCalled();
  });

  it('previews and applies the identical full tuple once, with point curves and tonal amounts retained',async()=>{
    vi.useFakeTimers();vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:develop-splits');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    native.invoke.mockResolvedValue({width:100,height:100,png:'AA=='});const close=await develop();
    await chooseCurve('Develop curve channel','pointCurveRed');await addCurvePoint(100,140);await editDevelopNumber('curveLights','30');
    await editDevelopNumber('curveSplit0','15');await editDevelopNumber('curveSplit1','45');await editDevelopNumber('curveSplit2','85');
    const expected={layer:1,pointCurveRed:[[0,0],[100,140],[255,255]],curveLights:30,curveSplits:[15,45,85]};
    await preview();
    const previews=native.invoke.mock.calls.filter(([command])=>command==='xdesign_photo_command_preview');expect(previews).toHaveLength(1);expect(previews[0]![1]).toMatchObject({command:'filter.cameraRaw',params:expected});
    let complete!:(value:unknown)=>void;native.run.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    await act(async()=>{const form=container.querySelector('form')!;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    expect(native.run).toHaveBeenCalledOnce();expect(native.run).toHaveBeenCalledWith('filter.cameraRaw',expected);expect([0,1,2].every(i=>splitInput(i).disabled&&splitInput(i,true).disabled)).toBe(true);
    await act(async()=>complete({}));expect(close).toHaveBeenCalledOnce();
  });

  it('resets only split parameters while retaining tonal amounts and channel curves',async()=>{
    await develop();
    await editDevelopNumber('curveShadows','20');await chooseCurve('Develop curve channel','pointCurveBlue');await addCurvePoint(128,160);
    await editDevelopNumber('curveSplit0','15');await act(async()=>button('Reset region boundaries').click());expect(splitValues()).toEqual([25,50,75]);expect(curveData()).toEqual([[0,0],[128,160],[255,255]]);
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.run).toHaveBeenCalledWith('filter.cameraRaw',{layer:1,curveShadows:20,pointCurveBlue:[[0,0],[128,160],[255,255]]});
  });

  it('keeps Cancel, busy and stale-source split controls inert without changing the source',async()=>{
    const close=await develop(),saved=JSON.stringify([doc,layer]);await editDevelopNumber('curveSplit0','15');
    await act(async()=>{usePhotoWorkspace.setState({busy:true});});await editDevelopNumber('curveSplit0','10');expect(splitValues()).toEqual([15,50,75]);expect(button('Reset region boundaries').disabled).toBe(true);
    await act(async()=>{usePhotoWorkspace.setState({busy:false});});
    await act(async()=>button('Cancel').click());expect(close).toHaveBeenCalledOnce();expect(native.run).not.toHaveBeenCalled();expect(JSON.stringify([doc,layer])).toBe(saved);
    await act(async()=>root.render(null));
    await develop(close);await editDevelopNumber('curveSplit0','15');
    await act(async()=>root.render(<DevelopDialog document={{...doc,version:'v2'}} layer={layer} close={close}/>));
    await editDevelopNumber('curveSplit0','10');expect(splitValues()).toEqual([15,50,75]);expect(splitInput(0).disabled).toBe(true);
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(native.run).not.toHaveBeenCalled();
  });
});

function rawEditLayer(params:Record<string,unknown>):PhotoLayer {
  return {...layer,smartObject:{source:'embedded',name:'source.pcraft',hasFilterMask:true,filterMaskEnabled:true},smartFilters:[{command:'filter.other.offset',params:{horizontal:2},visible:false,opacity:.5,blend:'Multiply'},{command:'filter.cameraRaw',params,visible:true,opacity:.75,blend:'Normal'}]};
}
async function existingRaw(params:Record<string,unknown>,close=vi.fn()) {
  const selected=rawEditLayer(params),existing={index:1,command:'filter.cameraRaw',params:structuredClone(params)};
  await act(async()=>root.render(<DevelopDialog document={doc} layer={selected} existing={existing} close={close}/>));
  if(previewBox().checked)await act(async()=>previewBox().click());
  return {selected,existing,close};
}

const scalarInput=(key:string)=>container.querySelector<HTMLInputElement>(`[aria-label="Develop ${key}"]`)!;
const invalidDevelopFields=()=>[...container.querySelectorAll<HTMLInputElement>('input')].filter(input=>!input.checkValidity()).map(input=>({label:input.getAttribute('aria-label'),type:input.type,value:input.value,min:input.min,max:input.max,step:input.step,stepMismatch:input.validity.stepMismatch}));
async function scalarDraft(key:string,text:string) {
  const input=scalarInput(key);await act(async()=>{input.closest('details')?.setAttribute('open','');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));});return input;
}
async function altReset() {
  await act(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Alt',altKey:true}));});
  await act(async()=>{const target=button('Reset');target.focus();target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,altKey:true}));});
  await act(async()=>{window.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt'}));});
}
async function developAction(label:string) {
  const target=label==='Preview'?previewBox():button(label),down=new MouseEvent('mousedown',{bubbles:true,cancelable:true});
  await act(async()=>{target.dispatchEvent(down);if(!down.defaultPrevented)target.focus();});await act(async()=>{target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));target.click();});return down;
}

describe('Develop scalar numeric drafts',()=>{
  it.each([
    ['exposure','-1.25',{exposure:-1.25}],['curveLights','-12.5',{curveLights:-12.5}],['sharpenRadius','2.25',{sharpenRadius:2.25}],['grainAmount','12.5',{grainAmount:12.5}],['hslHue-0','-12.5',{hslHue:[-12.5,0,0,0,0,0,0,0]}],['lum','-22.5',{gradeShadows:{hue:0,sat:0,lum:-22.5}}]
  ] as const)('keeps %s clearable and commits the complete fractional value once on Enter',async(key,text,expected)=>{
    await develop();let input=await scalarDraft(key,'');expect(input.value).toBe('');input=await scalarDraft(key,text.startsWith('-')?'-':'2');expect(input.value).toBe(text.startsWith('-')?'':'2');if(text.startsWith('-')){input=await scalarDraft(key,'-1');expect(input.value).toBe('-1');}input=await scalarDraft(key,text);expect(input.value).toBe(text);expect(native.run).not.toHaveBeenCalled();expect(native.invoke).not.toHaveBeenCalled();
    const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});await act(async()=>input.dispatchEvent(enter));expect(enter.defaultPrevented).toBe(true);expect(native.run).not.toHaveBeenCalled();expect(input.value).toBe(text);expect(input.step).toBe('any');expect(invalidDevelopFields()).toEqual([]);const slider=scalarInput(`${key} slider`),step=Number(slider.step);expect(step).toBe(key==='exposure'||key==='sharpenRadius' ? .1 : 1);expect(Math.abs(slider.valueAsNumber-Number(text))).toBeLessThanOrEqual(step/2+1e-12);await developAction('OK');expect(native.run).toHaveBeenCalledOnce();expect(native.run).toHaveBeenCalledWith('filter.cameraRaw',{layer:1,...expected});
  });

  it('restores blank, nonfinite, overflow and out-of-range drafts without adding untouched defaults',async()=>{
    await develop();let input=scalarInput('exposure');await act(async()=>{input.focus();input.blur();});for(const [key,text,restored]of [['exposure','','0'],['exposure','Infinity','0'],['exposure','1e300','0'],['exposure','5.01','0'],['sharpenRadius','.49','1'],['grainAmount','-1','0'],['hue','361','0']]){input=await scalarDraft(key!,text!);await act(async()=>input.blur());expect(input.value).toBe(restored);}
    input=await scalarDraft('contrast','0');await act(async()=>input.blur());input=await scalarDraft('exposure','8');await developAction('OK');expect(input.value).toBe('0');expect(native.run).toHaveBeenCalledWith('filter.cameraRaw',{layer:1});
  });

  it('retains untouched legacy out-of-range scalars and unknown nested data while editing another control',async()=>{
    const params={exposure:50,contrast:-140,gradeShadows:{hue:400,vendor:{keep:7}},vendor:{data:[1,2]}},before=structuredClone(params);await existingRaw(params);const legacy=scalarInput('exposure');await act(async()=>{legacy.focus();legacy.blur();});await scalarDraft('exposure','51');await act(async()=>legacy.blur());expect(legacy.value).toBe('50');await scalarDraft('lum','-15.5');await developAction('OK');expect(native.run).toHaveBeenCalledWith('layer.smartFilter.setParams',{layer:1,index:1,params:{...before,gradeShadows:{hue:400,sat:0,lum:-15.5,vendor:{keep:7}}}});expect(params).toEqual(before);
  });

  it.each([false,true])('flushes a focused draft into identical Preview and once-only Apply payloads (existing=%s)',async(existing)=>{
    vi.useFakeTimers();vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:scalar-draft');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});native.invoke.mockResolvedValue({width:100,height:100,png:'AA=='});const original={vendor:{nested:[1,2]},gradeShadows:{hue:20,vendor:'kept'}};if(existing)await existingRaw(original);else await develop();const before=JSON.stringify(original),input=await scalarDraft('exposure','-1.25');
    await developAction('Preview');expect(input.value).toBe('-1.25');const previews=native.invoke.mock.calls.filter(([id])=>id==='xdesign_photo_command_preview');expect(previews).toHaveLength(1);const command=existing?'layer.smartFilter.setParams':'filter.cameraRaw',expected=existing?{layer:1,index:1,params:{...original,exposure:-1.25}}:{layer:1,exposure:-1.25};expect(previews[0]![1]).toMatchObject({command,params:expected});
    let complete!:(value:unknown)=>void;native.run.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));await developAction('OK');expect(native.run).toHaveBeenCalledOnce();await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(native.run).toHaveBeenCalledOnce();expect(native.run).toHaveBeenCalledWith(command,expected);expect(button('OK').disabled).toBe(true);expect(JSON.stringify(original)).toBe(before);await act(async()=>complete({}));
  });

  it.each([false,true])('applies a still-focused last draft through the actual button (existing=%s)',async(existing)=>{
    if(existing)await existingRaw({exposure:.5,vendor:{keep:true}});else await develop();const input=await scalarDraft('contrast','-25.5');await developAction('OK');expect(native.run).toHaveBeenCalledOnce();expect(native.run).toHaveBeenCalledWith(existing?'layer.smartFilter.setParams':'filter.cameraRaw',existing?{layer:1,index:1,params:{exposure:.5,vendor:{keep:true},contrast:-25.5}}:{layer:1,contrast:-25.5});expect(input.value).toBe('-25.5');
  });

  it.each([false,true])('discards focused drafts on Alt-Reset and Cancel while Alt-Reset restores the opening values (existing=%s)',async(existing)=>{
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:scalar-reset');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});native.invoke.mockResolvedValue({width:100,height:100,png:'AA=='});const close=vi.fn(),original={exposure:.5,curveSplits:[15,45,85],gradeShadows:{hue:20,vendor:'kept'},vendor:{keep:true}};if(existing)await existingRaw(original,close);else await develop(close);
    await scalarDraft('exposure','-2.5');await altReset();expect(scalarInput('exposure').value).toBe(existing?'0.5':'0');await scalarDraft('exposure','-3.5');await developAction('Reset region boundaries');expect(scalarInput('exposure').value).toBe(existing?'0.5':'0');expect(splitValues()).toEqual([25,50,75]);
    await scalarDraft('exposure','-4.5');await developAction('Preview');const preview=native.invoke.mock.calls.find(([id])=>id==='xdesign_photo_command_preview')!;expect(preview[1]).toMatchObject({params:existing?{layer:1,index:1,params:expect.objectContaining({exposure:-4.5,curveSplits:[25,50,75],vendor:{keep:true},gradeShadows:{hue:20,vendor:'kept'}})}:{layer:1,exposure:-4.5}});
    await scalarDraft('exposure','-1.5');await developAction('Cancel');expect(close).toHaveBeenCalledOnce();expect(native.run).not.toHaveBeenCalled();expect(original.exposure).toBe(.5);
  });

  it('keeps sliders live and discards late HSL or grading drafts after changing the actual channel',async()=>{
    await develop();let input=await scalarDraft('exposure','-2.5');const slider=scalarInput('exposure slider');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'1.5');slider.dispatchEvent(new Event('input',{bubbles:true}));});expect(input.value).toBe('1.5');
    const oldHSL=await scalarDraft('hslHue-0','37.5');await chooseCurve('Develop HSL control','hslSat');await act(async()=>oldHSL.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));await editDevelopNumber('hslSat-1','-10.5');input=await scalarDraft('hue','75.5');await chooseCurve('Develop grading range','gradeHighlights');await act(async()=>input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));expect(scalarInput('hue').value).toBe('0');await scalarDraft('lum','-15.5');await developAction('OK');expect(native.run).toHaveBeenCalledWith('filter.cameraRaw',{layer:1,exposure:1.5,hslSat:[0,-10.5,0,0,0,0,0,0],gradeHighlights:{hue:0,sat:0,lum:-15.5}});
  });

  it.each(['busy','project','version'])('discards a pending scalar after a %s lifecycle change',async(change)=>{
    const {selected,existing,close}=await existingRaw({exposure:.5,vendor:{keep:true}});const input=await scalarDraft('exposure','-2.5');if(change==='version')await act(async()=>root.render(<DevelopDialog document={{...doc,version:'v2'}} layer={selected} existing={existing} close={close}/>));else await act(async()=>usePhotoWorkspace.setState(change==='busy'?{busy:true}:{projectId:'other'}));expect(input.disabled).toBe(true);expect(input.value).toBe('0.5');await act(async()=>input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));expect(native.run).not.toHaveBeenCalled();if(change==='busy'){await act(async()=>usePhotoWorkspace.setState({busy:false}));await developAction('OK');expect(native.run).toHaveBeenCalledWith('layer.smartFilter.setParams',{layer:1,index:1,params:{exposure:.5,vendor:{keep:true}}});}else{await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(native.run).not.toHaveBeenCalled();expect(close).toHaveBeenCalled();}
  });

  it('unlocks after native refusal and permits a corrected draft without mutating saved parameters',async()=>{
    const params={exposure:.5,vendor:{keep:true}},before=structuredClone(params);await existingRaw(params);native.run.mockRejectedValueOnce(new Error('native refusal'));await scalarDraft('exposure','-1.25');await developAction('OK');expect(button('OK').disabled).toBe(false);expect(native.run).toHaveBeenLastCalledWith('layer.smartFilter.setParams',{layer:1,index:1,params:{...before,exposure:-1.25}});await scalarDraft('exposure','-2.25');await developAction('OK');expect(native.run).toHaveBeenCalledTimes(2);expect(native.run).toHaveBeenLastCalledWith('layer.smartFilter.setParams',{layer:1,index:1,params:{...before,exposure:-2.25}});expect(params).toEqual(before);
  });
});

describe('existing Camera Raw Smart Filter editing',()=>{
  it('previews and applies one captured setParams draft with omitted controls available and unrelated JSON retained',async()=>{
    vi.useFakeTimers();vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:raw-edit');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});native.invoke.mockResolvedValue({width:100,height:100,png:'AA=='});
    const params={exposure:.5,pointCurveRed:[[0,0],[96,120],[255,255]],vendor:{nested:[1,{value:2}]}};
    const before=structuredClone(params),{selected,close}=await existingRaw(params);
    expect(container.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Edit Camera Raw Filter');expect(splitValues()).toEqual([25,50,75]);
    await chooseCurve('Develop curve channel','pointCurveRed');expect(curveData()).toEqual(params.pointCurveRed);await editCurveNumber('output','12');
    await editDevelopNumber('exposure','1.25');await editDevelopNumber('curveSplit0','15');
    const expected={layer:1,index:1,params:{...before,exposure:1.25,pointCurveRed:[[0,12],[96,120],[255,255]],curveSplits:[15,50,75]}};
    await preview();const previews=native.invoke.mock.calls.filter(([command])=>command==='xdesign_photo_command_preview');expect(previews).toHaveLength(1);expect(previews[0]![1]).toMatchObject({command:'layer.smartFilter.setParams',params:expected});
    let complete!:(value:unknown)=>void;native.run.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    await act(async()=>{const form=container.querySelector('form')!;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    expect(native.run).toHaveBeenCalledOnce();expect(native.run).toHaveBeenCalledWith('layer.smartFilter.setParams',expected);expect(previewBox().disabled).toBe(true);
    await preview();expect(native.invoke.mock.calls.filter(([command])=>command==='xdesign_photo_command_preview')).toHaveLength(1);expect(params).toEqual(before);expect(selected.smartFilters![0]).toMatchObject({command:'filter.other.offset',visible:false,opacity:.5,blend:'Multiply'});
    await act(async()=>complete({}));expect(close).toHaveBeenCalledOnce();
  });

  it('resets stored region splits explicitly and rejects blank, nonfinite and f32-overflow scalar edits',async()=>{
    const params={exposure:.75,curveSplits:[15,45,85],vendor:{keep:true}},before=structuredClone(params);await existingRaw(params);
    await editDevelopNumber('exposure','');await editDevelopNumber('exposure','Infinity');await editDevelopNumber('exposure','1e300');
    await chooseCurve('Develop HSL control','hslHue');await editDevelopNumber('hslHue-0','1e300');await editDevelopNumber('sat','1e300');
    await act(async()=>button('Reset region boundaries').click());expect(splitValues()).toEqual([25,50,75]);
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.run).toHaveBeenCalledWith('layer.smartFilter.setParams',{layer:1,index:1,params:{...before,curveSplits:[25,50,75]}});expect(params).toEqual(before);
  });

  it('supplies missing neutral wheel components while retaining nested imported keys during an edit',async()=>{
    const params={gradeShadows:{hue:20,vendor:{keep:7}}};await existingRaw(params);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Develop sat"]')!.valueAsNumber).toBe(0);expect(container.querySelector<HTMLInputElement>('[aria-label="Develop lum"]')!.valueAsNumber).toBe(0);
    await editDevelopNumber('lum','15');await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.run).toHaveBeenCalledWith('layer.smartFilter.setParams',{layer:1,index:1,params:{gradeShadows:{hue:20,sat:0,lum:15,vendor:{keep:7}}}});expect(params).toEqual({gradeShadows:{hue:20,vendor:{keep:7}}});
  });

  it('Alt-Reset restores the opening settings including unknown root and wheel data',async()=>{
    const params={exposure:2,curveSplits:[15,45,85],pointCurve:[[0,20],[255,230]],hslHue:[2,0,0,0,0,0,0,0],gradeShadows:{hue:20,vendor:'kept'},seed:42,pixelScale:.5,vendor:{data:[1,2]}};await existingRaw(params);
    await editDevelopNumber('exposure','-1');await chooseCurve('Develop HSL control','hslHue');await editDevelopNumber('hslHue-0','9');await altReset();
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.run).toHaveBeenCalledWith('layer.smartFilter.setParams',{layer:1,index:1,params});
  });

  it('preserves unchanged legacy curves and split ranges, and Cancel never sends an edit',async()=>{
    const params={pointCurve:[[-1,0],[0,30],[.5,255]],curveSplits:[95,5,5],gradeShadows:{hue:20},vendor:{keep:true}},before=structuredClone(params),{close}=await existingRaw(params);
    expect(container.querySelector<HTMLFormElement>('form')!.noValidate).toBe(true);expect(splitInput(0).disabled).toBe(true);expect(container.textContent).toContain('Stored boundaries are preserved');
    await editDevelopNumber('exposure','.5');await act(async()=>button('Cancel').click());expect(close).toHaveBeenCalledOnce();expect(native.run).not.toHaveBeenCalled();expect(params).toEqual(before);
  });

  it('submits a changed scalar through the actual Apply button without rewriting legacy curve inputs',async()=>{
    const params={pointCurve:[[-1,0],[0,30],[.5,255]],curveSplits:[95,5,5],vendor:{keep:true}};await existingRaw(params);
    await editDevelopNumber('exposure','.5');await act(async()=>button('OK').click());
    expect(native.run).toHaveBeenCalledWith('layer.smartFilter.setParams',{layer:1,index:1,params:{...params,exposure:.5}});
  });

  it.each(['project','document','version','layer','index','command','params'] as const)('refuses late Preview and Apply after the captured %s changes',async change=>{
    const {selected,existing,close}=await existingRaw({exposure:.5,vendor:{value:1}});await editDevelopNumber('exposure','1');
    const next=structuredClone(selected);let document=doc,edit=existing;
    if(change==='project')await act(async()=>usePhotoWorkspace.setState({projectId:'other'}));
    if(change==='document')document={...doc,id:'other'};
    if(change==='version')document={...doc,version:'v2'};
    if(change==='layer')next.id=2;
    if(change==='index')edit={...existing,index:0};
    if(change==='command')next.smartFilters![1]!.command='filter.lensCorrection';
    if(change==='params')next.smartFilters![1]!.params={exposure:.5,vendor:{value:2}};
    await act(async()=>root.render(<DevelopDialog document={document} layer={next} existing={edit} close={close}/>));expect(close).toHaveBeenCalled();expect(previewBox().disabled).toBe(true);
    await preview();await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.invoke).not.toHaveBeenCalled();expect(native.run).not.toHaveBeenCalled();
  });
});

describe('precise shared Camera Raw curves',()=>{
  it('keeps four channel curves independent and previews/applies the identical complete payload once',async()=>{
    vi.useFakeTimers();
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:develop-curve');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
    native.invoke.mockResolvedValue({width:100,height:100,png:'AA=='});
    const close=await develop();
    const expected:Record<string,unknown>={layer:1};
    for(const [channel,x,y] of [['pointCurve',64,80],['pointCurveRed',96,120],['pointCurveGreen',128,150],['pointCurveBlue',192,200]] as const){
      await chooseCurve('Develop curve channel',channel);await addCurvePoint(x,y);expected[channel]=[[0,0],[x,y],[255,255]];
    }
    await chooseCurve('Develop curve channel','pointCurve');expect(curveData()).toEqual(expected.pointCurve);
    await preview();
    const previews=native.invoke.mock.calls.filter(([command])=>command==='xdesign_photo_command_preview');
    expect(previews).toHaveLength(1);expect(previews[0]![1]).toMatchObject({command:'filter.cameraRaw',params:expected});
    let complete!:(value:unknown)=>void;
    native.run.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    await act(async()=>{const form=container.querySelector('form')!;form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    expect(native.run).toHaveBeenCalledOnce();expect(native.run).toHaveBeenCalledWith('filter.cameraRaw',expected);expect(close).not.toHaveBeenCalled();
    await act(async()=>complete({}));expect(close).toHaveBeenCalledOnce();
  });

  it('selects the actual dense handle and drags only that point instead of the first nearby input',async()=>{
    const changed=vi.fn(),initial:CurvePoints=[[0,0],[100.004,10],[101.004,220],[255,255]],saved=structuredClone(initial);
    await act(async()=>root.render(<CurveFixture initial={initial} changed={changed}/>));
    const svg=curveCapture(),handle=svg.querySelector('[aria-label="Curve point 3"]')!;
    await pointEvent(handle,'pointerdown',101.004,220);
    expect(handle.getAttribute('aria-pressed')).toBe('true');
    await pointEvent(svg,'pointermove',180,190);await pointEvent(svg,'pointerup',180,190);
    expect(changed).toHaveBeenLastCalledWith([[0,0],[100.004,10],[180,190],[255,255]]);
    expect(svg.releasePointerCapture).toHaveBeenCalledWith(11);
    const calls=changed.mock.calls.length;await pointEvent(svg,'pointermove',200,20);expect(changed).toHaveBeenCalledTimes(calls);
    expect(initial).toEqual(saved);
  });

  it('validates final binary32 neighbor gaps, keeps unchanged fractional data, and guards endpoint insertion',async()=>{
    const changed=vi.fn(),initial:CurvePoints=[[0,0],[100.004,20],[110.004,220],[255,255]];
    await act(async()=>root.render(<CurveFixture initial={initial} changed={changed} maxPoints={16}/>));
    await curveKey(2,'Enter');await editCurveNumber('input','0');
    let result=changed.mock.lastCall![0] as CurvePoints;nativeCurveValid(result);expect(result[1]).toEqual(initial[1]);expect(result[2]![0]).toBeGreaterThan(101);
    const selectedX=result[2]![0];await editCurveNumber('output','150.125');result=changed.mock.lastCall![0];expect(result[2]).toEqual([selectedX,150.125]);nativeCurveValid(result);
    await editCurveNumber('input','1000');result=changed.mock.lastCall![0];nativeCurveValid(result);expect(result[2]![0]).toBeLessThanOrEqual(254);
    await curveKey(0,'Enter');await editCurveNumber('input','-100');expect(changed.mock.lastCall![0][0][0]).toBe(0);
    const calls=changed.mock.calls.length;
    await addCurvePoint(.25,200);await addCurvePoint(254.75,20);expect(changed).toHaveBeenCalledTimes(calls);
    await addCurvePoint(1,100);result=changed.mock.lastCall![0];expect(result[1]).toEqual([1,100]);nativeCurveValid(result);
  });

  it('retains the grabbed handle offset at its edge and moves by the pointer displacement',async()=>{
    const changed=vi.fn();await act(async()=>root.render(<CurveFixture initial={[[0,0],[128,160],[255,255]]} changed={changed}/>));
    const svg=curveCapture();await pointEvent(svg.querySelector('[aria-label="Curve point 2"]')!,'pointerdown',130,158);
    await pointEvent(svg,'pointermove',130,158);expect(changed).not.toHaveBeenCalled();expect(curveData()).toEqual([[0,0],[128,160],[255,255]]);
    await pointEvent(svg,'pointermove',140,170);await pointEvent(svg,'pointerup',140,170);
    expect(changed).toHaveBeenLastCalledWith([[0,0],[138,172],[255,255]]);
  });

  it('supports finite numeric edits, arrows, Shift, and Delete, modifier-click and drag-off removal that keep the end points',async()=>{
    const changed=vi.fn();await act(async()=>root.render(<CurveFixture initial={[[0,0],[128,160],[255,255]]} changed={changed}/>));
    await curveKey(1,'Enter');await editCurveNumber('output','170');await curveKey(1,'ArrowUp',true);await curveKey(1,'ArrowRight');
    expect(changed).toHaveBeenLastCalledWith([[0,0],[129,180],[255,255]]);
    let calls=changed.mock.calls.length;await editCurveNumber('input','');await editCurveNumber('output','Infinity');expect(changed).toHaveBeenCalledTimes(calls);
    await editCurveNumber('output','1000');expect(changed.mock.lastCall![0][1][1]).toBe(255);
    await curveKey(1,'Delete');expect(curveData()).toEqual([[0,0],[255,255]]);calls=changed.mock.calls.length;
    await curveKey(0,'Backspace');expect(changed).toHaveBeenCalledTimes(calls);
    const svg=curveCapture();await pointEvent(svg.querySelector('[aria-label="Curve point 1"]')!,'pointerdown',0,0,11,{metaKey:true});expect(changed).toHaveBeenCalledTimes(calls);
    await addCurvePoint(96,120);await pointEvent(svg.querySelector('[aria-label="Curve point 2"]')!,'pointerdown',96,120,11,{metaKey:true});expect(curveData()).toEqual([[0,0],[255,255]]);
    await addCurvePoint(96,120);await pointEvent(svg.querySelector('[aria-label="Curve point 2"]')!,'pointerdown',96,120,11,{button:2});expect(curveData()).toEqual([[0,0],[255,255]]);
    await addCurvePoint(96,120);await pointEvent(svg.querySelector('[aria-label="Curve point 2"]')!,'pointerdown',96,120);
    await pointEvent(svg,'pointermove',96,300);expect(curveData()).toEqual([[0,0],[255,255]]);
    await pointEvent(svg,'pointermove',100,130);expect(curveData()).toEqual([[0,0],[100,130],[255,255]]);
    await pointEvent(svg,'pointermove',110,140);await pointEvent(svg,'pointerup',110,140);expect(changed).toHaveBeenLastCalledWith([[0,0],[110,140],[255,255]]);
  });

  it('caps actual RAW curves at sixteen while preserving the shared adjustment default of nineteen',async()=>{
    await develop();for(let index=0;index<14;index++)await addCurvePoint(8+index*16,120);
    expect(curveData()).toHaveLength(16);const raw=curveData();await addCurvePoint(240,120);expect(curveData()).toEqual(raw);
    await act(async()=>root.render(null));
    const changed=vi.fn();await act(async()=>root.render(<CurveFixture initial={[[0,0],[255,255]]} changed={changed}/>));
    for(let index=0;index<17;index++)await addCurvePoint(8+index*13,120);
    expect(curveData()).toHaveLength(19);const adjustment=curveData();await addCurvePoint(240,120);expect(curveData()).toEqual(adjustment);
  });

  it.each(['pointerup','pointercancel','lostpointercapture'])('finishes capture after %s and ignores other pointers and late movement',async end=>{
    const changed=vi.fn();await act(async()=>root.render(<CurveFixture initial={[[0,0],[128,160],[255,255]]} changed={changed}/>));
    const svg=curveCapture();await pointEvent(svg.querySelector('[aria-label="Curve point 2"]')!,'pointerdown',128,160);
    await pointEvent(svg,'pointermove',140,170,12);expect(changed).not.toHaveBeenCalled();
    await pointEvent(svg,'pointermove',140,170);expect(changed).toHaveBeenCalledOnce();
    await pointEvent(svg,end,140,170);await pointEvent(svg,'pointermove',180,220);expect(changed).toHaveBeenCalledOnce();
    expect(svg.releasePointerCapture).toHaveBeenCalledWith(11);
  });

  it('invalidates busy and channel captures and cancels without mutating the source image',async()=>{
    const original=JSON.stringify({doc,layer}),close=await develop();await addCurvePoint(100,120);
    let svg=curveCapture();await pointEvent(svg.querySelector('[aria-label="Curve point 2"]')!,'pointerdown',100,120);
    await act(async()=>usePhotoWorkspace.setState({busy:true}));expect(svg.releasePointerCapture).toHaveBeenCalledWith(11);
    await act(async()=>usePhotoWorkspace.setState({busy:false}));await pointEvent(svg,'pointermove',180,220);expect(curveData()).toEqual([[0,0],[100,120],[255,255]]);
    svg=curveCapture();await pointEvent(svg.querySelector('[aria-label="Curve point 2"]')!,'pointerdown',100,120);
    await chooseCurve('Develop curve channel','pointCurveRed');expect(svg.releasePointerCapture).toHaveBeenCalledWith(11);
    await pointEvent(svg,'pointermove',190,230);expect(curveData()).toEqual([[0,0],[255,255]]);
    await chooseCurve('Develop curve channel','pointCurve');expect(curveData()).toEqual([[0,0],[100,120],[255,255]]);
    await act(async()=>button('Cancel').click());expect(close).toHaveBeenCalledOnce();expect(native.run).not.toHaveBeenCalled();expect(JSON.stringify({doc,layer})).toBe(original);
  });

  it.each(['version','document','layer','project'])('blocks late curve movement and Apply after the %s source changes',async kind=>{
    const close=await develop();await addCurvePoint(100,120);const svg=curveCapture();await pointEvent(svg.querySelector('[aria-label="Curve point 2"]')!,'pointerdown',100,120);
    if(kind==='project')await act(async()=>usePhotoWorkspace.setState({projectId:'other-project'}));
    else await act(async()=>root.render(<DevelopDialog document={kind==='version'?{...doc,version:'v2'}:kind==='document'?{...doc,id:'other'}:doc} layer={kind==='layer'?{...layer,id:2}:layer} close={close}/>));
    expect(close).toHaveBeenCalledOnce();expect(svg.releasePointerCapture).toHaveBeenCalledWith(11);
    await pointEvent(svg,'pointermove',180,220);await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(native.run).not.toHaveBeenCalled();expect(button('OK').disabled).toBe(true);
  });
});
