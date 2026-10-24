import { executeScriptDraft } from "./scriptEngine";
import { SCRIPT_VERSION, type ScriptInput } from "./scriptContract";
const owner = self as unknown as {postMessage: (data: string) => void};
const publish = owner.postMessage.bind(owner);
let started = false;
self.onmessage = async (event: MessageEvent<ScriptInput>) => {
  if (started) return; started = true;
  // CSP and the opaque origin enforce the boundary; remove ambient facilities
  // as well so a script cannot publish forged responses or spawn more workers.
  try {
    for (const name of ["postMessage","Worker","SharedWorker","BroadcastChannel","fetch","XMLHttpRequest","WebSocket","EventSource","importScripts","indexedDB","caches","navigator","process","require"]) {
      try { Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false}); } catch { throw new Error("The script worker could not remove an ambient capability."); }
    }
    publish(JSON.stringify({version:SCRIPT_VERSION,type:"started"}));
    publish(JSON.stringify({version:SCRIPT_VERSION,type:"result",output:await executeScriptDraft(event.data)}));
  }
  catch (error) { publish(JSON.stringify({version:SCRIPT_VERSION,type:"error",error:String(error).slice(0,1000)})); }
};
publish(JSON.stringify({version:SCRIPT_VERSION,type:"worker-ready"}));
