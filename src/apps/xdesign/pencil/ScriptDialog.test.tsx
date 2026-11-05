import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptDialog } from "./ScriptDialog";
import { usePencilWorkspace } from "./runtime";
import type { ScriptDraft } from "./scriptRuntime";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import { serializeGraph } from "./document";
const script=vi.hoisted(()=>({preview:vi.fn(),apply:vi.fn(),current:true}));
vi.mock("./scriptRuntime",()=>({previewPencilScript:script.preview,applyPencilScript:script.apply,scriptDraftCurrent:()=>script.current}));
vi.mock("../exportXD",()=>({downloadFile:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({isTauri:()=>false,invoke:vi.fn(),convertFileSrc:(value:string)=>value}));
let root:Root,container:HTMLDivElement;const close=vi.fn();
const draft={before:"original",output:{graph:"changed",result:'{"ok":true}',logs:["hello"],pageId:"page",selection:[]},summary:{added:2,removed:0,changed:1,images:0,variables:1,collections:1,modes:0,libraries:0,documentChanged:false,pageChanged:false,selectionChanged:false}} as unknown as ScriptDraft;
const button=(text:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===text)!;
const click=(text:string)=>act(async()=>button(text).click());
beforeEach(async()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);script.current=true;script.preview.mockReset().mockResolvedValue(draft);script.apply.mockReset().mockResolvedValue({ok:true});close.mockReset();usePencilWorkspace.setState({busy:false,error:null});container=document.createElement("div");document.body.append(container);root=createRoot(container);await act(async()=>root.render(<ScriptDialog close={close}/>));});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
describe("design script review",()=>{
  it("previews source/timeout, shows changes/logs/result and applies only a current draft",async()=>{
    await click("Preview script");expect(script.preview.mock.lastCall![0]).toContain("figma.createFrame");expect(script.preview.mock.lastCall![2]).toBe(5000);expect(container.textContent).toContain("2 added, 0 removed, 1 changed");expect(container.textContent).toContain("hello");expect(script.apply).not.toHaveBeenCalled();await click("Apply script changes");expect(script.apply).toHaveBeenCalledWith(draft);expect(container.querySelector(".xd-script-result")).toBeNull();
  });
  it("invalidates previews after source edits and guards changed document results",async()=>{
    await click("Preview script");const area=container.querySelector("textarea")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(area,"42");area.dispatchEvent(new Event("input",{bubbles:true}));});expect(container.querySelector(".xd-script-result")).toBeNull();await click("Preview script");script.current=false;await act(async()=>usePencilWorkspace.setState({version:usePencilWorkspace.getState().version+1}));expect(button("Apply script changes").disabled).toBe(true);expect(container.textContent).toContain("design changed");
  });
  it("stops a running preview, rejects duplicate starts and suppresses replies after unmount",async()=>{
    let resolve!:(value:ScriptDraft)=>void;script.preview.mockImplementationOnce(()=>new Promise(done=>resolve=done));await click("Preview script");expect(button("Running draft…").disabled).toBe(true);await click("Stop script");expect(script.preview.mock.lastCall![1].aborted).toBe(true);await act(async()=>resolve(draft));expect(container.querySelector(".xd-script-result")).toBeNull();
    script.preview.mockImplementationOnce(()=>new Promise(done=>resolve=done));await click("Preview script");await click("Close");expect(close).toHaveBeenCalledOnce();await act(async()=>root.render(null));await act(async()=>resolve(draft));expect(script.apply).not.toHaveBeenCalled();
  });
  it("keeps worker/apply failures reviewable and prevents duplicate applies",async()=>{
    script.preview.mockRejectedValueOnce(new Error("worker unavailable"));await click("Preview script");expect(container.textContent).toContain("worker unavailable");await click("Preview script");script.apply.mockRejectedValueOnce(new Error("rollback"));await click("Apply script changes");expect(container.textContent).toContain("rollback");expect(container.querySelector(".xd-script-result")).not.toBeNull();let finish!:()=>void;script.apply.mockImplementationOnce(()=>new Promise<void>(resolve=>finish=resolve));await click("Apply script changes");expect(button("Applying…").disabled).toBe(true);expect(button("Close").disabled).toBe(true);await act(async()=>finish());expect(script.apply).toHaveBeenCalledTimes(2);
  });
});

function fileRead(name:string,size=16) {
  let resolve!:(value:string)=>void,reject!:(error:Error)=>void;
  const pending=new Promise<string>((done,fail)=>{resolve=done;reject=fail;}),file=new File([new Uint8Array(size)],name,{type:"text/javascript"}),text=vi.fn(()=>pending);
  Object.defineProperty(file,"text",{value:text}); return {file,text,resolve,reject};
}
async function selectFile(file?:File) {
  const input=container.querySelector<HTMLInputElement>('[aria-label="Open design script file"]')!;
  await act(async()=>{Object.defineProperty(input,"files",{configurable:true,value:file?[file]:[]});input.dispatchEvent(new Event("change",{bubbles:true}));});
}
const code=()=>container.querySelector<HTMLTextAreaElement>('[aria-label="Design script"]')!.value;
async function typeCode(value:string) {await act(async()=>{const area=container.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(area,value);area.dispatchEvent(new Event("input",{bubbles:true}));});}

describe("script file import intent",()=>{
  let editor:Editor,source:string,page:string,selection:string[];
  beforeEach(()=>{editor=createEditor();const node=editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{name:"Unchanged authored layer",width:23,height:17});editor.select([node.id]);source=serializeGraph(editor.graph);page=editor.state.currentPageId;selection=[...editor.state.selectedIds];act(()=>usePencilWorkspace.setState({editor}));});
  afterEach(()=>{expect(serializeGraph(editor.graph)).toBe(source);expect(editor.state.currentPageId).toBe(page);expect([...editor.state.selectedIds]).toEqual(selection);expect(editor.undo.canUndo).toBe(false);expect(editor.undo.canRedo).toBe(false);act(()=>usePencilWorkspace.setState({editor:null}));editor.dispose();});

  it.each(["older first","newer first"])("keeps the newest selected real file when reads finish %s",async order=>{
    const a=fileRead("A.js"),b=fileRead("B.js");await selectFile(a.file);await selectFile(b.file);expect(a.text).toHaveBeenCalledOnce();expect(b.text).toHaveBeenCalledOnce();
    if(order==="older first"){await act(async()=>a.resolve("'older A'"));expect(code()).not.toBe("'older A'");await act(async()=>b.resolve("'newer B'"));}
    else{await act(async()=>b.resolve("'newer B'"));await act(async()=>a.resolve("'older A'"));}
    expect(code()).toBe("'newer B'");expect(container.querySelector('[role="alert"]')).toBeNull();await click("Preview script");expect(script.preview).toHaveBeenCalledExactlyOnceWith("'newer B'",expect.any(AbortSignal),5000);expect(script.apply).not.toHaveBeenCalled();
  });
  it.each(["success","failure"])("keeps later typed code when a superseded file read reports %s",async outcome=>{
    const a=fileRead("A.js");await selectFile(a.file);await typeCode("const typed = 42; typed");await act(async()=>{if(outcome==="success")a.resolve("'stale file'");else a.reject(new Error("stale file failure"));});
    expect(code()).toBe("const typed = 42; typed");expect(container.querySelector('[role="alert"]')).toBeNull();await click("Preview script");expect(script.preview.mock.lastCall![0]).toBe("const typed = 42; typed");expect(script.apply).not.toHaveBeenCalled();
  });
  it("does not replace a newer successful import with an older read error",async()=>{
    const a=fileRead("A.js"),b=fileRead("B.js");await selectFile(a.file);await selectFile(b.file);await act(async()=>b.resolve("'accepted B'"));await act(async()=>a.reject(new Error("late A failure")));
    expect(code()).toBe("'accepted B'");expect(container.querySelector('[role="alert"]')).toBeNull();expect(script.preview).not.toHaveBeenCalled();expect(script.apply).not.toHaveBeenCalled();
  });
  it("makes a newer oversized selection supersede an older read and permits a current retry",async()=>{
    const a=fileRead("A.js"),oversize=fileRead("Too large.js",65537),b=fileRead("Retry.js");const original=code();await selectFile(a.file);await selectFile(oversize.file);expect(oversize.text).not.toHaveBeenCalled();expect(container.textContent).toContain("up to 64 KiB");await act(async()=>a.resolve("'stale A'"));expect(code()).toBe(original);expect(container.textContent).toContain("up to 64 KiB");
    await selectFile(b.file);await act(async()=>b.resolve("'retry accepted'"));expect(code()).toBe("'retry accepted'");expect(container.querySelector('[role="alert"]')).toBeNull();expect(script.apply).not.toHaveBeenCalled();
  });
  it("keeps a reviewed preview when an earlier file read finishes after preview completion",async()=>{
    const a=fileRead("A.js"),original=code();await selectFile(a.file);await click("Preview script");const review=container.querySelector(".xd-script-result");await act(async()=>a.resolve("'late A'"));expect(code()).toBe(original);expect(container.querySelector(".xd-script-result")).toBe(review);expect(script.preview).toHaveBeenCalledExactlyOnceWith(original,expect.any(AbortSignal),5000);expect(script.apply).not.toHaveBeenCalled();
  });
  it("cannot revive a pending import after Apply completes",async()=>{
    await click("Preview script");const original=code(),a=fileRead("Before apply.js");await selectFile(a.file);await click("Apply script changes");await act(async()=>a.resolve("'late after apply'"));expect(code()).toBe(original);expect(container.querySelector(".xd-script-result")).toBeNull();expect(script.apply).toHaveBeenCalledExactlyOnceWith(draft);expect(script.preview).toHaveBeenCalledOnce();
  });
  it("rejects a late import immediately after Close even before the parent unmounts",async()=>{
    const a=fileRead("Closing.js"),original=code();await selectFile(a.file);await click("Close");expect(close).toHaveBeenCalledOnce();await act(async()=>a.resolve("'closed dialog import'"));expect(code()).toBe(original);expect(script.preview).not.toHaveBeenCalled();expect(script.apply).not.toHaveBeenCalled();
  });
  it("ignores a pending file failure after unmount",async()=>{
    const a=fileRead("Unmounted.js");await selectFile(a.file);await act(async()=>root.render(null));await act(async()=>a.reject(new Error("late unmounted read")));expect(container.childElementCount).toBe(0);expect(script.preview).not.toHaveBeenCalled();expect(script.apply).not.toHaveBeenCalled();
  });
  it("accepts the current import, clears its prior review and previews its exact source once",async()=>{
    await click("Preview script");const current=fileRead("Current.js");await selectFile(current.file);expect(container.querySelector(".xd-script-result")).not.toBeNull();await act(async()=>current.resolve("// imported Unicode Ω\nconst result = 6 * 7;\nresult"));expect(container.querySelector(".xd-script-result")).toBeNull();expect(code()).toBe("// imported Unicode Ω\nconst result = 6 * 7;\nresult");
    script.preview.mockClear();await click("Preview script");expect(script.preview).toHaveBeenCalledExactlyOnceWith("// imported Unicode Ω\nconst result = 6 * 7;\nresult",expect.any(AbortSignal),5000);expect(script.apply).not.toHaveBeenCalled();
  });
  it("accepts a current real file and previews once after StrictMode replays its lifecycle effect",async()=>{
    await act(async()=>root.render(<StrictMode><ScriptDialog close={close}/></StrictMode>));
    const current=fileRead("Strict current.js");await selectFile(current.file);expect(current.text).toHaveBeenCalledOnce();await act(async()=>current.resolve("const strictResult = 21 * 2;\nstrictResult"));
    expect(code()).toBe("const strictResult = 21 * 2;\nstrictResult");await click("Preview script");expect(script.preview).toHaveBeenCalledExactlyOnceWith("const strictResult = 21 * 2;\nstrictResult",expect.any(AbortSignal),5000);expect(container.querySelector(".xd-script-result")).not.toBeNull();expect(script.apply).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
  });
});
