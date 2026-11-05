import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PhotoDocument, PhotoLayer } from "./types";

const runtime=vi.hoisted(()=>({run:vi.fn(async()=>undefined as unknown),busy:false,projectId:'project' as string|null}));
const editor=vi.hoisted(()=>({render:vi.fn(),lens:vi.fn(),blur:vi.fn(),numeric:vi.fn()}));
vi.mock("./DevelopDialog",()=>({DevelopDialog:(props:unknown)=>{editor.render(props);return <div role="dialog" aria-label="Captured Camera Raw edit"/>;}}));
vi.mock("./ExistingLensFilterDialog",()=>({ExistingLensFilterDialog:(props:unknown)=>{editor.lens(props);return <div role="dialog" aria-label="Captured lens edit"/>;}}));
vi.mock("./ExistingBlurFilterDialog",()=>({EXISTING_BLUR_ACTIONS:[['fieldBlur','Field Blur'],['irisBlur','Iris Blur'],['tiltShift','Tilt-Shift'],['spinBlur','Spin Blur'],['pathBlur','Path Blur']].map(([id,label])=>({id:`filter.blurGallery.${id}`,label})),ExistingBlurFilterDialog:(props:unknown)=>{editor.blur(props);return <div role="dialog" aria-label="Captured blur edit"/>;}}));
vi.mock("./ExistingNumericFilterDialog",()=>({EXISTING_NUMERIC_ACTIONS:[['filter.blur.gaussianBlur','Gaussian Blur'],['filter.blur.boxBlur','Box Blur'],['filter.blur.motionBlur','Motion Blur'],['filter.blur.radialBlur','Radial Blur'],['filter.blur.surfaceBlur','Surface Blur'],['filter.sharpen.unsharpMask','Unsharp Mask'],['filter.sharpen.smartSharpen','Smart Sharpen']].map(([id,label])=>({id,label})),ExistingNumericFilterDialog:(props:unknown)=>{editor.numeric(props);return <div role="dialog" aria-label="Captured numeric edit"/>;}}));
vi.mock("./runtime",()=>({runPhotoCommand:runtime.run,controlsLocked:(state:{busy:boolean;quiet?:boolean})=>state.busy&&!state.quiet,usePhotoWorkspace:(selector:(state:{busy:boolean;projectId:string|null})=>unknown)=>selector({busy:runtime.busy,projectId:runtime.projectId}),openSmartContents:vi.fn()}));
import { SmartFilters } from "./SmartFilters";

let container:HTMLDivElement,root:Root;
const layer=(hasFilterMask:boolean,filterMaskEnabled:boolean):PhotoLayer=>({id:4,name:"Smart layer",kind:"smart",visible:true,opacity:1,fill:1,blend:"Normal",clipped:false,hasMask:false,smartObject:{source:"embedded",name:"image.psd",hasFilterMask,filterMaskEnabled},smartFilters:[]});
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);runtime.run.mockReset().mockResolvedValue(undefined);editor.render.mockClear();editor.lens.mockClear();editor.blur.mockClear();editor.numeric.mockClear();runtime.busy=false;runtime.projectId='project';container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});

it("separates a smart filter's blend modes into Photoshop's groups",async()=>{
  await act(async()=>root.render(<SmartFilters layer={editableLayer()}/>));
  expect([...container.querySelector('[aria-label="Smart filter 1 blend"]')!.querySelectorAll("hr")].map(hr=>hr.nextElementSibling!.textContent)).toEqual(["Darken","Lighten","Overlay","Difference","Hue"]);
});
it.each([[true,"enabled",true,false],[false,"disabled",false,true]] as const)("reports the filter mask as %s and sends the desired inverse state",async(enabled,label,pressed,next)=>{
  act(()=>root.render(<SmartFilters layer={layer(true,enabled)}/>));
  const button=container.querySelector<HTMLButtonElement>('[aria-label="Smart filter mask"]')!;
  expect(button.textContent).toContain(label);expect(button.getAttribute("aria-pressed")).toBe(String(pressed));
  await act(async()=>button.click());expect(runtime.run).toHaveBeenCalledWith("layer.smartFilter.disableFilterMask",{layer:4,enabled:next});
});

it("distinguishes an absent mask and keeps the state control disabled while busy",()=>{
  act(()=>root.render(<SmartFilters layer={layer(false,false)}/>));
  expect(container.textContent).toContain("No filter mask");expect(container.querySelector('[aria-label="Smart filter mask"]')).toBeNull();
  act(()=>root.render(<SmartFilters layer={layer(true,true)}/>));
  runtime.busy=true;act(()=>root.render(<SmartFilters layer={layer(true,true)}/>));
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Smart filter mask"]')!.disabled).toBe(true);
});

it("keeps a legacy mask with unknown enabled state distinct and uses its compatible toggle",async()=>{
  const legacy=layer(true,false);delete legacy.smartObject!.filterMaskEnabled;
  act(()=>root.render(<SmartFilters layer={legacy}/>));
  const button=container.querySelector<HTMLButtonElement>('[aria-label="Smart filter mask"]')!;
  expect(button.textContent).toContain("state unknown");expect(button.hasAttribute("aria-pressed")).toBe(false);
  await act(async()=>button.click());expect(runtime.run).toHaveBeenCalledWith("layer.smartFilter.disableFilterMask",{layer:4});
});

const documentFixture:PhotoDocument={id:'photo',version:'v1',name:'Image',width:100,height:100,previewWidth:100,previewHeight:100,bundlePath:'',previewPath:'image.png',originalPath:null};
const editableLayer=():PhotoLayer=>({...layer(true,true),smartFilters:[{command:'filter.other.offset',params:{horizontal:2},visible:false,opacity:.5,blend:'Multiply'},{command:'filter.cameraRaw',params:{exposure:.5,curveSplits:[15,45,85],vendor:{values:[1,2]}},visible:true,opacity:.75,blend:'Normal'}]});
const editButton=()=>container.querySelector<HTMLButtonElement>('[aria-label="Edit Camera Raw filter 2"]')!;

it.each([['fieldBlur','Field Blur'],['irisBlur','Iris Blur'],['tiltShift','Tilt-Shift'],['spinBlur','Spin Blur'],['pathBlur','Path Blur']])('opens a captured professional %s editor instead of immediate generic parameter edits',async(command,label)=>{
  const selected=editableLayer();selected.smartFilters![1]!.command=`filter.blurGallery.${command}`;selected.smartFilters![1]!.params={blur:15,vendor:{data:[1,2]}};const source=structuredClone(selected);
  await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));await act(async()=>container.querySelector<HTMLButtonElement>(`[aria-label="Edit ${label} filter 2"]`)!.click());
  const props=editor.blur.mock.lastCall![0] as {existing:{index:number;command:string;params:{vendor:{data:number[]}}};close:()=>void};expect(props.existing).toEqual({index:1,command:`filter.blurGallery.${command}`,params:source.smartFilters![1]!.params});props.existing.params.vendor.data.push(3);expect(selected).toEqual(source);await act(async()=>props.close());expect(container.querySelector('[role="dialog"]')).toBeNull();expect(runtime.run).not.toHaveBeenCalled();
});

it('closes captured Blur Gallery editing after source replacement and leaves unrelated filters generic',async()=>{
  const selected=editableLayer();selected.smartFilters![1]!.command='filter.blurGallery.fieldBlur';await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Edit Field Blur filter 2"]')!.click());expect(editor.blur).toHaveBeenCalled();
  const next=structuredClone(selected);next.smartFilters![1]!.params={blur:27};await act(async()=>root.render(<SmartFilters layer={next} document={documentFixture}/>));expect(container.querySelector('[role="dialog"]')).toBeNull();expect(container.querySelector('[aria-label="Edit offset filter 1"]')).toBeNull();expect(runtime.run).not.toHaveBeenCalled();
});

it('captures a deep draft of one existing Camera Raw filter and Cancel sends no command',async()=>{
  const selected=editableLayer(),before=structuredClone(selected);await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));
  await act(async()=>editButton().click());expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  const props=editor.render.mock.lastCall![0] as {document:PhotoDocument;layer:PhotoLayer;existing:{index:number;command:string;params:Record<string,unknown>};close:()=>void};
  expect(props.document).toBe(documentFixture);expect(props.layer).toBe(selected);expect(props.existing).toEqual({index:1,command:'filter.cameraRaw',params:before.smartFilters![1]!.params});
  ((props.existing.params.vendor as {values:number[]}).values).push(3);expect(selected).toEqual(before);
  await act(async()=>props.close());expect(container.querySelector('[role="dialog"]')).toBeNull();expect(runtime.run).not.toHaveBeenCalled();
});

it.each(['project','document','version','layer','index','command','params'] as const)('discards an existing RAW modal when its captured %s changes',async change=>{
  const selected=editableLayer();let document=documentFixture;await act(async()=>root.render(<SmartFilters layer={selected} document={document}/>));await act(async()=>editButton().click());
  const next=structuredClone(selected);
  if(change==='project')runtime.projectId='other';
  if(change==='document')document={...document,id:'other'};
  if(change==='version')document={...document,version:'v2'};
  if(change==='layer')next.id=5;
  if(change==='index')next.smartFilters!.reverse();
  if(change==='command')next.smartFilters![1]!.command='filter.cameraRaw.changed';
  if(change==='params')next.smartFilters![1]!.params={...next.smartFilters![1]!.params,exposure:1};
  await act(async()=>root.render(<SmartFilters layer={next} document={document}/>));expect(container.querySelector('[role="dialog"]')).toBeNull();expect(runtime.run).not.toHaveBeenCalled();
});

it('preserves direct callers without a document and disables RAW editing without ready context',async()=>{
  const selected=editableLayer();await act(async()=>root.render(<SmartFilters layer={selected}/>));expect(editButton()).toBeNull();expect(container.querySelector('[aria-label="Exposure"]')).not.toBeNull();
  runtime.busy=true;await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));expect(editButton().disabled).toBe(true);await act(async()=>editButton().click());expect(editor.render).not.toHaveBeenCalled();
  runtime.busy=false;runtime.projectId=null;await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));expect(editButton().disabled).toBe(true);
});

it.each([['filter.lensCorrection','Lens Correction'],['filter.adaptiveWideAngle','Adaptive Wide Angle']])('routes captured %s edits to the source-aware geometry dialog',async(command,label)=>{
  const selected=editableLayer();selected.smartFilters![1]!.command=command!;const before=structuredClone(selected);
  await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));await act(async()=>container.querySelector<HTMLButtonElement>(`[aria-label="Edit ${label} filter 2"]`)!.click());
  expect(editor.render).not.toHaveBeenCalled();const props=editor.lens.mock.lastCall![0] as {existing:{index:number;command:string;params:Record<string,unknown>};close:()=>void};
  expect(props.existing).toEqual({index:1,command,params:before.smartFilters![1]!.params});expect(props.existing.params).not.toBe(selected.smartFilters![1]!.params);
  await act(async()=>props.close());expect(container.querySelector('[role="dialog"]')).toBeNull();expect(selected).toEqual(before);expect(runtime.run).not.toHaveBeenCalled();
});

it.each([['filter.blur.gaussianBlur','Gaussian Blur'],['filter.blur.boxBlur','Box Blur'],['filter.blur.motionBlur','Motion Blur'],['filter.blur.radialBlur','Radial Blur'],['filter.blur.surfaceBlur','Surface Blur'],['filter.sharpen.unsharpMask','Unsharp Mask'],['filter.sharpen.smartSharpen','Smart Sharpen']])('opens captured %s numeric editing with a deep draft and no immediate command',async(command,label)=>{
  const selected=editableLayer();selected.smartFilters![1]!.command=command!;selected.smartFilters![1]!.params={vendor:{keep:[1,2]},...(command==='filter.blur.radialBlur'?{method:'zoom',centerX:.25}:{})};const before=structuredClone(selected);
  await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));await act(async()=>container.querySelector<HTMLButtonElement>(`[aria-label="Edit ${label} filter 2"]`)!.click());
  const props=editor.numeric.mock.lastCall![0] as {document:PhotoDocument;layer:PhotoLayer;existing:{index:number;command:string;params:{vendor:{keep:number[]}}};close:()=>void};
  expect(props.document).toBe(documentFixture);expect(props.layer).toBe(selected);expect(props.existing).toEqual({index:1,command,params:before.smartFilters![1]!.params});props.existing.params.vendor.keep.push(3);expect(selected).toEqual(before);expect(runtime.run).not.toHaveBeenCalled();expect(editor.render).not.toHaveBeenCalled();expect(editor.blur).not.toHaveBeenCalled();expect(editor.lens).not.toHaveBeenCalled();
  await act(async()=>props.close());expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('retires captured numeric editing after selected filter replacement without changing the imported stack',async()=>{
  const selected=editableLayer();selected.smartFilters![1]!.command='filter.blur.gaussianBlur';const before=structuredClone(selected);
  await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Edit Gaussian Blur filter 2"]')!.click());expect(editor.numeric).toHaveBeenCalledOnce();
  const next=structuredClone(selected);next.smartFilters![1]!.params={radius:7.25,vendor:{changed:true}};await act(async()=>root.render(<SmartFilters layer={next} document={documentFixture}/>));expect(container.querySelector('[role="dialog"]')).toBeNull();expect(selected).toEqual(before);expect(runtime.run).not.toHaveBeenCalled();
});

it('preserves generic numeric fallback without a document and disables modal entry while busy or unscoped',async()=>{
  const selected=editableLayer();selected.smartFilters![1]!.command='filter.blur.gaussianBlur';selected.smartFilters![1]!.params={radius:2.5};
  await act(async()=>root.render(<SmartFilters layer={selected}/>));expect(container.querySelector('[aria-label="Edit Gaussian Blur filter 2"]')).toBeNull();expect(container.querySelector('[aria-label="Radius"]')).not.toBeNull();
  runtime.busy=true;await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));const button=container.querySelector<HTMLButtonElement>('[aria-label="Edit Gaussian Blur filter 2"]')!;expect(button.disabled).toBe(true);await act(async()=>button.click());expect(editor.numeric).not.toHaveBeenCalled();
  runtime.busy=false;runtime.projectId=null;await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));expect(container.querySelector<HTMLButtonElement>('[aria-label="Edit Gaussian Blur filter 2"]')!.disabled).toBe(true);expect(runtime.run).not.toHaveBeenCalled();
});

it.each([{params:null},{params:[]},{params:42},{params:'legacy scalar'}])('preserves numeric nonobject params $params without opening an editor or coercing a generic field',async({params})=>{
  const selected=editableLayer();selected.smartFilters![1]!.command='filter.blur.gaussianBlur';selected.smartFilters![1]!.params=params as unknown as Record<string,unknown>;const before=structuredClone(selected);
  await act(async()=>root.render(<SmartFilters layer={selected} document={documentFixture}/>));expect(container.querySelector('[aria-label="Edit Gaussian Blur filter 2"]')).toBeNull();expect(container.querySelector('[aria-label="Radius"]')).toBeNull();expect(container.querySelector('[role="dialog"]')).toBeNull();expect(editor.numeric).not.toHaveBeenCalled();expect(runtime.run).not.toHaveBeenCalled();expect(selected).toEqual(before);
});
