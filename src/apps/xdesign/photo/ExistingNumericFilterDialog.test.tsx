import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExistingNumericFilterDialog } from './ExistingNumericFilterDialog';
import { usePhotoWorkspace } from './runtime';
import type { PhotoDocument, PhotoLayer } from './types';

const native=vi.hoisted(()=>({run:vi.fn(),invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke,convertFileSrc:(path:string)=>path}));
vi.mock('./runtime',async original=>({...await original<typeof import('./runtime')>(),runPhotoCommand:native.run}));
const documentFixture:PhotoDocument={id:'photo',version:'v1',name:'Numeric source',width:64,height:48,previewWidth:64,previewHeight:48,previewPath:'committed.png',originalPath:null,bundlePath:''};
type Values=Record<string,unknown>;
// Defaults are literal pinned filters::params_for values; limits are the supported editor ranges.
const families=[
  {id:'filter.blur.gaussianBlur',label:'Gaussian Blur',defaults:{radius:1},fields:[['radius','Radius',0.1,1000,2.25]]},
  {id:'filter.blur.boxBlur',label:'Box Blur',defaults:{radius:1},fields:[['radius','Radius',1,2000,3.25]]},
  {id:'filter.blur.motionBlur',label:'Motion Blur',defaults:{angle:0,distance:10},fields:[['angle','Angle',-360,360,-12.75],['distance','Distance',1,2000,21.25]]},
  {id:'filter.blur.radialBlur',label:'Radial Blur',defaults:{amount:10,centerX:0.5,centerY:0.5,method:'spin'},fields:[['amount','Amount',1,100,21.25],['centerX','Center X',0,1,0.375],['centerY','Center Y',0,1,0.625]]},
  {id:'filter.blur.surfaceBlur',label:'Surface Blur',defaults:{radius:5,threshold:15},fields:[['radius','Radius',1,100,7.25],['threshold','Threshold',2,255,23.25]]},
  {id:'filter.sharpen.unsharpMask',label:'Unsharp Mask',defaults:{amount:50,radius:1,threshold:0},fields:[['amount','Amount',1,500,77.25],['radius','Radius',0.1,1000,2.25],['threshold','Threshold',0,255,13.25]]},
  {id:'filter.sharpen.smartSharpen',label:'Smart Sharpen',defaults:{amount:100,radius:1,reduceNoise:10},fields:[['amount','Amount',1,500,133.25],['radius','Radius',0.1,64,2.25],['reduceNoise','Reduce noise',0,100,23.25]]},
] as const;
type Family=typeof families[number];
function fixture(family:Family,supplied:Values={}) {
  const params=structuredClone(supplied),layer:PhotoLayer={id:4,name:'Captured Smart source',kind:'smart',visible:true,opacity:1,fill:1,blend:'Normal',clipped:false,hasMask:false,smartObject:{source:'linked',name:'donor.psb',hasFilterMask:true},smartFiltersEnabled:true,smartFilters:[{command:'filter.other.offset',params:{horizontal:17},visible:true,opacity:1,blend:'Normal'},{command:family.id,params,visible:false,opacity:0.75,blend:'Multiply'},{command:'filter.other.offset',params:{vertical:3},visible:true,opacity:1,blend:'Normal'}]};
  return {layer,existing:{index:1,command:family.id,params:structuredClone(params)},close:vi.fn()};
}
let host:HTMLDivElement,canvas:HTMLDivElement,root:Root,mountKey=0;
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);native.run.mockReset().mockResolvedValue({});native.invoke.mockReset().mockResolvedValue({width:1,height:1,png:'AA=='});usePhotoWorkspace.setState({projectId:'project',documentId:'photo',shapeId:'shape',source:'legacy',stateVersion:'v1',busy:false,error:null});let next=0;vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:numeric-${++next}`);vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});host=document.createElement('div');canvas=document.createElement('div');document.body.append(host,canvas);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();canvas.remove();vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===label||node.getAttribute('aria-label')===label)!;
const field=(label:string)=>host.querySelector<HTMLInputElement>(`input[type="number"][aria-label="${label}"]`)!;
const previewCalls=()=>native.invoke.mock.calls.filter(call=>call[0]==='xdesign_photo_command_preview'&&!call[1]?.cancel);
const previewBox=()=>[...host.querySelectorAll('.xd-ps-dialog-buttons label')].find(label=>label.textContent==='Preview')!.querySelector('input')!;
const preview=async()=>{if(!previewBox().checked)await act(async()=>previewBox().click());await act(async()=>{await vi.advanceTimersByTimeAsync(300);});};
const altReset=async()=>{await act(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Alt',altKey:true}));});await act(async()=>{button('Reset').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,altKey:true}));});await act(async()=>{window.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt'}));});};
async function click(label:string){await act(async()=>{button(label).focus();button(label).click();});}
async function type(label:string,value:string){await act(async()=>{const input=field(label);input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
async function number(label:string,value:string){await type(label,value);await act(async()=>field(label).blur());}
async function mount(family:Family,params:Values={},document=documentFixture){const props=fixture(family,params),key=++mountKey;await act(async()=>root.render(<ExistingNumericFilterDialog key={key} document={document} canvas={canvas} {...props}/>));if(previewBox().checked)await act(async()=>previewBox().click());return {...props,key};}

it.each(families)('shows every native $label default without writing omitted fields, and Alt-Reset restores the opening settings',async family=>{
  const original={vendor:{nested:[null,{keep:true}]},legacy:['unchanged']},props=await mount(family,original),before=structuredClone(props.layer);
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(`Edit ${family.label} Filter`);
  expect(host.textContent).toContain('The full image preview keeps its current visibility.');
  for(const [key,label]of family.fields)expect(field(label).value).toBe(String(family.defaults[key as keyof typeof family.defaults]));
  if(family.id==='filter.blur.radialBlur')expect(host.querySelector<HTMLSelectElement>('[aria-label="Method"]')!.value).toBe('spin');
  await preview();expect(previewCalls().at(-1)![1].params).toEqual({layer:4,index:1,params:original});expect(native.run).not.toHaveBeenCalled();
  const [key,label,,,value]=family.fields[0];await number(label,String(value));await preview();expect(previewCalls().at(-1)![1].params).toEqual({layer:4,index:1,params:{...original,[key]:value}});
  await altReset();expect(field(label).value).toBe(String(family.defaults[key as keyof typeof family.defaults]));await preview();expect(previewCalls().at(-1)![1].params).toEqual({layer:4,index:1,params:original});await click('OK');
  expect(native.run).toHaveBeenCalledExactlyOnceWith('layer.smartFilter.setParams',{layer:4,index:1,params:original});expect(props.layer).toEqual(before);expect(props.close).toHaveBeenCalledOnce();
});

it.each(families)('edits all $label numeric fields fractionally and applies exactly the last preview payload once',async family=>{
  const initial={vendor:{keep:[1,2]},...(family.id==='filter.blur.radialBlur'?{method:'zoom'}:{})},props=await mount(family,initial),source=structuredClone(props.layer),expected:Values={...initial};
  for(const [key,label,,,value]of family.fields){await number(label,String(value));expected[key]=value;}
  if(family.id==='filter.blur.radialBlur'){await act(async()=>{const method=host.querySelector<HTMLSelectElement>('[aria-label="Method"]')!;method.value='spin';method.dispatchEvent(new Event('change',{bubbles:true}));});expected.method='spin';}
  expect(native.run).not.toHaveBeenCalled();await preview();const payload=previewCalls().at(-1)![1].params;expect(payload).toEqual({layer:4,index:1,params:expected});
  let finish!:(value:unknown)=>void;native.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await act(async()=>{button('OK').click();host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(native.run).toHaveBeenCalledExactlyOnceWith('layer.smartFilter.setParams',payload);expect(props.layer).toEqual(source);
  await act(async()=>finish({}));expect(props.close).toHaveBeenCalledOnce();
});

it('preserves empty and partial imports on untouched Apply, including unknown legacy option values',async()=>{
  for(const [family,params]of [[families[0],{}],[families[0],{radius:'legacy-number',vendor:{keep:[null,2]}}],[families[2],{distance:25,vendor:{angle:'unrelated'}}],[families[3],{method:'legacy-method',centerX:7,opaque:{keep:[1,2]}}]] as const){
    const props=await mount(family,params),before=structuredClone(props.layer);native.run.mockClear();await click('OK');expect(native.run).toHaveBeenCalledExactlyOnceWith('layer.smartFilter.setParams',{layer:4,index:1,params});expect(props.layer).toEqual(before);
  }
});

it('allows real clearing and negative multi-keystroke input, blocks invalid prefixes, and flushes a focused Apply',async()=>{
  await mount(families[2],{vendor:'preserve'});
  for(const value of ['','-','-1','-12.75']){await type('Angle',value);expect(field('Angle').value).toBe(value==='-'?'':value);if(value===''||value==='-'){expect(button('OK').disabled).toBe(true);expect(previewBox().disabled).toBe(true);}expect(native.run).not.toHaveBeenCalled();}
  expect(native.run).not.toHaveBeenCalled();await preview();expect(previewCalls().at(-1)![1].params.params).toEqual({vendor:'preserve',angle:-12.75});
  await type('Distance','32.25');await click('OK');expect(native.run).toHaveBeenCalledExactlyOnceWith('layer.smartFilter.setParams',{layer:4,index:1,params:{vendor:'preserve',angle:-12.75,distance:32.25}});
});

it.each(['','-1','1001','1e39'])('keeps invalid Gaussian draft %j visible and blocks it without changing imported legacy fields',async value=>{
  const original={radius:2.5,vendor:{raw:[1,'x']}},props=await mount(families[0],original);await number('Radius',value);expect(field('Radius').value).toBe(value);expect(field('Radius').getAttribute('aria-invalid')).toBe('true');expect(previewBox().disabled).toBe(true);expect(button('OK').disabled).toBe(true);
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(native.run).not.toHaveBeenCalled();expect(previewCalls()).toHaveLength(0);
  await number('Radius','2.5');await preview();expect(previewCalls().at(-1)![1].params.params).toEqual(original);await click('Cancel');expect(native.run).not.toHaveBeenCalled();expect(props.existing.params).toEqual(original);
});

it('keeps an untouched out-of-range legacy scalar while another native scalar is repaired',async()=>{
  const original={amount:900,radius:3,threshold:4,vendor:{keep:true}};await mount(families[5],original);await number('Radius','4.25');await click('OK');expect(native.run).toHaveBeenCalledExactlyOnceWith('layer.smartFilter.setParams',{layer:4,index:1,params:{...original,radius:4.25}});
});

it('accepts exact endpoints and restores each changed out-of-range native field independently',async()=>{
  for(const family of families){await mount(family);native.run.mockClear();const expected:Values={};for(const [key,label,min,max]of family.fields){await number(label,String(min));expect(button('OK').disabled).toBe(false);await number(label,String(max));expect(button('OK').disabled).toBe(false);await number(label,String(max+1));expect(button('OK').disabled).toBe(true);await number(label,String(max));expected[key]=max;}await click('OK');expect(native.run).toHaveBeenCalledExactlyOnceWith('layer.smartFilter.setParams',{layer:4,index:1,params:expected});}
});

it.each(['project','document','version','dimensions','layer','index','command','params','workspace-document','workspace-shape','workspace-source','workspace-version'] as const)('refuses focused late numeric/preview/Apply events after the captured %s changes',async change=>{
  const props=await mount(families[0],{radius:3}),source=structuredClone(props.layer);await type('Radius','7.25');const oldInput=field('Radius');let document=documentFixture,layer=structuredClone(props.layer),existing=props.existing;
  if(change==='project')await act(async()=>usePhotoWorkspace.setState({projectId:'other'}));if(change==='document')document={...document,id:'other'};if(change==='version')document={...document,version:'v2'};if(change==='dimensions')document={...document,width:65};if(change==='layer')layer.id=9;if(change==='index')existing={...existing,index:0};if(change==='command')layer.smartFilters![1]!.command='filter.blur.boxBlur';if(change==='params')layer.smartFilters![1]!.params={radius:4};
  if(change==='workspace-document')await act(async()=>usePhotoWorkspace.setState({documentId:'other'}));if(change==='workspace-shape')await act(async()=>usePhotoWorkspace.setState({shapeId:'other'}));if(change==='workspace-source')await act(async()=>usePhotoWorkspace.setState({source:'pencil'}));if(change==='workspace-version')await act(async()=>usePhotoWorkspace.setState({stateVersion:'v2'}));
  await act(async()=>root.render(<ExistingNumericFilterDialog key={props.key} document={document} layer={layer} existing={existing} close={props.close}/>));
  expect(props.close).toHaveBeenCalled();await act(async()=>{oldInput.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(native.run).not.toHaveBeenCalled();expect(previewCalls()).toHaveLength(0);expect(props.layer).toEqual(source);
});

it('rejects late commits while busy and Cancel discards several accepted draft edits',async()=>{
  const props=await mount(families[6],{vendor:{keep:[1]}}),before=structuredClone(props.layer);await number('Amount','112.5');
  await act(async()=>usePhotoWorkspace.setState({busy:true}));await type('Radius','4.5');await act(async()=>field('Radius').dispatchEvent(new FocusEvent('focusout',{bubbles:true})));expect(button('OK').disabled).toBe(true);
  await act(async()=>usePhotoWorkspace.setState({busy:false}));await preview();expect(previewCalls().at(-1)![1].params.params).toEqual({vendor:{keep:[1]},amount:112.5});await click('Cancel');expect(native.run).not.toHaveBeenCalled();expect(props.layer).toEqual(before);expect(props.close).toHaveBeenCalledOnce();
});

it('discards a focused dirty scalar on Alt-Reset and keeps the opening values in Preview and Apply',async()=>{
  await mount(families[2],{angle:75,distance:100,vendor:{keep:'reset'}});await type('Angle','-22.25');await altReset();await preview();const payload={layer:4,index:1,params:{angle:75,distance:100,vendor:{keep:'reset'}}};expect(previewCalls().at(-1)![1].params).toEqual(payload);await click('OK');expect(native.run).toHaveBeenCalledExactlyOnceWith('layer.smartFilter.setParams',payload);
});

it('reports preview and Apply refusal honestly, allows retry, and ignores success after context replacement',async()=>{
  const props=await mount(families[0],{radius:2});native.invoke.mockRejectedValueOnce(new Error('source unavailable'));await act(async()=>previewBox().click());expect(host.textContent).toContain('source unavailable');expect(native.run).not.toHaveBeenCalled();await act(async()=>previewBox().click());await preview();expect(canvas.querySelector('img.xd-photo-canvas-preview')!.getAttribute('src')).toMatch(/^blob:numeric-/);expect(host.querySelector('img')).toBeNull();
  native.run.mockRejectedValueOnce(new Error('native refusal'));await number('Radius','3.25');await click('OK');expect(host.textContent).toContain('native refusal');expect(button('OK').disabled).toBe(false);expect(props.close).not.toHaveBeenCalled();
  let finish!:(value:unknown)=>void;native.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click('OK');await act(async()=>usePhotoWorkspace.setState({projectId:'other'}));const closes=props.close.mock.calls.length;await act(async()=>finish({}));expect(props.close).toHaveBeenCalledTimes(closes);expect(native.run).toHaveBeenCalledTimes(2);
});

it('keeps numeric Apply available when preview is over the existing preview-area limit',async()=>{
  await mount(families[1],{}, {...documentFixture,width:5000,height:4000});expect(previewBox().disabled).toBe(true);await number('Radius','12.25');await click('OK');expect(native.run).toHaveBeenCalledExactlyOnceWith('layer.smartFilter.setParams',{layer:4,index:1,params:{radius:12.25}});expect(previewCalls()).toHaveLength(0);
});

it.each([{params:null},{params:[]},{params:37},{params:'legacy scalar'}])('preserves nonobject imported params $params without throwing, previewing, or coercing them into an Apply',async({params})=>{
  const props=fixture(families[0],params as unknown as Values),before=structuredClone(props.layer),existing=structuredClone(props.existing);
  await act(async()=>root.render(<ExistingNumericFilterDialog document={documentFixture} {...props}/>));
  const apply=button('OK');if(apply)expect(apply.disabled).toBe(true);
  await act(async()=>{host.querySelector('form')?.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await act(async()=>vi.advanceTimersByTime(1000));expect(native.run).not.toHaveBeenCalled();expect(previewCalls()).toHaveLength(0);expect(props.layer).toEqual(before);expect(props.existing).toEqual(existing);
});

it('cancels an owned numeric preview on Cancel and ignores both late success and late refusal while the parent retains the modal',async()=>{
  for(const outcome of ['success','refusal'] as const){
    native.invoke.mockClear();let finish!:(value:unknown)=>void,fail!:(error:Error)=>void;
    native.invoke.mockImplementationOnce(()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;}));
    const props=await mount(families[0],{radius:2.5,vendor:{keep:true}}),before=structuredClone(props.layer);await preview();const request=previewCalls().at(-1)![1];expect(request.requestId).toEqual(expect.any(String));
    await click('Cancel');expect(props.close).toHaveBeenCalledOnce();expect(native.invoke).toHaveBeenCalledWith('xdesign_photo_command_preview',{projectId:'project',photoId:'photo',version:'v1',command:'layer.smartFilter.setParams',params:{},requestId:request.requestId,cancel:true});
    await act(async()=>{if(outcome==='success')finish({width:1,height:1,png:'AA=='});else fail(new Error('obsolete numeric refusal'));});
    expect(URL.createObjectURL).not.toHaveBeenCalled();expect(host.textContent).not.toContain('obsolete numeric refusal');expect(canvas.querySelector('img')).toBeNull();expect(props.close).toHaveBeenCalledOnce();
    await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(native.run).not.toHaveBeenCalled();expect(props.layer).toEqual(before);
  }
});
