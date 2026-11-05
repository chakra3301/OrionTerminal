import source from "virtual:xdesign-script-worker";
import bootstrap from "../preview-bootstrap.js?raw";
import integrity from "../../../../resources/preview-bootstrap-integrity.json";
import { assertScriptCode, SCRIPT_CHANNEL, SCRIPT_VERSION, type ScriptInput } from "./scriptContract";

const MAX_MESSAGE = 64 * 1024 * 1024;
const json = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");
export function prepareScriptDocument(workerSource: string, token: string): string {
  if (workerSource.length > 8 * 1024 * 1024 || !token) throw new Error("Invalid script worker bootstrap.");
  const bridge = `(() => {
    const channel=${json(SCRIPT_CHANNEL)},version=${SCRIPT_VERSION},token=${json(token)};
    let connected=false,worker=null,url=null;
    const stop=()=>{worker?.terminate();worker=null;if(url)URL.revokeObjectURL(url);url=null;};
    addEventListener("pagehide",stop);
    addEventListener("message",event=>{
      if(connected||event.source!==parent||event.data?.channel!==channel||event.data?.version!==version||event.data?.token!==token||event.ports.length!==1)return;
      connected=true;const port=event.ports[0];let running=false;
      port.onmessage=event=>{
        if(event.data?.type==="cancel"){stop();port.close();return;}
        if(running||event.data?.type!=="run")return;running=true;
        try{
          url=URL.createObjectURL(new Blob([${json(workerSource)}],{type:"text/javascript"}));worker=new Worker(url);
          let workerReady=false;const input=event.data.input;
          worker.onmessage=event=>{
            if(typeof event.data!=="string"||event.data.length>${MAX_MESSAGE}){stop();port.postMessage({version,type:"error",error:"The script returned an oversized message."});return;}
            try{
              const data=JSON.parse(event.data);
              if(data.version===version&&data.type==="worker-ready"&&!workerReady){workerReady=true;worker.postMessage(input);return;}
              if(data.version!==version||!["started","result","error"].includes(data.type))throw new Error("Invalid script worker message.");
              if(url)URL.revokeObjectURL(url);url=null;port.postMessage(data);if(data.type!=="started")stop();
            }catch{stop();port.postMessage({version,type:"error",error:"Invalid script worker response."});}
          };
          worker.onerror=()=>{stop();port.postMessage({version,type:"error",error:"The isolated script worker stopped."});};
        }catch(error){stop();port.postMessage({version,type:"error",error:String(error).slice(0,1000)});}
      };port.start();
    });
    parent.postMessage({channel,version,token,type:"ready"},"*");
  })();`;
  const csp = [`default-src 'none'`, `script-src ${integrity.scriptSource} 'unsafe-eval'`, `worker-src blob:`, `connect-src 'none'`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`].join("; ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"></head><body><script type="application/json" id="xd-preview-payload">${json({role:"content",bridge})}</script><script>${bootstrap}</script></body></html>`;
}

let active = 0;
export function runIsolatedScript(input: ScriptInput, options: {signal?: AbortSignal; timeoutMs?: number} = {}): Promise<unknown> {
  assertScriptCode(input.code);
  const timeout = options.timeoutMs ?? 5000;
  if (!Number.isInteger(timeout) || timeout < 500 || timeout > 30_000) throw new Error("Choose a script timeout between 0.5 and 30 seconds.");
  if (active >= 2) throw new Error("Wait for the current script workers to finish.");
  if (options.signal?.aborted) return Promise.reject(new Error("Script cancelled."));
  active++;
  return new Promise((resolve, reject) => {
    let frame: HTMLIFrameElement | null = null, ports: MessageChannel | null = null, timer: ReturnType<typeof setTimeout> | null = null;
    let complete = false, connected = false, started = false;
    let token = "";
    const stop = (error?: Error, output?: unknown) => {
      if (complete) return; complete = true; active--;
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", ready); options.signal?.removeEventListener("abort", cancel);
      try { ports?.port1.postMessage({type:"cancel"}); } catch {}
      ports?.port1.close(); ports?.port2.close(); frame?.remove();
      if (error) reject(error); else resolve(output);
    };
    const cancel = () => stop(new Error("Script cancelled."));
    const ready = (event: MessageEvent) => {
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (data?.channel === "orion:xdesign-preview" && data.type === "startup-error") { stop(new Error(String(data.error).slice(0,1000))); return; }
      if (connected || data?.channel !== SCRIPT_CHANNEL || data.version !== SCRIPT_VERSION || data.token !== token || data.type !== "ready") return;
      if (event.origin !== "null") { stop(new Error("The script frame must have an opaque origin.")); return; }
      connected = true;
      try {
        ports = new MessageChannel();
        ports.port1.onmessage = message => {
          const data = message.data;
          if (!data || data.version !== SCRIPT_VERSION) { stop(new Error("Invalid script channel response.")); return; }
          if (data.type === "started" && !started) { started = true; if (timer) clearTimeout(timer); timer = setTimeout(() => stop(new Error("The script exceeded its time limit.")), timeout); }
          else if (data.type === "result" && started) stop(undefined, data.output);
          else if (data.type === "error" && typeof data.error === "string") stop(new Error(data.error.slice(0,1000)));
          else stop(new Error("Invalid script execution sequence."));
        };
        ports.port1.start(); frame.contentWindow!.postMessage({channel:SCRIPT_CHANNEL,version:SCRIPT_VERSION,token}, "*", [ports.port2]);
        ports.port1.postMessage({type:"run",input});
      } catch (error) { stop(error instanceof Error ? error : new Error("Could not start the script channel.")); }
    };
    try {
      token = crypto.randomUUID();
      frame = document.createElement("iframe"); frame.title = "Isolated XDesign script"; frame.hidden = true;
      frame.setAttribute("sandbox", "allow-scripts"); frame.referrerPolicy = "no-referrer";
      frame.allow = "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'";
      frame.srcdoc = prepareScriptDocument(source,token);
      window.addEventListener("message",ready); options.signal?.addEventListener("abort",cancel,{once:true});
      timer = setTimeout(() => stop(new Error("The isolated script worker did not start.")),8000);
      document.body.append(frame);
    } catch (error) { stop(error instanceof Error ? error : new Error("Could not create the script frame.")); }
  });
}
