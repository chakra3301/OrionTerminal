/* Orion adaptation; original game and third-party notices are retained separately. */
(() => {
  "use strict";
  const KEY = "game-v1";
  const exact = (value, keys) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).length === keys.length && keys.every((key) =>
      Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], "value"));
  };
  const four = (value) => {
    if (!Array.isArray(value)) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).length === 5 && descriptors.length?.value === 4 &&
      ["0", "1", "2", "3"].every((key) => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], "value"));
  };
  const score = (value) => Number.isSafeInteger(value) && value >= 0;
  const powerOfTwo = (value) => {
    if (!Number.isSafeInteger(value) || value < 2) return false;
    while (value > 1) {
      if (value % 2 !== 0) return false;
      value /= 2;
    }
    return true;
  };
  function copyGame(game) {
    if (game === null) return null;
    if (!exact(game, ["grid", "score", "over", "won", "keepPlaying"]) || !score(game.score) ||
        ![game.over, game.won, game.keepPlaying].every((value) => typeof value === "boolean") ||
        !exact(game.grid, ["size", "cells"]) || game.grid.size !== 4 ||
        !four(game.grid.cells)) throw new Error("Invalid stored game");
    const cells = Array.from({ length: 4 }, (_, x) => {
      const column = game.grid.cells[x];
      if (!four(column)) throw new Error("Invalid stored grid");
      return Array.from({ length: 4 }, (_, y) => {
        const cell = column[y];
        if (cell === null) return null;
        if (!exact(cell, ["position", "value"]) || !exact(cell.position, ["x", "y"]) ||
            cell.position.x !== x || cell.position.y !== y || !powerOfTwo(cell.value)) throw new Error("Invalid stored tile");
        return { position: { x, y }, value: cell.value };
      });
    });
    return { grid: { size: 4, cells }, score: game.score, over: game.over, won: game.won, keepPlaying: game.keepPlaying };
  }
  function validateEnvelope(value) {
    if (!exact(value, ["version", "bestScore", "gameState"]) || value.version !== 1 || !score(value.bestScore)) {
      throw new Error("Invalid or unsupported stored game");
    }
    const gameState = copyGame(value.gameState);
    if (gameState && gameState.score > value.bestScore) throw new Error("Invalid stored best score");
    const result = { version: 1, bestScore: value.bestScore, gameState };
    if (new TextEncoder().encode(JSON.stringify(result)).length > 16384) throw new Error("Stored game exceeds bounds");
    return result;
  }
  function createStore(storage, onStatus, clock = {
    now: () => globalThis.performance?.now() ?? Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id),
  }) {
    if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function") throw new Error("Storage bridge unavailable");
    let state = null, ready = false, disposed = false, busy = false, failed = false, delayed = false;
    let revision = 0, acknowledged = 0, lastStarted = -Infinity, queued = null, deadline = null;
    const dirty = () => ready && revision !== acknowledged;
    const report = () => {
      if (disposed) return;
      const phase = delayed ? "delayed" : failed ? "failed" : !ready ? "loading" : dirty() ? "saving" : "saved";
      const message = phase === "delayed" ? (ready ? "Save confirmation delayed. Wait for the reply; progress may not be saved." : "Storage response delayed. Waiting; saved data has not been replaced.") :
        phase === "failed" ? (ready ? "Save failed. Progress remains here but is not confirmed saved." : "Could not load a valid supported game. Saved data has not been replaced.") :
        phase === "loading" ? "Loading saved game…" : phase === "saving" ? "Saving…" : "Saved";
      onStatus({ phase, message, ready, dirty: dirty(), canRetry: failed && !busy });
    };
    const clearDeadline = () => { if (deadline !== null) clock.clear(deadline); deadline = null; delayed = false; };
    const startDeadline = () => {
      deadline = clock.set(() => { deadline = null; delayed = true; report(); }, 8000);
    };
    const requireReady = () => { if (!ready || disposed) throw new Error("Game storage is not ready"); };
    function schedule() {
      if (disposed || !ready || failed || busy || queued !== null || !dirty()) return;
      queued = clock.set(() => { queued = null; void publish(); }, Math.max(250, 1000 - (clock.now() - lastStarted)));
    }
    async function publish() {
      if (disposed || !ready || failed || busy || !dirty()) return;
      const snapshot = validateEnvelope(state), sentRevision = revision;
      busy = true; lastStarted = clock.now(); startDeadline(); report();
      try {
        const ack = await storage.set(KEY, snapshot);
        if (disposed) return;
        if (!exact(ack, ["ok"]) || ack.ok !== true) throw new Error("Save not acknowledged");
        acknowledged = sentRevision;
      } catch {
        if (!disposed) failed = true;
      } finally {
        clearDeadline(); busy = false;
        if (!disposed) { report(); schedule(); }
      }
    }
    function change(next) {
      requireReady();
      const copy = validateEnvelope(next);
      if (JSON.stringify(copy) === JSON.stringify(state)) return;
      state = copy; revision++; report(); schedule();
    }
    const facade = Object.freeze({
      getBestScore: () => { requireReady(); return state.bestScore; },
      setBestScore: (value) => {
        requireReady(); if (!score(value)) throw new Error("Invalid best score");
        change({ ...state, bestScore: Math.max(state.bestScore, value) });
      },
      getGameState: () => { requireReady(); return copyGame(state.gameState); },
      setGameState: (value) => {
        requireReady(); const gameState = copyGame(value);
        change({ version: 1, bestScore: Math.max(state.bestScore, gameState?.score || 0), gameState });
      },
      clearGameState: () => { requireReady(); change({ ...state, gameState: null }); },
    });
    async function load() {
      if (disposed || ready || busy) return false;
      if (clock.now() - lastStarted < 1000) { failed = true; report(); return false; }
      busy = true; failed = false; lastStarted = clock.now(); startDeadline(); report();
      try {
        const value = await storage.get(KEY);
        if (disposed) return false;
        state = value === null ? { version: 1, bestScore: 0, gameState: null } : validateEnvelope(value);
        ready = true;
        return true;
      } catch {
        if (!disposed) failed = true;
        return false;
      } finally {
        clearDeadline(); busy = false; report();
      }
    }
    function retry() {
      if (disposed || !ready || !failed || busy) return false;
      failed = false; report(); schedule(); return true;
    }
    function dispose() {
      disposed = true;
      if (queued !== null) clock.clear(queued);
      queued = null; clearDeadline();
    }
    report();
    return Object.freeze({ load, retry, dispose, facade });
  }
  Object.defineProperty(globalThis, "Orion2048Adapter", {
    value: Object.freeze({ KEY, validateEnvelope, createStore }), writable: false, configurable: false,
  });
})();
