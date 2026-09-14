(() => {
  const channel = "orion:xdesign-preview";
  const version = 1;
  const send = (message) => parent.postMessage({ channel, version, ...message }, "*");
  const fail = (error) => send({ type: "startup-error", error: String(error).slice(0, 1000) });

  // Never execute a document's code in the privileged shell or a same-origin frame.
  if (parent === window) return;
  try {
    void parent.document;
    return;
  } catch {}
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
    fail("Native APIs are unexpectedly present in the preview.");
    return;
  }

  try {
    const payload = document.getElementById("xd-preview-payload");
    if (!payload) throw new Error("Missing preview bootstrap data.");
    const config = JSON.parse(payload.textContent);
    payload.remove();
    if (config.role === "guard") {
      const frame = document.createElement("iframe");
      frame.title = "Generated content";
      frame.sandbox = "allow-scripts";
      frame.style.cssText = "border:0;width:100%;height:100%;display:block";
      frame.srcdoc = config.html;
      let watchdog;
      frame.addEventListener("load", () => {
        send({ type: "loading" });
        clearTimeout(watchdog);
        watchdog = setTimeout(() => fail("Preview stopped responding or navigated away. Close and reopen it to retry."), 8000);
        frame.contentWindow?.postMessage({ channel, version, type: "ping" }, "*");
      });
      const events = new Set(["ready", "startup-error", "selection", "persist", "external-link", "record-result", "record-error"]);
      const commands = new Set(["set-edit", "patch-style", "delete-selection", "duplicate-selection", "move-selection", "record-canvas"]);
      window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || data.channel !== channel || data.version !== version) return;
        if (event.source === parent && commands.has(data.type)) {
          frame.contentWindow?.postMessage(data, "*");
        } else if (event.source === frame.contentWindow && events.has(data.type)) {
          if (data.type === "ready") clearTimeout(watchdog);
          if (data.type === "persist" && (typeof data.html !== "string" || data.html.length > 25000000)) return;
          if (data.type === "record-result") {
            if (!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength > 100000000) return;
            parent.postMessage(data, "*", [data.bytes]);
          } else parent.postMessage(data, "*");
        }
      });
      document.body.append(frame);
      return;
    }
    if (config.role !== "content" || typeof config.bridge !== "string") {
      throw new Error("Invalid preview bootstrap data.");
    }
    const sources = [];
    for (const script of document.querySelectorAll("script[data-xd-script-type]")) {
      const type = script.getAttribute("data-xd-script-type");
      script.removeAttribute("data-xd-script-type");
      if (type) script.type = type;
      else script.removeAttribute("type");
      if (type === "module") throw new Error("Isolated previews require standalone JavaScript, not module imports.");
      sources.push(script.textContent);
    }
    // Opaque frames cannot reliably fetch the shell's blob scripts. Only this
    // child realm evaluates document code; the guard never evaluates its payload.
    (0, eval)(config.bridge);
    (0, eval)(sources.join("\n;\n"));
  } catch (error) {
    fail(error instanceof Error ? error.message : "Preview initialization failed.");
  }
})();
