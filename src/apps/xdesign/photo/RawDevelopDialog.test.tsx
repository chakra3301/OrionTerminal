import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RawDevelopDialog } from "./RawDevelopDialog";
import type { RawDevelopOptions } from "./runtime";

let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const mount=async(develop:(path:string,options:RawDevelopOptions)=>Promise<void>,close=vi.fn())=>{await act(async()=>root.render(<RawDevelopDialog path="/photos/shot.dng" close={close} develop={develop}/>));return close;};
const altReset=async()=>{await act(async()=>{window.dispatchEvent(new KeyboardEvent("keydown",{key:"Alt",altKey:true}));});await act(async()=>{[...container.querySelectorAll("button")].find(node=>node.textContent==="Reset")!.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,altKey:true}));});await act(async()=>{window.dispatchEvent(new KeyboardEvent("keyup",{key:"Alt"}));});};
const submit=async()=>act(async()=>{container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await Promise.resolve();});

describe("camera RAW import development",()=>{
  it("cancels before opening or placing a document",async()=>{const develop=vi.fn().mockResolvedValue(undefined),close=await mount(develop);await act(async()=>container.querySelector<HTMLButtonElement>('button[type="button"]')!.click());expect(close).toHaveBeenCalledOnce();expect(develop).not.toHaveBeenCalled();});
  it("passes bounded exposure/orientation choices and keeps them for retry after import failure",async()=>{
    let attempt=0;const develop=vi.fn(async(_path:string,_options:RawDevelopOptions)=>{if(attempt++===0)throw new Error("Decode failed");});const close=await mount(develop);
    await act(async()=>{const input=container.querySelector<HTMLInputElement>('[aria-label="RAW exposure"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"1.5");input.dispatchEvent(new Event("input",{bubbles:true}));container.querySelector<HTMLInputElement>('[aria-label="Apply camera orientation"]')!.click();});
    await submit();expect(develop).toHaveBeenNthCalledWith(1,"/photos/shot.dng",{exposure:1.5,orient:false});expect(container.textContent).toContain("Decode failed");expect(close).not.toHaveBeenCalled();
    await submit();expect(develop).toHaveBeenNthCalledWith(2,"/photos/shot.dng",{exposure:1.5,orient:false});expect(close).toHaveBeenCalledOnce();
  });
  it("allows negative decimal entry and rejects out-of-range values before native import",async()=>{
    const develop=vi.fn().mockResolvedValue(undefined),close=await mount(develop);const setValue=async(value:string)=>act(async()=>{const input=container.querySelector<HTMLInputElement>('[aria-label="RAW exposure"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});
    await setValue("8");await submit();expect(develop).not.toHaveBeenCalled();expect(container.textContent).toContain("between -5 and 5 EV");
    await setValue("-1.5");await submit();expect(develop).toHaveBeenCalledWith("/photos/shot.dng",{exposure:-1.5,orient:true});expect(close).toHaveBeenCalledOnce();
  });
  it("Alt-Reset restores the opening exposure and orientation",async()=>{
    const develop=vi.fn().mockResolvedValue(undefined);await mount(develop);
    await act(async()=>{const input=container.querySelector<HTMLInputElement>('[aria-label="RAW exposure"]')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"2");input.dispatchEvent(new Event("input",{bubbles:true}));container.querySelector<HTMLInputElement>('[aria-label="Apply camera orientation"]')!.click();});
    await altReset();await submit();expect(develop).toHaveBeenCalledWith("/photos/shot.dng",{exposure:0,orient:true});
  });
  it("allows only one in-flight native request and releases the guard after failure",async()=>{
    let reject!: (reason:Error)=>void;const develop=vi.fn().mockImplementationOnce(()=>new Promise<void>((_resolve,rejectRequest)=>{reject=rejectRequest;})).mockResolvedValueOnce(undefined);const close=await mount(develop);
    await submit();await submit();expect(develop).toHaveBeenCalledOnce();
    await act(async()=>{reject(new Error("Decode failed"));await Promise.resolve();});
    await submit();expect(develop).toHaveBeenCalledTimes(2);expect(close).toHaveBeenCalledOnce();
  });
});
