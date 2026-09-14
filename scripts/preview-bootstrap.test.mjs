import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/apps/xdesign/preview-bootstrap.js", import.meta.url), "utf8");
const envelope = (type, extra = {}) => ({ channel: "orion:xdesign-preview", version: 1, type, ...extra });

function fixture(config, scripts = []) {
  const sent = [], commands = [], listeners = {}, timers = new Map();
  let timerId = 0;
  const parent = {
    get document() { throw new Error("Cross-origin document"); },
    postMessage(message, _origin, transfer) { sent.push({ message, transfer }); },
  };
  const frame = {
    contentWindow: { postMessage(message) { commands.push(message); } },
    style: {},
    addEventListener(type, fn) { listeners[`frame:${type}`] = fn; },
  };
  const context = vm.createContext({
    parent,
    document: {
      getElementById() { return { textContent: JSON.stringify(config), remove() {} }; },
      createElement(tag) { assert.equal(tag, "iframe"); return frame; },
      querySelectorAll() { return scripts; },
      body: { append(node) { assert.equal(node, frame); } },
    },
    addEventListener(type, fn) { listeners[type] = fn; },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext("window = globalThis", context);
  return { context, sent, commands, listeners, parent, frame, timers, run: () => vm.runInContext(source, context) };
}

function script(text, type = "") {
  const attrs = { "data-xd-script-type": type };
  return { textContent: text, type: "application/x-orion-preview-script", attrs,
    getAttribute(key) { return attrs[key]; },
    removeAttribute(key) { delete attrs[key]; if (key === "type") this.type = ""; },
  };
}

test("only the exact normalized bootstrap is authorized by both shell policies", () => {
  const hash = `'sha256-${createHash("sha256").update(source.replace(/\r\n?/g, "\n")).digest("base64")}'`;
  const manifest = JSON.parse(readFileSync(new URL("../resources/preview-bootstrap-integrity.json", import.meta.url), "utf8"));
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.equal(manifest.scriptSource, hash, "Run npm run sync:preview-csp after changing the bootstrap");
  for (const name of ["csp", "devCsp"]) {
    assert(config.app.security[name]["script-src"].split(/\s+/).includes(hash));
    assert(!config.app.security[name]["script-src"].includes("'unsafe-inline'"));
  }
});

test("bootstrap refuses the main frame, same-origin frames, and injected native APIs", () => {
  const root = fixture({ role: "content", bridge: "executed=true" });
  vm.runInContext("parent=window", root.context); root.run();
  assert.equal(root.context.executed, undefined);
  const sameOrigin = fixture({ role: "content", bridge: "executed=true" });
  sameOrigin.context.parent = { document: {} }; sameOrigin.run();
  assert.equal(sameOrigin.context.executed, undefined);
  const native = fixture({ role: "content", bridge: "executed=true" });
  native.context.__TAURI_INTERNALS__ = {}; native.run();
  assert.equal(native.context.executed, undefined);
  assert.equal(native.sent[0].message.type, "startup-error");
});

test("guard never evaluates document code and relays only matching sources and directions", () => {
  const f = fixture({ role: "guard", html: "<script>executed=true</script>", bridge: "executed=true" }); f.run();
  assert.equal(f.context.executed, undefined);
  assert.equal(f.frame.sandbox, "allow-scripts");
  const emit = (source, data) => f.listeners.message({ source, data });
  emit({}, envelope("ready"));
  emit(f.parent, envelope("persist", { html: "untrusted" }));
  emit(f.frame.contentWindow, envelope("set-edit", { enabled: true }));
  assert.equal(f.sent.length, 0); assert.equal(f.commands.length, 0);
  emit(f.parent, envelope("set-edit", { enabled: true }));
  assert.equal(f.commands[0].type, "set-edit");
  emit(f.frame.contentWindow, envelope("ready"));
  assert.equal(f.sent[0].message.type, "ready");
  emit(f.frame.contentWindow, envelope("persist", { html: "x".repeat(25000001) }));
  assert.equal(f.sent.length, 1);
});

test("child code executes only in its realm and original scripts survive serialization", () => {
  const node = script("window.documentCodeRan=true");
  const f = fixture({ role: "content", bridge: "window.bridgeRan=true" }, [node]); f.run();
  assert.equal(f.context.bridgeRan, true); assert.equal(f.context.documentCodeRan, true);
  assert.equal(node.type, ""); assert.equal(node.attrs["data-xd-script-type"], undefined);
  const module = fixture({ role: "content", bridge: "window.bridgeRan=true" }, [script("executed=true", "module")]); module.run();
  assert.equal(module.context.executed, undefined);
  assert.match(module.sent[0].message.error, /standalone JavaScript/);
});

test("navigation watchdog reports missing child bridge and clears on ready", () => {
  const f = fixture({ role: "guard", html: "<h1>fixture</h1>" }); f.run();
  f.listeners["frame:load"]();
  assert.equal(f.sent[0].message.type, "loading"); assert.equal(f.commands[0].type, "ping");
  f.listeners.message({ source: f.frame.contentWindow, data: envelope("ready") });
  assert.equal(f.timers.size, 0);
  f.listeners["frame:load"]();
  [...f.timers.values()][0]();
  assert.equal(f.sent.at(-1).message.type, "startup-error");
});
