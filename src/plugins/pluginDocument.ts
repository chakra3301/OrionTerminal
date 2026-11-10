// Reuse the CSP-pinned opaque evaluator, not the XDesign runtime or store.
import bootstrapSource from "@/apps/xdesign/preview-bootstrap.js?raw";
import integrity from "../../resources/preview-bootstrap-integrity.json";
import { pluginSkin } from "./pluginAppearance";
import { pluginAppearanceStyles } from "./pluginAppearanceStyles";

const json = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");
function wrap(doc: Document, bridge: string, guard: boolean): string {
  const charset = doc.createElement("meta"); charset.setAttribute("charset", "utf-8");
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = ["default-src 'none'", `script-src ${integrity.scriptSource} 'unsafe-eval'`, "style-src 'unsafe-inline'", "img-src data: blob:", "font-src data:", "media-src data: blob:", "connect-src 'none'", "worker-src 'none'", `frame-src ${guard ? "about:" : "'none'"}`, "object-src 'none'", "base-uri 'none'", "form-action 'none'", "navigate-to 'none'"].join("; ");
  const referrer = doc.createElement("meta"); referrer.name = "referrer"; referrer.content = "no-referrer";
  const data = doc.createElement("script"); data.id = "xd-preview-payload"; data.type = "application/json";
  data.textContent = json({ role: "content", bridge });
  const bootstrap = doc.createElement("script"); bootstrap.id = "xd-preview-bridge";
  bootstrap.textContent = bootstrapSource.replace(/\r\n?/g, "\n");
  doc.head.prepend(charset, csp, referrer, data); doc.body.append(bootstrap);
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}
function guardBridge(sessionId: string, html: string): string {
  return `(() => {
    const channel = "orion-plugin-rpc", version = 1, sessionId = ${json(sessionId)};
    const frame = document.createElement("iframe");
    frame.title = "Plugin content"; frame.sandbox = "allow-scripts";
    frame.referrerPolicy = "no-referrer";
    frame.allow = "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'";
    frame.style.cssText = "border:0;width:100%;height:100%;display:block";
    frame.srcdoc = ${json(html)};
    const events = new Set(["ready", "gesture", "request", "runtime-error"]);
    addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (event.source === frame.contentWindow && data.channel === "orion:xdesign-preview" && data.version === 1 && data.type === "startup-error") {
        parent.postMessage({ channel, version, sessionId, type: "runtime-error", message: String(data.error).slice(0,300) }, "*"); return;
      }
      if (data.channel !== channel || data.version !== version || data.sessionId !== sessionId) return;
      if (event.source === parent && (data.type === "response" || data.type === "appearance")) frame.contentWindow?.postMessage(data, "*");
      else if (event.source === frame.contentWindow && events.has(data.type)) parent.postMessage(data, "*");
    });
    document.body.append(frame);
  })();`;
}
export function preparePluginDocuments(content: string, kind: "ui" | "background", bridge: string, sessionId: string): { guard: string; content: string } {
  const doc = new DOMParser().parseFromString(kind === "ui" ? content : "<!doctype html><html><head></head><body></body></html>", "text/html");
  doc.querySelectorAll("#xd-preview-payload, #xd-preview-bridge, #xd-preview-csp, base, meta[http-equiv], iframe, object, embed, script[src], link[href]").forEach((node) => node.remove());
  doc.querySelectorAll("a[href]").forEach((node) => node.removeAttribute("href"));
  for (const script of doc.querySelectorAll("script")) {
    script.removeAttribute("data-xd-script-type");
    const type = script.type.trim().toLowerCase();
    if (type === "module") throw new Error("Plugin entrypoints require standalone JavaScript, not module imports.");
    if (!["", "text/javascript", "application/javascript"].includes(type)) continue;
    script.setAttribute("data-xd-script-type", type); script.type = "application/x-orion-preview-script";
  }
  const skin = pluginSkin(content, kind);
  const style = doc.createElement("style");
  if (skin) {
    doc.documentElement.dataset.orionSkin = skin;
    doc.documentElement.dataset.orionStyle = "orion";
    style.id = "orion-appearance-style";
    style.textContent = pluginAppearanceStyles();
    doc.head.append(style);
  } else {
    style.textContent = "html,body{width:100%;height:100%;margin:0;background:#03060a;color:#e6f4ec;color-scheme:dark}*{box-sizing:border-box}";
    doc.head.prepend(style);
  }
  const inner = wrap(doc, kind === "background" ? `${bridge}\n;(0,eval)(${json(content)});` : bridge, false);
  const guard = new DOMParser().parseFromString("<!doctype html><html><head><style>html,body{margin:0;height:100%;overflow:hidden}</style></head><body></body></html>", "text/html");
  return { content: inner, guard: wrap(guard, guardBridge(sessionId, inner), true) };
}
