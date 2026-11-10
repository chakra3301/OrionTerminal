/* Orion adaptation: storage acknowledgement precedes game construction. */
(() => {
  "use strict";
  const root = document.getElementById("game-root"), message = document.getElementById("save-status");
  const retry = document.getElementById("save-retry"), notice = document.getElementById("save-warning");
  if (!root || !message || !retry || !notice) throw new Error("Adapter document incomplete");
  let controller, input, started = false, starting = false, alive = true, current = null;
  function status(value) {
    if (!alive) return;
    current = value;
    message.textContent = value.message;
    retry.hidden = !value.canRetry;
    retry.disabled = !value.canRetry;
    notice.hidden = !value.dirty;
  }
  async function start() {
    if (!alive || started || starting) return;
    starting = true;
    try {
      const loaded = await controller.load();
      if (!loaded || !alive) return;
      const Input = Orion2048Input.createInputConstructor(document, (value) => { input = value; });
      function Storage() { return controller.facade; }
      const manager = new GameManager(4, Input, HTMLActuator, Storage);
      manager.inputManager.on("keepPlaying", () => { controller.facade.setGameState(manager.serialize()); });
      started = true; root.hidden = false; root.inert = false;
      root.setAttribute("data-game-ready", "true");
    } catch {
      controller?.dispose(); input?.dispose(); root.inert = true; root.hidden = true;
      message.textContent = "Game initialization failed. Close and reopen this app; saved data has not been reset.";
      retry.hidden = true; retry.disabled = true;
    } finally {
      starting = false;
    }
  }
  retry.addEventListener("click", () => {
    if (!alive || !current?.canRetry) return;
    if (started) controller.retry();
    else void start();
  });
  addEventListener("pagehide", () => {
    alive = false; root.inert = true; controller?.dispose(); input?.dispose();
  }, { once: true });
  try {
    controller = Orion2048Adapter.createStore({ get: window.orion.storage.get, set: window.orion.storage.set }, status);
    void start();
  } catch {
    message.textContent = "Orion storage bridge unavailable. Open this package only through Plugin Manager.";
    retry.hidden = true; retry.disabled = true;
  }
})();
