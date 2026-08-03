export const HTML_PREVIEW_CHANNEL = "orion:xdesign-preview";
export const HTML_PREVIEW_VERSION = 1;
export const HTML_PREVIEW_SANDBOX = "allow-scripts";
export const HTML_PREVIEW_BRIDGE_ID = "xd-preview-bridge";
export const HTML_PREVIEW_CSP_ID = "xd-preview-csp";
export const MAX_PREVIEW_HTML_BYTES = 25_000_000;
export const MAX_PREVIEW_VIDEO_BYTES = 100_000_000;

export type PreviewRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type PreviewSelection = {
  path: number[];
  rect: PreviewRect;
  tag: string;
  className: string;
  inlineStyle: string;
  outerHTML: string;
  computed: Record<string, string>;
};

export type PreviewEvent =
  | { type: "ready" }
  | { type: "selection"; selection: PreviewSelection | null }
  | { type: "persist"; html: string }
  | { type: "external-link"; url: string }
  | { type: "record-result"; requestId: string; ext: "mp4" | "webm"; bytes: ArrayBuffer }
  | { type: "record-error"; requestId: string; error: string };

export type PreviewCommand =
  | { type: "set-edit"; enabled: boolean }
  | { type: "patch-style"; patch: Record<string, string | null> }
  | { type: "delete-selection" }
  | { type: "duplicate-selection" }
  | { type: "move-selection"; direction: -1 | 1 }
  | { type: "record-canvas"; requestId: string; durationMs: number };

type ScriptUrlFactory = {
  create: (source: string) => string;
  revoke: (url: string) => void;
};

export type PreparedPreview = {
  srcDoc: string;
  release: () => void;
};

const FRAME_CSP = [
  "default-src 'none'",
  "script-src blob:",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com",
  "img-src data: blob:",
  "media-src data: blob:",
  "worker-src blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const DEFAULT_URL_FACTORY: ScriptUrlFactory = {
  create: (source) => URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
  revoke: (url) => URL.revokeObjectURL(url),
};

function bridgeRuntime() {
  const CHANNEL = "orion:xdesign-preview";
  const VERSION = 1;
  const BRIDGE_ID = "xd-preview-bridge";
  const CSP_ID = "xd-preview-csp";
  const STYLE_ID = "xd-editor-style";
  const SELECTED_ATTR = "data-xd-selected";
  const MAX_HTML = 25_000_000;
  const COMPUTED_PROPS = [
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "color",
    "background-color",
    "padding",
    "margin",
    "border",
    "border-radius",
  ];

  let editing = false;
  let selected: HTMLElement | null = null;

  const send = (message: Record<string, unknown>, transfer?: Transferable[]) => {
    const envelope = { channel: CHANNEL, version: VERSION, ...message };
    if (transfer) parent.postMessage(envelope, "*", transfer);
    else parent.postMessage(envelope, "*");
  };

  const pathOf = (element: Element) => {
    const path: number[] = [];
    let node: Element | null = element;
    while (node && node.parentElement) {
      path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
      node = node.parentElement;
    }
    return path;
  };

  const stripChrome = (root: Element) => {
    root.querySelector(`#${BRIDGE_ID}`)?.remove();
    root.querySelector(`#${CSP_ID}`)?.remove();
    root.querySelector(`#${STYLE_ID}`)?.remove();
    for (const element of [root, ...root.querySelectorAll("*")]) {
      for (const attr of [...element.attributes]) {
        if (attr.name.startsWith("data-xd-") || attr.name === "contenteditable") {
          element.removeAttribute(attr.name);
        }
      }
      if (element.getAttribute("style") === "") element.removeAttribute("style");
    }
  };

  const cleanOuterHTML = (element: Element) => {
    const clone = element.cloneNode(true) as Element;
    stripChrome(clone);
    return clone.outerHTML;
  };

  const serialize = () => {
    const clone = document.documentElement.cloneNode(true) as Element;
    stripChrome(clone);
    const doctype = document.doctype ? "<!doctype html>\n" : "";
    return doctype + clone.outerHTML;
  };

  const snapshot = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const computed: Record<string, string> = {};
    for (const prop of COMPUTED_PROPS) computed[prop] = styles.getPropertyValue(prop);
    return {
      path: pathOf(element),
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      tag: element.tagName.toLowerCase(),
      className: typeof element.className === "string" ? element.className : "",
      inlineStyle: element.getAttribute("style") || "",
      outerHTML: cleanOuterHTML(element),
      computed,
    };
  };

  const publishSelection = () => {
    send({ type: "selection", selection: selected?.isConnected ? snapshot(selected) : null });
  };

  const persist = () => {
    const html = serialize();
    if (new TextEncoder().encode(html).byteLength <= MAX_HTML) {
      send({ type: "persist", html });
    }
  };

  const select = (element: HTMLElement) => {
    document.querySelectorAll(`[${SELECTED_ATTR}]`).forEach((node) =>
      node.removeAttribute(SELECTED_ATTR),
    );
    selected = element;
    selected.setAttribute(SELECTED_ATTR, "1");
    publishSelection();
  };

  const clearSelection = () => {
    document.querySelectorAll(`[${SELECTED_ATTR}]`).forEach((node) =>
      node.removeAttribute(SELECTED_ATTR),
    );
    selected = null;
    publishSelection();
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `[${SELECTED_ATTR}]{outline:2px solid #ff3ea5 !important;outline-offset:1px}[${SELECTED_ATTR}][contenteditable]{outline:2px dashed #ff3ea5 !important}*{cursor:default}`;
    document.head?.appendChild(style);
  };

  const setEditing = (enabled: boolean) => {
    if (!enabled && editing) persist();
    editing = enabled;
    if (editing) ensureStyle();
    else {
      document.getElementById(STYLE_ID)?.remove();
      document.querySelectorAll("[contenteditable]").forEach((node) =>
        node.removeAttribute("contenteditable"),
      );
      clearSelection();
    }
  };

  const patchStyle = (patch: Record<string, unknown>) => {
    if (!editing || !selected?.isConnected || !patch || typeof patch !== "object") return;
    const entries = Object.entries(patch).slice(0, 32);
    for (const [prop, value] of entries) {
      if (!/^[a-z-]{1,64}$/.test(prop)) continue;
      if (value === null || value === "") selected.style.removeProperty(prop);
      else if (typeof value === "string" && value.length <= 1000) {
        selected.style.setProperty(prop, value);
      }
    }
    publishSelection();
    persist();
  };

  const duplicateSelection = () => {
    if (!editing || !selected?.isConnected) return;
    const clone = selected.cloneNode(true) as HTMLElement;
    clone.removeAttribute(SELECTED_ATTR);
    selected.after(clone);
    select(clone);
    persist();
  };

  const deleteSelection = () => {
    if (!editing || !selected?.isConnected) return;
    selected.remove();
    clearSelection();
    persist();
  };

  const moveSelection = (direction: unknown) => {
    if (!editing || !selected?.isConnected || (direction !== -1 && direction !== 1)) return;
    const sibling = direction < 0 ? selected.previousElementSibling : selected.nextElementSibling;
    if (!sibling) return;
    if (direction < 0) sibling.before(selected);
    else sibling.after(selected);
    publishSelection();
    persist();
  };

  const pickVideoMime = () => {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates: Array<[string, "mp4" | "webm"]> = [
      ["video/mp4;codecs=h264", "mp4"],
      ["video/mp4", "mp4"],
      ["video/webm;codecs=vp9", "webm"],
      ["video/webm;codecs=vp8", "webm"],
      ["video/webm", "webm"],
    ];
    for (const [mime, ext] of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
      } catch {}
    }
    return null;
  };

  const recordCanvas = async (requestId: string, requestedDuration: unknown) => {
    try {
      const canvas =
        document.querySelector<HTMLCanvasElement>("canvas#scene") ||
        document.querySelector<HTMLCanvasElement>("canvas");
      const capture = canvas?.captureStream;
      const picked = pickVideoMime();
      if (!canvas || typeof capture !== "function" || !picked) {
        throw new Error("video recording is not supported for this preview");
      }
      const durationMs = Math.max(250, Math.min(30_000, Number(requestedDuration) || 6000));
      const stream = capture.call(canvas, 30);
      const recorder = new MediaRecorder(stream, {
        mimeType: picked.mime,
        videoBitsPerSecond: 8_000_000,
      });
      const chunks: BlobPart[] = [];
      const done = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data?.size) chunks.push(event.data);
        };
        recorder.onstop = () => resolve(new Blob(chunks, { type: picked.mime }));
        recorder.onerror = () => reject(new Error("recording failed"));
      });
      recorder.start(100);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      if (recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      const blob = await done;
      const bytes = await blob.arrayBuffer();
      send({ type: "record-result", requestId, ext: picked.ext, bytes }, [bytes]);
    } catch (error) {
      send({
        type: "record-error",
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]");
      if (anchor) {
        const href = anchor.getAttribute("href") || "";
        event.preventDefault();
        event.stopPropagation();
        if (href.startsWith("#")) {
          const id = href.slice(1);
          const destination = id
            ? document.getElementById(id) || document.querySelector(`a[name="${CSS.escape(id)}"]`)
            : null;
          destination?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          try {
            const url = new URL(href, "https://preview.invalid/");
            if (["http:", "https:"].includes(url.protocol)) {
              send({ type: "external-link", url: url.href });
            }
          } catch {}
        }
        return;
      }
      if (!editing || !target) return;
      if (target === document.documentElement || target === document.body) return;
      event.preventDefault();
      event.stopPropagation();
      select(target as HTMLElement);
    },
    true,
  );

  document.addEventListener(
    "dblclick",
    (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!editing || !target) return;
      if (target === document.documentElement || target === document.body) return;
      event.preventDefault();
      event.stopPropagation();
      select(target);
      target.setAttribute("contenteditable", "true");
      target.focus();
      target.addEventListener(
        "blur",
        () => {
          target.removeAttribute("contenteditable");
          publishSelection();
          persist();
        },
        { once: true },
      );
    },
    true,
  );

  document.addEventListener("submit", (event) => event.preventDefault(), true);
  try {
    HTMLFormElement.prototype.submit = function () {};
  } catch {}
  try {
    window.open = () => null;
  } catch {}

  addEventListener("scroll", () => selected?.isConnected && publishSelection(), true);
  addEventListener("resize", () => selected?.isConnected && publishSelection());

  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (
      !message ||
      typeof message !== "object" ||
      message.channel !== CHANNEL ||
      message.version !== VERSION ||
      typeof message.type !== "string"
    ) {
      return;
    }
    if (message.type === "set-edit" && typeof message.enabled === "boolean") {
      setEditing(message.enabled);
    } else if (message.type === "patch-style") {
      patchStyle(message.patch);
    } else if (message.type === "delete-selection") {
      deleteSelection();
    } else if (message.type === "duplicate-selection") {
      duplicateSelection();
    } else if (message.type === "move-selection") {
      moveSelection(message.direction);
    } else if (
      message.type === "record-canvas" &&
      typeof message.requestId === "string" &&
      message.requestId.length <= 100
    ) {
      void recordCanvas(message.requestId, message.durationMs);
    }
  });

  send({ type: "ready" });
}

function bridgeSource(): string {
  return `;(${bridgeRuntime.toString()})();`;
}

function ensureDocumentHead(doc: Document): HTMLHeadElement {
  if (doc.head) return doc.head;
  const head = doc.createElement("head");
  doc.documentElement.prepend(head);
  return head;
}

export function prepareHtmlPreview(
  html: string,
  urlFactory: ScriptUrlFactory = DEFAULT_URL_FACTORY,
): PreparedPreview {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const urls: string[] = [];
  const createUrl = (source: string) => {
    const url = urlFactory.create(source);
    urls.push(url);
    return url;
  };

  for (const meta of Array.from(doc.querySelectorAll("meta[http-equiv]"))) {
    if (meta.getAttribute("http-equiv")?.toLowerCase() === "content-security-policy") {
      meta.remove();
    }
  }

  for (const script of Array.from(doc.querySelectorAll("script"))) {
    if (script.src) {
      script.remove();
      continue;
    }
    const source = script.textContent ?? "";
    if (!source.trim()) {
      script.remove();
      continue;
    }
    script.textContent = "";
    script.removeAttribute("integrity");
    script.removeAttribute("crossorigin");
    script.removeAttribute("nonce");
    script.src = createUrl(source);
  }

  const head = ensureDocumentHead(doc);
  const csp = doc.createElement("meta");
  csp.id = HTML_PREVIEW_CSP_ID;
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", FRAME_CSP);

  const bridge = doc.createElement("script");
  bridge.id = HTML_PREVIEW_BRIDGE_ID;
  bridge.src = createUrl(bridgeSource());

  head.prepend(bridge);
  head.prepend(csp);

  const doctype = html.trimStart().toLowerCase().startsWith("<!doctype")
    ? "<!doctype html>\n"
    : "";
  return {
    srcDoc: doctype + doc.documentElement.outerHTML,
    release: () => {
      for (const url of urls) urlFactory.revoke(url);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function isBoundedUtf8(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxBytes &&
    new TextEncoder().encode(value).byteLength <= maxBytes
  );
}

function isPath(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every((part) => Number.isInteger(part) && part >= 0 && part <= 100_000)
  );
}

function isRect(value: unknown): value is PreviewRect {
  if (!isRecord(value)) return false;
  return ["top", "left", "width", "height"].every((key) => {
    const part = value[key];
    return typeof part === "number" && Number.isFinite(part) && Math.abs(part) <= 10_000_000;
  });
}

function parseSelection(value: unknown): PreviewSelection | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isPath(value.path) || !isRect(value.rect)) return undefined;
  if (
    !isBoundedString(value.tag, 100) ||
    !isBoundedString(value.className, 1000) ||
    !isBoundedString(value.inlineStyle, 20_000) ||
    !isBoundedString(value.outerHTML, 1_000_000) ||
    !isRecord(value.computed)
  ) {
    return undefined;
  }
  const computed: Record<string, string> = {};
  const entries = Object.entries(value.computed);
  if (entries.length > 32) return undefined;
  for (const [key, part] of entries) {
    if (!/^[a-z-]{1,64}$/.test(key) || !isBoundedString(part, 2000)) return undefined;
    computed[key] = part;
  }
  return {
    path: value.path,
    rect: value.rect,
    tag: value.tag,
    className: value.className,
    inlineStyle: value.inlineStyle,
    outerHTML: value.outerHTML,
    computed,
  };
}

export function parsePreviewEvent(value: unknown): PreviewEvent | null {
  if (
    !isRecord(value) ||
    value.channel !== HTML_PREVIEW_CHANNEL ||
    value.version !== HTML_PREVIEW_VERSION ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  if (value.type === "ready") return { type: "ready" };
  if (value.type === "selection") {
    const selection = parseSelection(value.selection);
    return selection === undefined ? null : { type: "selection", selection };
  }
  if (value.type === "persist" && isBoundedUtf8(value.html, MAX_PREVIEW_HTML_BYTES)) {
    return { type: "persist", html: value.html };
  }
  if (
    value.type === "external-link" &&
    isBoundedString(value.url, 2048) &&
    /^https?:\/\//i.test(value.url)
  ) {
    return { type: "external-link", url: value.url };
  }
  if (
    value.type === "record-result" &&
    isBoundedString(value.requestId, 100) &&
    (value.ext === "mp4" || value.ext === "webm") &&
    value.bytes instanceof ArrayBuffer &&
    value.bytes.byteLength <= MAX_PREVIEW_VIDEO_BYTES
  ) {
    return {
      type: "record-result",
      requestId: value.requestId,
      ext: value.ext,
      bytes: value.bytes,
    };
  }
  if (
    value.type === "record-error" &&
    isBoundedString(value.requestId, 100) &&
    isBoundedString(value.error, 2000)
  ) {
    return { type: "record-error", requestId: value.requestId, error: value.error };
  }
  return null;
}

export function previewCommand(command: PreviewCommand): Record<string, unknown> {
  return {
    channel: HTML_PREVIEW_CHANNEL,
    version: HTML_PREVIEW_VERSION,
    ...command,
  };
}
