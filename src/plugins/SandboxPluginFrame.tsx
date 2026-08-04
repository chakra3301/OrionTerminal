import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Shield } from "lucide-react";
import { beginCommunityPluginCall } from "@/plugins/communityActivity";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import { useCommunityPlugins } from "@/store/communityPluginStore";

export const PLUGIN_RPC_CHANNEL = "orion-plugin-rpc";
export const PLUGIN_RPC_VERSION = 1;
export const PLUGIN_SANDBOX = "allow-scripts";
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_IN_FLIGHT = 8;
const MAX_REQUESTS_PER_MINUTE = 120;
const BROKER_METHODS = new Set([
  "host.getInfo",
  "storage.get",
  "storage.set",
  "storage.delete",
  "notifications.show",
]);

type PluginRequest = {
  channel: typeof PLUGIN_RPC_CHANNEL;
  version: typeof PLUGIN_RPC_VERSION;
  sessionId: string;
  type: "request";
  requestId: string;
  method: string;
  params: unknown;
};

type PluginRuntimeError = {
  channel: typeof PLUGIN_RPC_CHANNEL;
  version: typeof PLUGIN_RPC_VERSION;
  sessionId: string;
  type: "runtime-error";
  message: string;
};

function randomSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function scriptJson(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function bootstrapScript(sessionId: string): string {
  return `(() => {
  "use strict";
  const channel = ${scriptJson(PLUGIN_RPC_CHANNEL)};
  const version = ${PLUGIN_RPC_VERSION};
  const sessionId = ${scriptJson(sessionId)};
  const pending = new Map();
  let sequence = 0;
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "Worker", "SharedWorker", "RTCPeerConnection", "webkitRTCPeerConnection", "open"]) {
    try { Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false }); } catch {}
  }
  try { Object.defineProperty(navigator, "sendBeacon", { value: () => false, writable: false, configurable: false }); } catch {}
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    if (typeof method !== "string" || method.length > 80) {
      reject(new Error("invalid broker method"));
      return;
    }
    const requestId = sessionId.slice(0, 12) + "-" + (++sequence);
    pending.set(requestId, { resolve, reject });
    parent.postMessage({ channel, version, sessionId, type: "request", requestId, method, params }, "*");
  });
  const api = Object.freeze({
    apiVersion: "1",
    request,
    storage: Object.freeze({
      get: (key) => request("storage.get", { key }),
      set: (key, value) => request("storage.set", { key, value }),
      delete: (key) => request("storage.delete", { key }),
    }),
    notifications: Object.freeze({
      show: (title, body = "") => request("notifications.show", { title, body }),
    }),
  });
  Object.defineProperty(window, "orion", { value: api, writable: false, configurable: false });
  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (!message || message.channel !== channel || message.version !== version || message.sessionId !== sessionId || message.type !== "response") return;
    const item = pending.get(message.requestId);
    if (!item) return;
    pending.delete(message.requestId);
    if (message.ok) item.resolve(message.result);
    else item.reject(new Error(typeof message.error === "string" ? message.error : "plugin request failed"));
  });
  const runtimeError = (value) => {
    const message = value instanceof Error ? value.message : String(value || "Plugin runtime error");
    parent.postMessage({ channel, version, sessionId, type: "runtime-error", message: message.slice(0, 300) }, "*");
  };
  addEventListener("error", (event) => runtimeError(event.error || event.message));
  addEventListener("unhandledrejection", (event) => runtimeError(event.reason));
  addEventListener("beforeunload", () => runtimeError("Sandbox navigation attempt blocked"));
  parent.postMessage({ channel, version, sessionId, type: "ready" }, "*");
})();`;
}

function parsePluginHtml(content: string): { head: string; body: string } {
  const parsed = new DOMParser().parseFromString(content, "text/html");
  parsed.querySelectorAll("base, meta[http-equiv], iframe, object, embed").forEach((node) => node.remove());
  parsed.querySelectorAll("script[src], link[href]").forEach((node) => node.remove());
  parsed.querySelectorAll("a[href]").forEach((node) => node.removeAttribute("href"));
  return { head: parsed.head.innerHTML, body: parsed.body.innerHTML };
}

export function buildPluginDocument(
  content: string,
  kind: "ui" | "background",
  sessionId: string,
): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' blob:",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "worker-src blob:",
    "child-src blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "navigate-to 'none'",
  ].join("; ");
  const baseStyle = kind === "background"
    ? "html,body{display:none!important}"
    : "html,body{width:100%;height:100%;margin:0;background:#03060a;color:#e6f4ec;color-scheme:dark}*{box-sizing:border-box}";
  const parsed = kind === "ui" ? parsePluginHtml(content) : { head: "", body: "" };
  const pluginScript = kind === "background"
    ? `<script>(()=>{const code=${scriptJson(content)};const url=URL.createObjectURL(new Blob([code],{type:"text/javascript"}));const script=document.createElement("script");script.src=url;script.onload=()=>URL.revokeObjectURL(url);document.head.appendChild(script)})()</script>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>${baseStyle}</style><script>${bootstrapScript(sessionId)}</script>${parsed.head}</head><body>${parsed.body}${pluginScript}</body></html>`;
}

export function isPluginRequest(value: unknown, sessionId: string): value is PluginRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<PluginRequest>;
  if (
    request.channel !== PLUGIN_RPC_CHANNEL ||
    request.version !== PLUGIN_RPC_VERSION ||
    request.sessionId !== sessionId ||
    request.type !== "request" ||
    typeof request.requestId !== "string" ||
    !/^[A-Za-z0-9-]{1,80}$/.test(request.requestId) ||
    typeof request.method !== "string" ||
    !BROKER_METHODS.has(request.method)
  ) {
    return false;
  }
  try {
    return JSON.stringify(request.params ?? null).length <= MAX_MESSAGE_BYTES;
  } catch {
    return false;
  }
}

function isRuntimeError(value: unknown, sessionId: string): value is PluginRuntimeError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = value as Partial<PluginRuntimeError>;
  return error.channel === PLUGIN_RPC_CHANNEL
    && error.version === PLUGIN_RPC_VERSION
    && error.sessionId === sessionId
    && error.type === "runtime-error"
    && typeof error.message === "string"
    && error.message.length <= 300;
}

export function SandboxPluginFrame({
  pluginId,
  kind,
}: {
  pluginId: string;
  kind: "ui" | "background";
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const disposingRef = useRef(false);
  const sessionId = useMemo(randomSessionId, [pluginId, kind]);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reportRuntimeFailure = useCommunityPlugins((state) => state.reportRuntimeFailure);

  useLayoutEffect(() => {
    disposingRef.current = false;
    return () => {
      disposingRef.current = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    void ipc.pluginReadEntrypoint(pluginId, kind)
      .then((entrypoint) => {
        if (disposed) return;
        const document = buildPluginDocument(entrypoint.content, kind, sessionId);
        objectUrl = URL.createObjectURL(new Blob([document], { type: "text/html" }));
        setUrl(objectUrl);
      })
      .catch((reason) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        void reportRuntimeFailure(pluginId, `Entrypoint load failed: ${message}`);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, pluginId, reportRuntimeFailure, sessionId]);

  useEffect(() => {
    const inFlight = new Set<string>();
    const requestTimes: number[] = [];
    let violations = 0;
    const fail = (reason: string) => {
      violations += 1;
      if (violations >= 5) void reportRuntimeFailure(pluginId, reason);
    };
    const respond = (
      requestId: string,
      ok: boolean,
      result?: unknown,
      responseError?: string,
    ) => {
      iframeRef.current?.contentWindow?.postMessage({
        channel: PLUGIN_RPC_CHANNEL,
        version: PLUGIN_RPC_VERSION,
        sessionId,
        type: "response",
        requestId,
        ok,
        result: result ?? null,
        error: responseError ?? null,
      }, "*");
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (isRuntimeError(event.data, sessionId)) {
        if (!disposingRef.current) {
          void reportRuntimeFailure(pluginId, `Runtime error: ${event.data.message}`);
        }
        return;
      }
      if (!isPluginRequest(event.data, sessionId)) {
        const candidate = event.data as { channel?: unknown } | null;
        if (candidate?.channel === PLUGIN_RPC_CHANNEL) fail("Plugin sent repeated malformed RPC messages.");
        return;
      }
      const request = event.data;
      const now = Date.now();
      while (requestTimes.length > 0 && requestTimes[0]! < now - 60_000) requestTimes.shift();
      if (requestTimes.length >= MAX_REQUESTS_PER_MINUTE) {
        respond(request.requestId, false, null, "plugin request rate limit exceeded");
        fail("Plugin exceeded its RPC rate limit.");
        return;
      }
      if (inFlight.size >= MAX_IN_FLIGHT || inFlight.has(request.requestId)) {
        respond(request.requestId, false, null, "too many in-flight plugin requests");
        fail("Plugin exceeded its concurrent RPC limit.");
        return;
      }
      requestTimes.push(now);
      inFlight.add(request.requestId);
      const endActivity = beginCommunityPluginCall(pluginId);
      void ipc.pluginBrokerCall(pluginId, request.method, request.params ?? {})
        .then((result) => {
          if (request.method === "notifications.show" && result && typeof result === "object") {
            const notification = result as { title?: unknown; body?: unknown };
            if (typeof notification.title === "string") {
              toast.info(notification.title, {
                body: typeof notification.body === "string" ? notification.body : undefined,
              });
            }
          }
          respond(request.requestId, true, result);
        })
        .catch((reason) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          respond(request.requestId, false, null, message.slice(0, 300));
        })
        .finally(() => {
          inFlight.delete(request.requestId);
          endActivity();
        });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pluginId, reportRuntimeFailure, sessionId]);

  if (kind === "background") {
    return url ? (
      <iframe
        ref={iframeRef}
        className="plugin-background-frame"
        sandbox={PLUGIN_SANDBOX}
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        referrerPolicy="no-referrer"
        src={url}
        title={`${pluginId} background runtime`}
        tabIndex={-1}
      />
    ) : null;
  }

  if (error) {
    return (
      <div className="plugin-frame-state error" role="alert">
        <AlertTriangle size={24} />
        <strong>Plugin quarantined</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (!url) {
    return (
      <div className="plugin-frame-state">
        <Loader2 size={22} className="pm-spin" />
        <span>Starting opaque sandbox…</span>
      </div>
    );
  }
  return (
    <div className="plugin-frame-shell">
      <div className="plugin-frame-trust"><Shield size={10} /> Opaque sandbox · brokered access</div>
      <iframe
        ref={iframeRef}
        className="plugin-ui-frame"
        sandbox={PLUGIN_SANDBOX}
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        referrerPolicy="no-referrer"
        src={url}
        title={`${pluginId} plugin`}
      />
    </div>
  );
}
