/* Orion adaptation: input stays inside the focused child; no parent key forwarding. */
(() => {
  "use strict";
  const directions = Object.freeze({ ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, k: 0, l: 1, j: 2, h: 3, w: 0, d: 1, s: 2, a: 3 });
  function keyboardAction(event, focused) {
    const target = event.target;
    if (!focused || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        target?.isContentEditable || target?.closest?.("input, textarea, select, button, a, summary, [role='button'], [role='textbox'], [contenteditable]:not([contenteditable='false'])")) return null;
    const key = typeof event.key === "string" && event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (Object.hasOwn(directions, key)) return { type: "move", direction: directions[key] };
    return key === "r" ? { type: "restart" } : null;
  }
  function swipeDirection(start, end) {
    if (!start || !end || ![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null;
    const dx = end.x - start.x, dy = end.y - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= 10) return null;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  }
  function createInputConstructor(doc, onCreated) {
    const root = doc.getElementById("game-root"), board = doc.querySelector(".game-container");
    if (!root || !board) throw new Error("Game controls unavailable");
    return function OrionInputManager() {
      const events = new Map(), listeners = [];
      let disposed = false, pointer = null;
      const usable = () => !disposed && !root.hidden && !root.inert;
      this.on = (kind, fn) => {
        if (!["move", "restart", "keepPlaying"].includes(kind) || typeof fn !== "function") throw new Error("Invalid game input");
        events.set(kind, [...(events.get(kind) || []), fn]);
      };
      const emit = (kind, value) => {
        if (usable()) for (const fn of events.get(kind) || []) fn(value);
      };
      const listen = (node, type, fn, options) => {
        node.addEventListener(type, fn, options);
        listeners.push(() => node.removeEventListener(type, fn, options));
      };
      listen(doc, "keydown", (event) => {
        if (!usable()) return;
        const action = keyboardAction(event, doc.hasFocus());
        if (!action) return;
        event.preventDefault(); emit(action.type, action.direction);
      });
      for (const [selector, kind] of [[".retry-button", "restart"], [".restart-button", "restart"], [".keep-playing-button", "keepPlaying"]]) {
        const button = doc.querySelector(selector);
        if (!button) throw new Error("Game button unavailable");
        listen(button, "click", (event) => {
          if (!usable() || button.disabled) return;
          event.preventDefault(); emit(kind); board.focus({ preventScroll: true });
        });
      }
      listen(board, "pointerdown", (event) => {
        if (!usable()) return;
        if (event.isPrimary === false) { pointer = null; return; }
        if (event.target?.closest?.("button, a")) return;
        if (event.button !== 0) return;
        board.focus({ preventScroll: true });
        if (!["touch", "pen"].includes(event.pointerType)) return;
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        board.setPointerCapture(event.pointerId);
      });
      listen(board, "pointerup", (event) => {
        if (!pointer || pointer.id !== event.pointerId) return;
        const start = pointer; pointer = null;
        if (!usable() || !doc.hasFocus()) return;
        const direction = swipeDirection(start, { x: event.clientX, y: event.clientY });
        if (direction !== null) { event.preventDefault(); emit("move", direction); }
      });
      const cancelPointer = () => { pointer = null; };
      listen(board, "pointercancel", cancelPointer);
      listen(board, "lostpointercapture", cancelPointer);
      this.dispose = () => { disposed = true; pointer = null; for (const remove of listeners) remove(); events.clear(); };
      onCreated(this);
    };
  }
  Object.defineProperty(globalThis, "Orion2048Input", {
    value: Object.freeze({ keyboardAction, swipeDirection, createInputConstructor }), writable: false, configurable: false,
  });
})();
