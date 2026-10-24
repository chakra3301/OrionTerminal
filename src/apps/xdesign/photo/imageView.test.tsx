import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasImageView, imageEditTarget, useImageViewPreview } from "./imageView";
import type { PhotoDocument, PhotoState } from "./types";

const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>true,invoke:native.invoke}));
const doc:PhotoDocument={id:"photo",version:"version",name:"PSD",width:800,height:600,previewWidth:800,previewHeight:600,bundlePath:"",previewPath:"",originalPath:null};
const base:PhotoState={name:"PSD",width:800,height:600,mode:"RGB",depth:8,resolution:72,activeLayer:1,hasSelection:false,selectionBounds:null,layers:[],canUndo:false,canRedo:false,
  channels:{composite:"RGB",compositeVisible:true,colors:["Red","Green","Blue"].map(name=>({name,visible:true})),alpha:[],target:{kind:"composite"}},viewKey:"composite"};
const isolated=(key:string):PhotoState=>({...base,viewKey:key,channels:{...base.channels!,colors:[{name:"Red",visible:true},{name:"Green",visible:false},{name:"Blue",visible:false}],target:{kind:"color",index:0}}});
let root:Root,container:HTMLDivElement,create:ReturnType<typeof vi.fn>,revoke:ReturnType<typeof vi.fn>;
function Preview({state,document=doc}:{state:PhotoState;document?:PhotoDocument}) {
  const preview=useImageViewPreview(document,"project",state);
  return <div data-url={preview.url??""} data-error={preview.error??""}><button onClick={preview.retry}>Retry</button></div>;
}
const render=async(state:PhotoState,document=doc)=>act(async()=>root.render(<Preview state={state} document={document}/>));
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);native.invoke.mockReset();
  const taskCreateURL=vi.fn((_object:Blob|MediaSource)=>`blob:${create.mock.calls.length}`),taskRevokeURL=vi.fn((_url:string)=>{});
  create=taskCreateURL;revoke=taskRevokeURL;
  vi.stubGlobal("URL",class extends URL {
    static override createObjectURL(object:Blob|MediaSource):string{return taskCreateURL(object);}
    static override revokeObjectURL(url:string):void{taskRevokeURL(url);}
  });
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe("isolated image view previews",()=>{
  it("renders and releases saved proof or HDR views on the same document version", async () => {
    const proof: PhotoState = { ...base, viewKey: "proof-1", colorView: { profile: "coated-cmyk", description: "CMYK", kind: "profile", intent: "relative", bpc: true, simulatePaper: false, on: true, gamutWarning: false, threshold: 0, hdr: { highlightCompression: false, exposure: 0, gamma: 1 }, active: true } };
    expect(hasImageView(proof)).toBe(true); native.invoke.mockResolvedValue({ width: 800, height: 600, png: "AA==" }); await render(proof); expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_view_preview", expect.objectContaining({ viewKey: "proof-1" }));
    await render({ ...proof, viewKey: "hdr-1", colorView: { ...proof.colorView!, on: false, hdr: { highlightCompression: false, exposure: -2, gamma: 1 } } }); expect(revoke).toHaveBeenCalledWith("blob:1"); expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_view_preview", expect.objectContaining({ viewKey: "hdr-1" }));
    await render({ ...proof, colorView: { ...proof.colorView!, active: false } }); expect(revoke).toHaveBeenCalledWith("blob:2"); expect(container.querySelector('[data-url]')!.getAttribute("data-url")).toBe("");
  });
  it("identifies color, alpha, Quick Mask and layer-mask views with the correct paint target",()=>{
    expect(hasImageView(base)).toBe(false);expect(hasImageView(isolated("red"))).toBe(true);
    expect(imageEditTarget(isolated("red"),false)).toBe("Red channel");
    const alpha={...base,channels:{...base.channels!,alpha:[{index:0,name:"Cutout",spot:null,visible:true}],target:{kind:"alpha" as const,index:0}}};
    expect(hasImageView(alpha)).toBe(true);expect(imageEditTarget(alpha,false)).toBe("Cutout");
    expect(imageEditTarget({...base,quickMask:true},false)).toBe("Quick Mask");
    expect(imageEditTarget({...base,layerMaskView:{layer:1,mode:"gray"}},false)).toBe("Layer mask");
  });
  it("drops delayed pixels from a previous view even when the document version stays the same",async()=>{
    const pending:((value:unknown)=>void)[]=[];native.invoke.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
    await render(isolated("red"));await render(isolated("green"));
    await act(async()=>pending[0]!({width:800,height:600,png:"AA=="}));
    expect(create).not.toHaveBeenCalled();expect(container.querySelector("[data-url]")!.getAttribute("data-url")).toBe("");
    await act(async()=>pending[1]!({width:800,height:600,png:"AA=="}));
    expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_view_preview",{projectId:"project",photoId:"photo",version:"version",viewKey:"green"});
    expect(container.querySelector("[data-url]")!.getAttribute("data-url")).toBe("blob:1");
  });
  it("revokes old previews on composite/undo/close and never reuses a revoked URL",async()=>{
    native.invoke.mockResolvedValue({width:800,height:600,png:"AA=="});await render(isolated("red"));
    await render(base);expect(revoke).toHaveBeenCalledWith("blob:1");
    native.invoke.mockReturnValue(new Promise(()=>{}));await render(isolated("red"));
    expect(container.querySelector("[data-url]")!.getAttribute("data-url")).toBe("");
    native.invoke.mockResolvedValue({width:800,height:600,png:"AA=="});await render(isolated("red"),{...doc,version:"undo-version"});
    expect(native.invoke).toHaveBeenLastCalledWith("xdesign_photo_view_preview",expect.objectContaining({version:"undo-version"}));
    await render(base);expect(revoke).toHaveBeenCalledWith("blob:2");
  });
  it("reports a failed preview, supports explicit retry and validates native dimensions",async()=>{
    native.invoke.mockResolvedValueOnce({width:3000,height:1,png:"AA=="}).mockResolvedValue({width:800,height:600,png:"AA=="});
    await render(isolated("red"));expect(container.querySelector("[data-error]")!.getAttribute("data-error")).toContain("invalid dimensions");
    expect(create).not.toHaveBeenCalled();await act(async()=>container.querySelector("button")!.click());
    expect(container.querySelector("[data-url]")!.getAttribute("data-url")).toBe("blob:1");
  });
});
