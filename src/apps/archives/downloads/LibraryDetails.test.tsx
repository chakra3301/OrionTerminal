// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rename:vi.fn(), toggleFavorite:vi.fn(), clipboard:vi.fn() }));
vi.mock("@/store/assetsStore", () => ({ useAssetsStore:{getState:()=>m} }));
import { LibraryDetails } from "./LibraryDetails";
import type { Asset } from "@/store/assetsStore";
const asset:Asset={id:"saved",kind:"audio",title:"Saved audio",filePath:"/private/owned.m4a",mimeType:"audio/mp4",sizeBytes:1024,originalName:"source.m4a",createdAt:1,tags:["music"],favorite:false,sourceUrl:"https://example.com/song"};
let host:HTMLDivElement,root:Root;
beforeEach(async()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();m.rename.mockResolvedValue(undefined);m.toggleFavorite.mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:m.clipboard}});host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root.render(<LibraryDetails asset={asset}/>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const button=(text:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent===text)!;
it("renders without changing library or accessing a source",()=>{expect(m.rename).not.toHaveBeenCalled();expect(m.toggleFavorite).not.toHaveBeenCalled();expect(m.clipboard).not.toHaveBeenCalled();});
it("saves an explicit library title and keeps source filenames out of mutation",async()=>{await act(async()=>{const input=host.querySelector("input")!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"My song");input.dispatchEvent(new Event("input",{bubbles:true}));});await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));expect(m.rename).toHaveBeenCalledExactlyOnceWith("saved","My song");expect(host.textContent).toContain("Original filename kept");expect(host.textContent).toContain("source.m4a");});
it("favorites and source copying are explicit",async()=>{await act(async()=>button("Favorite").click());expect(m.toggleFavorite).toHaveBeenCalledWith("saved");await act(async()=>button("Copy source link").click());expect(m.clipboard).toHaveBeenCalledWith("https://example.com/song");});
it("does not offer copying arbitrary schemes or embedded credentials",async()=>{for(const sourceUrl of ["file:///private/media","https://name:password@example.com/file"]){await act(async()=>root.render(<LibraryDetails asset={{...asset,sourceUrl}}/>));expect(button("Copy source link")).toBeUndefined();}m.toggleFavorite.mockRejectedValueOnce(new Error("Database unavailable"));await act(async()=>button("Favorite").click());expect(host.textContent).toContain("Database unavailable");});
