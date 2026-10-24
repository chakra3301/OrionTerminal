import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeStockProvider, assetInvoke, chooseStockProvider, clearAssetCache, clearConnection, connectionStatus, downloadStockPhoto, fetchIcons, iconPaths, iconPreview, notifyStockDownload, searchIcons, searchPhotos, setConnection } from "./assetService";
const ipc=vi.hoisted(()=>({invoke:vi.fn(),native:true}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>ipc.native,invoke:ipc.invoke}));
export const photo={sourceId:"photo1",provider:"unsplash" as const,url:"https://images.unsplash.com/photo1?x=1",thumbnail:"https://images.unsplash.com/photo1?w=200",page:"https://unsplash.com/photos/photo1",artist:"https://unsplash.com/@artist",photographer:"Artist",width:400,height:200};
const collection={prefix:"test",width:24,height:24,icons:{arrow:{body:'<path d="M0 0L24 0L24 12Z" fill="currentColor"/>'}},aliases:{rotated:{parent:"arrow",rotate:1}}};
beforeEach(()=>{ipc.native=true;ipc.invoke.mockReset();clearAssetCache();localStorage.clear();});afterEach(()=>vi.useRealTimers());
describe("native asset services",()=>{
  it("searches each query, batches by set, resolves alias transforms and reuses size-independent caches",async()=>{
    ipc.invoke.mockImplementation(async(command,args)=>{if(command==="xdesign_asset_request"){if(args.request.kind==="iconSearch")return{icons:["test:arrow","test:rotated"],total:2,collections:{}};if(args.request.kind==="iconInfo")return{info:{author:{name:"Author",url:"https://example.com"},license:{title:"MIT",url:"https://example.com/license"}}};return collection;}throw Error(command);});
    const found=await searchIcons(["arrow","arrow"],5,"test");expect(found.arrow!.total).toBe(2);const icons=await fetchIcons(["test:arrow","test:rotated","test:arrow"]);expect(icons.size).toBe(2);expect(icons.get("test:arrow")!.credit.license).toBe("MIT");const calls=ipc.invoke.mock.calls.length;expect((await fetchIcons(["test:arrow"])).size).toBe(1);expect(ipc.invoke).toHaveBeenCalledTimes(calls);expect(iconPaths(icons.get("test:arrow")!,48)!.width).toBe(48);expect(iconPaths(icons.get("test:rotated")!,24)!.paths[0]!.vectorNetwork.vertices).not.toEqual(iconPaths(icons.get("test:arrow")!,24)!.paths[0]!.vectorNetwork.vertices);expect(iconPreview(icons.get("test:arrow")!)).toContain("data:image/svg+xml");
  });
  it("validates service admission and rejects active SVG and malformed responses",async()=>{
    await expect(searchIcons([],5)).rejects.toThrow("1–16");await expect(fetchIcons(["../evil:x"])).rejects.toThrow("icon name");expect(ipc.invoke).not.toHaveBeenCalled();
    for(const body of ['<script>alert(1)</script>','<image href="https://evil.test"/>','<path onload="x" d="M0 0"/>']){clearAssetCache();ipc.invoke.mockImplementation(async(_command,args)=>args.request.kind==="iconInfo"?{}:{...collection,icons:{arrow:{body}}});await expect(fetchIcons(["test:arrow"])).rejects.toThrow("Unsupported");}
    ipc.invoke.mockResolvedValue({icons:[],total:-1});await expect(searchIcons(["heart"])).rejects.toThrow("response");
  });
  it("keeps credentials in the keychain command path and stores only provider preference locally",async()=>{
    ipc.invoke.mockImplementation(async(command,args)=>command==="provider_key_status"?args.keyRef.endsWith("pexels"):undefined);expect(await connectionStatus()).toEqual({pexels:true,unsplash:false});await setConnection("pexels"," fixture-key ");expect(ipc.invoke).toHaveBeenCalledWith("provider_key_set",{keyRef:"xdesign-stock-pexels",key:"fixture-key"});await clearConnection("pexels");chooseStockProvider("unsplash");expect(activeStockProvider()).toBe("unsplash");expect(Object.values(localStorage).join("")).not.toContain("fixture-key");
  });
  it("preserves photo links, gets checked bytes and triggers Unsplash downloads only on explicit use",async()=>{
    ipc.invoke.mockImplementation(async(command,args)=>command==="xdesign_stock_image"?{base64:btoa("PNG fixture"),width:12,height:8}:args.request.kind==="photos"?{photos:[photo]}:{});
    expect(await searchPhotos("unsplash","ocean","square")).toEqual([photo]);expect(ipc.invoke.mock.calls.some(([,args])=>args.request?.kind==="photoDownload")).toBe(false);expect((await downloadStockPhoto(photo)).bytes).toHaveLength(11);await notifyStockDownload(photo);expect(ipc.invoke).toHaveBeenCalledWith("xdesign_asset_request",{request:{kind:"photoDownload",source_id:"photo1"}});await notifyStockDownload({...photo,provider:"pexels"});expect(ipc.invoke.mock.calls.filter(([,args])=>args.request?.kind==="photoDownload")).toHaveLength(1);
  });
  it("rejects malformed photos and oversized dimensions and releases cancelled or timed-out replies",async()=>{
    ipc.invoke.mockResolvedValue({photos:[{...photo,url:"javascript:alert(1)"}]});await expect(searchPhotos("unsplash","ocean")).rejects.toThrow("link");ipc.invoke.mockResolvedValue({base64:"AA==",width:100000,height:100000});await expect(downloadStockPhoto(photo)).rejects.toThrow("oversized");
    let finish!:(value:unknown)=>void;ipc.invoke.mockImplementation(()=>new Promise(resolve=>finish=resolve));const abort=new AbortController(),pending=assetInvoke("xdesign_asset_request",{},abort.signal);abort.abort();await expect(pending).rejects.toThrow("cancelled");finish({});
    vi.useFakeTimers();const timeout=assetInvoke("xdesign_asset_request",{});const error=expect(timeout).rejects.toThrow("timed out");await vi.advanceTimersByTimeAsync(30_000);await error;
  });
  it("gives a desktop boundary error without exposing credentials in browser-only previews",async()=>{ipc.native=false;await expect(fetchIcons(["test:arrow"])).rejects.toThrow("desktop");expect(ipc.invoke).not.toHaveBeenCalled();});
});
