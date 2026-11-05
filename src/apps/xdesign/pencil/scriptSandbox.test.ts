import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareScriptDocument, runIsolatedScript } from "./scriptSandbox";
import { SCRIPT_CHANNEL, SCRIPT_VERSION } from "./scriptContract";
import integrity from "../../../../resources/preview-bootstrap-integrity.json";
const channels: Channel[]=[];
class Port{onmessage:((event:{data:unknown})=>void)|null=null;start=vi.fn();close=vi.fn();postMessage=vi.fn();}
class Channel{port1=new Port();port2=new Port();constructor(){channels.push(this);}}
const input={code:"42",graph:"draft",pageId:"page",selection:[]};
const frame=()=>document.querySelector<HTMLIFrameElement>('iframe[title="Isolated XDesign script"]')!;
const ready=(target=frame(),token="token",origin="null")=>window.dispatchEvent(new MessageEvent("message",{source:target.contentWindow,origin,data:{channel:SCRIPT_CHANNEL,version:SCRIPT_VERSION,token,type:"ready"}}));
const reply=(data:unknown)=>channels.at(-1)!.port1.onmessage?.({data});
beforeEach(()=>{channels.length=0;vi.useFakeTimers();vi.stubGlobal("MessageChannel",Channel);vi.spyOn(crypto,"randomUUID").mockReturnValue("token" as `${string}-${string}-${string}-${string}-${string}`);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
describe("opaque worker broker",()=>{
  it("pins the existing bootstrap and isolates worker scripts from document markup/network",()=>{
    const html=prepareScriptDocument("/* </script><img src=x> */","</script>");const doc=new DOMParser().parseFromString(html,"text/html");expect(doc.scripts.length).toBe(2);expect(doc.querySelector("img")).toBeNull();const csp=doc.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute("content")!;expect(csp).toContain(`script-src ${integrity.scriptSource} 'unsafe-eval'`);expect(csp).toContain("worker-src blob:");expect(csp).toContain("connect-src 'none'");expect(csp).toContain("frame-src 'none'");
  });
  it("accepts only the owned opaque frame/token and a private ordered channel",async()=>{
    const pending=runIsolatedScript(input);const target=frame();expect(target.getAttribute("sandbox")).toBe("allow-scripts");expect(target.referrerPolicy).toBe("no-referrer");ready(target,"wrong");expect(channels).toHaveLength(0);ready(target);expect(channels).toHaveLength(1);expect(channels[0]!.port1.postMessage).toHaveBeenCalledWith({type:"run",input});reply({version:1,type:"started"});reply({version:1,type:"result",output:{value:42}});expect(await pending).toEqual({value:42});expect(frame()).toBeNull();expect(channels[0]!.port1.close).toHaveBeenCalled();
  });
  it("rejects a nonopaque source and results arriving before worker startup",async()=>{
    const first=runIsolatedScript(input);const rejected=expect(first).rejects.toThrow("opaque");ready(frame(),"token","tauri://localhost");await rejected;
    const second=runIsolatedScript(input);const outOfOrder=expect(second).rejects.toThrow("sequence");ready();reply({version:1,type:"result",output:{}});await outOfOrder;
  });
  it("bounds startup/execution time and cleans up aborts and late responses",async()=>{
    const first=runIsolatedScript(input);const startup=expect(first).rejects.toThrow("did not start");await vi.advanceTimersByTimeAsync(8000);await startup;
    const controller=new AbortController();const pending=runIsolatedScript(input,{signal:controller.signal,timeoutMs:500});const aborted=expect(pending).rejects.toThrow("cancelled");ready();reply({version:1,type:"started"});controller.abort();await aborted;reply({version:1,type:"result",output:{}});expect(frame()).toBeNull();
    const last=runIsolatedScript(input,{timeoutMs:500});const deadline=expect(last).rejects.toThrow("time limit");ready();reply({version:1,type:"started"});await vi.advanceTimersByTimeAsync(500);await deadline;
  });
  it("releases admission after bootstrap errors and stops malformed messages",async()=>{
    vi.mocked(crypto.randomUUID).mockImplementationOnce(()=>{throw new Error("no crypto");});await expect(runIsolatedScript(input)).rejects.toThrow("no crypto");
    const first=runIsolatedScript(input);const bad=expect(first).rejects.toThrow("channel response");ready();reply({version:2,type:"started"});await bad;
    const second=runIsolatedScript(input);const failed=expect(second).rejects.toThrow("worker failed");ready();reply({version:1,type:"error",error:"worker failed"});await failed;
  });
  it("caps simultaneous workers and rejects invalid source/timeout before creating frames",async()=>{
    expect(()=>runIsolatedScript({...input,code:""})).toThrow("64 KiB");expect(()=>runIsolatedScript(input,{timeoutMs:1})).toThrow("timeout");const a=new AbortController(),b=new AbortController();const first=runIsolatedScript(input,{signal:a.signal}),second=runIsolatedScript(input,{signal:b.signal});const one=expect(first).rejects.toThrow("cancelled"),two=expect(second).rejects.toThrow("cancelled");expect(()=>runIsolatedScript(input)).toThrow("workers");a.abort();b.abort();await one;await two;
  });
});
