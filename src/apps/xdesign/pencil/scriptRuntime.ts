import type { Editor } from "@open-pencil/core/editor";
import { applyPencilGraphSnapshot, editPencilGraphAndView } from "./toolExecution";
import { serializeGraph } from "./document";
import { assertScriptCode, decodeScriptGraph, decodeScriptOutput, scriptSummary, type ScriptOutput, type ScriptSummary } from "./scriptContract";
import { runIsolatedScript } from "./scriptSandbox";
import { persistPencil, usePencilWorkspace, withPencilTask, assertPencilEditable } from "./runtime";
import { useXDProjects } from "../projectsStore";
import { trackXDesignActivity } from "../runtimeActivity";

export type ScriptDraft = {project: string | null; editor: Editor; before: string; beforePage: string; beforeSelection: string[]; output: ScriptOutput; summary: ScriptSummary; code: string};
export async function previewPencilScript(code: string, signal?: AbortSignal, timeoutMs = 5000): Promise<ScriptDraft> {
  assertScriptCode(code);
  return withPencilTask(() => trackXDesignActivity("design-script", "Wait for or cancel the script before switching projects.", async () => {
    const editor = usePencilWorkspace.getState().editor, project = useXDProjects.getState().activeId;
    if (!editor || useXDProjects.getState().transitioning) throw new Error("Wait for the design canvas to load.");
    const before = serializeGraph(editor.graph), graph = decodeScriptGraph(before);
    const beforePage = editor.state.currentPageId, beforeSelection = [...editor.state.selectedIds];
    const input = {code,graph:before,pageId:beforePage,selection:beforeSelection};
    const value = await runIsolatedScript(input,{signal,timeoutMs});
    if (signal?.aborted || editor !== usePencilWorkspace.getState().editor || project !== useXDProjects.getState().activeId || serializeGraph(editor.graph) !== before) throw new Error("The design changed while the script was running.");
    const {output,graph:after} = decodeScriptOutput(value,graph);
    return {project,editor,before,beforePage,beforeSelection,output,summary:scriptSummary(graph,after,input,output),code};
  }));
}
export function scriptDraftCurrent(draft: ScriptDraft): boolean {
  return draft.editor === usePencilWorkspace.getState().editor && draft.project === useXDProjects.getState().activeId && !useXDProjects.getState().transitioning && serializeGraph(draft.editor.graph) === draft.before && draft.editor.state.currentPageId === draft.beforePage && JSON.stringify([...draft.editor.state.selectedIds]) === JSON.stringify(draft.beforeSelection);
}
export async function applyPencilScript(draft: ScriptDraft): Promise<unknown> {
  assertPencilEditable();
  return withPencilTask(() => trackXDesignActivity("design-script", "Wait for the script changes before switching projects.", async () => {
    if (!scriptDraftCurrent(draft)) throw new Error("The design changed. Preview the script again before applying.");
    const before = decodeScriptGraph(draft.before), {output,graph} = decodeScriptOutput(draft.output,before);
    const result = JSON.parse(output.result);
    if (output.graph === draft.before && output.pageId === draft.beforePage && JSON.stringify(output.selection) === JSON.stringify(draft.beforeSelection)) return result;
    draft.editor.undo.beginBatch("Run design script");
    try {
      editPencilGraphAndView(draft.editor,"Run design script",()=>{
        applyPencilGraphSnapshot(draft.editor,graph);draft.editor.state.currentPageId=output.pageId;draft.editor.select(output.selection);
      });
      persistPencil();draft.editor.undo.commitBatch();return result;
    }catch(error){draft.editor.undo.rollbackBatch();throw error;}
  }));
}
export async function runPencilScript(code: string): Promise<unknown> {
  return applyPencilScript(await previewPencilScript(code));
}
