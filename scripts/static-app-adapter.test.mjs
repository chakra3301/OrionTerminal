import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const own = fileURLToPath(new URL('../src/features/staticApps/adapter2048/', import.meta.url));
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    now: () => now,
    set(fn, ms) { const key = ++id; timers.set(key, { at: now + ms, fn }); return key; },
    clear(key) { timers.delete(key); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (!due.length) break;
        const [key, timer] = due[0]; timers.delete(key); now = timer.at; timer.fn();
      }
      now = end;
    },
    count: () => timers.size,
  };
}
function context(extra = {}) {
  const c = vm.createContext({ TextEncoder, ...extra });
  for (const name of ['controller.js', 'input.js']) {
    vm.runInContext(fs.readFileSync(path.join(own, name), 'utf8'), c, { filename: name });
  }
  return c;
}
function game(value = 2, points = 0) {
  const cells = Array.from({ length: 4 }, () => Array(4).fill(null));
  cells[0][0] = { position: { x: 0, y: 0 }, value };
  return { grid: { size: 4, cells }, score: points, over: false, won: false, keepPlaying: false };
}
const envelope = (state = game(), best = state.score) => ({ version: 1, bestScore: best, gameState: state });
function rig(storage) {
  const c = context(), time = clock(), statuses = [];
  const store = c.Orion2048Adapter.createStore(storage, (status) => statuses.push(plain(status)), time);
  return { c, time, store, statuses, status: () => statuses.at(-1) };
}

test('valid envelope is cloned, including cells and flags', () => {
  const c = context(), source = envelope(game(2048, 2048), 4096), result = c.Orion2048Adapter.validateEnvelope(source);
  source.gameState.grid.cells[0][0].value = 4;
  assert.equal(result.gameState.grid.cells[0][0].value, 2048);
  assert.equal(result.bestScore, 4096);
});
test('null board and safe large powers of two are supported', () => {
  const c = context();
  assert.deepEqual(plain(c.Orion2048Adapter.validateEnvelope({ version: 1, bestScore: 4, gameState: null })), { version: 1, bestScore: 4, gameState: null });
  assert.equal(c.Orion2048Adapter.validateEnvelope(envelope(game(2 ** 52))).gameState.grid.cells[0][0].value, 2 ** 52);
});
for (const [name, mutate] of [
  ['unknown version', (v) => { v.version = 2; }],
  ['unknown field', (v) => { v.permission = 'process'; }],
  ['negative score', (v) => { v.bestScore = -1; }],
  ['fractional score', (v) => { v.bestScore = 1.5; }],
  ['unsafe score', (v) => { v.bestScore = Number.MAX_SAFE_INTEGER + 1; }],
  ['lower best score', (v) => { v.gameState.score = 4; }],
  ['wrong grid size', (v) => { v.gameState.grid.size = 5; }],
  ['missing column', (v) => { v.gameState.grid.cells.pop(); }],
  ['sparse cells', (v) => { delete v.gameState.grid.cells[0][1]; }],
  ['mismatched position', (v) => { v.gameState.grid.cells[0][0].position.x = 1; }],
  ['non-power tile', (v) => { v.gameState.grid.cells[0][0].value = 3; }],
  ['large nearly-power tile', (v) => { v.gameState.grid.cells[0][0].value = 2 ** 51 + 1; }],
  ['unsafe tile', (v) => { v.gameState.grid.cells[0][0].value = 2 ** 53; }],
  ['nonboolean flag', (v) => { v.gameState.won = 'false'; }],
]) test(`rejects ${name}`, () => {
  const c = context(), value = envelope(); mutate(value);
  assert.throws(() => c.Orion2048Adapter.validateEnvelope(value));
});
test('does not invoke object getter fields during schema checks', () => {
  const c = context(), value = envelope(); let invoked = 0;
  Object.defineProperty(value, 'bestScore', { get() { invoked++; return 0; }, enumerable: true });
  assert.throws(() => c.Orion2048Adapter.validateEnvelope(value)); assert.equal(invoked, 0);
});
test('array getter/extra properties and symbolic fields are rejected without getter invocation', () => {
  const c = context(); let invoked = 0;
  const value = envelope(); Object.defineProperty(value.gameState.grid.cells, '0', { get() { invoked++; return []; }, enumerable: true });
  assert.throws(() => c.Orion2048Adapter.validateEnvelope(value)); assert.equal(invoked, 0);
  const extra = envelope(); extra.gameState.grid.cells[0].unknown = 'unexpected';
  assert.throws(() => c.Orion2048Adapter.validateEnvelope(extra));
  const symbolic = envelope(); symbolic[Symbol('extra')] = true;
  assert.throws(() => c.Orion2048Adapter.validateEnvelope(symbolic));
});
test('storage facade refuses access before preload', () => {
  const r = rig({ get: async () => null, set: async () => ({ ok: true }) });
  assert.throws(() => r.store.facade.getGameState()); assert.throws(() => r.store.facade.setBestScore(4));
  assert.equal(r.status().ready, false);
});
test('preload preserves valid state; returned facade board is a detached copy', async () => {
  const source = envelope(game(4, 4), 8), writes = [];
  const r = rig({ get: async () => source, set: async (_, value) => { writes.push(value); return { ok: true }; } });
  assert.equal(await r.store.load(), true);
  r.store.facade.getGameState().grid.cells[0][0].value = 32;
  assert.equal(r.store.facade.getGameState().grid.cells[0][0].value, 4);
  r.time.advance(20000); await flush(); assert.equal(writes.length, 0);
});
test('malformed/unknown/undefined stored values cause no automatic writes', async () => {
  for (const value of [undefined, {}, { version: 2, bestScore: 0, gameState: null }, 'not JSON']) {
    const writes = [], r = rig({ get: async () => value, set: async (_, data) => { writes.push(data); return { ok: true }; } });
    assert.equal(await r.store.load(), false); assert.equal(r.status().canRetry, true);
    r.time.advance(20000); await flush(); assert.equal(writes.length, 0);
    assert.throws(() => r.store.facade.clearGameState());
  }
});
test('read failure requires explicit throttled retry; preserves data until success', async () => {
  let calls = 0; const r = rig({ get: async () => { if (++calls === 1) throw new Error('denied'); return envelope(game(4, 4), 4); }, set: async () => ({ ok: true }) });
  assert.equal(await r.store.load(), false); assert.equal(await r.store.load(), false); assert.equal(calls, 1);
  r.time.advance(1000); assert.equal(await r.store.load(), true); assert.equal(calls, 2);
  assert.equal(r.store.facade.getBestScore(), 4);
});
test('unresolved read shows delayed status and prevents duplicate requests', async () => {
  const wait = deferred(); let reads = 0; const r = rig({ get: () => { reads++; return wait.promise; }, set: async () => ({ ok: true }) });
  const loading = r.store.load(); r.time.advance(8000);
  assert.equal(r.status().phase, 'delayed'); assert.equal(r.status().canRetry, false);
  assert.equal(await r.store.load(), false); assert.equal(reads, 1);
  wait.resolve(null); assert.equal(await loading, true); assert.equal(r.status().ready, true);
});
test('synchronous score/board updates coalesce into one coherent envelope', async () => {
  const writes = [], r = rig({ get: async () => null, set: async (key, value) => { writes.push({ key, value: plain(value), at: r.time.now() }); return { ok: true }; } });
  await r.store.load(); r.store.facade.setBestScore(8); r.store.facade.setGameState(game(4, 4));
  r.time.advance(999); assert.equal(writes.length, 0);
  r.time.advance(1); await flush(); assert.equal(writes.length, 1);
  assert.equal(writes[0].key, 'game-v1'); assert.equal(writes[0].value.bestScore, 8);
  assert.equal(writes[0].value.gameState.score, 4); assert.equal(r.status().phase, 'saved');
});
test('old write acknowledgement cannot clear a newer revision; writes never overlap', async () => {
  const first = deferred(), writes = []; let active = 0, peak = 0;
  const r = rig({ get: async () => null, set: async (_, value) => {
    active++; peak = Math.max(peak, active); writes.push({ value: plain(value), at: r.time.now() });
    if (writes.length === 1) await first.promise;
    active--; return { ok: true };
  } });
  await r.store.load(); r.store.facade.setGameState(game(2)); r.time.advance(1000);
  r.store.facade.setGameState(game(8, 8)); r.time.advance(2000);
  assert.equal(writes.length, 1); first.resolve(); await flush();
  assert.equal(r.status().dirty, true); r.time.advance(250); await flush();
  assert.equal(writes.length, 2); assert.equal(writes[0].value.gameState.score, 0);
  assert.equal(writes[1].value.gameState.score, 8); assert.equal(peak, 1);
  assert.ok(writes[1].at - writes[0].at >= 1000); assert.equal(r.status().dirty, false);
});
test('failed writes retain latest revision and need an explicit retry', async () => {
  const writes = []; let reject = true;
  const r = rig({ get: async () => null, set: async (_, value) => { writes.push(plain(value)); if (reject) throw new Error('disk'); return { ok: true }; } });
  await r.store.load(); r.store.facade.setGameState(game(2)); r.time.advance(1000); await flush();
  assert.equal(r.status().phase, 'failed'); r.store.facade.setGameState(game(4, 4));
  r.time.advance(20000); await flush(); assert.equal(writes.length, 1); assert.equal(r.status().canRetry, true);
  reject = false; assert.equal(r.store.retry(), true); r.time.advance(250); await flush();
  assert.equal(writes.length, 2); assert.equal(writes[1].gameState.score, 4); assert.equal(r.status().phase, 'saved');
});
test('unresolved save stays exclusive after deadline, then publishes only latest state', async () => {
  const wait = deferred(), writes = [];
  const r = rig({ get: async () => null, set: async (_, value) => { writes.push(plain(value)); if (writes.length === 1) await wait.promise; return { ok: true }; } });
  await r.store.load(); r.store.facade.setGameState(game(2)); r.time.advance(1000); r.time.advance(8000);
  assert.equal(r.status().phase, 'delayed'); assert.equal(r.store.retry(), false);
  r.store.facade.setGameState(game(8, 8)); assert.equal(r.status().phase, 'delayed'); assert.equal(writes.length, 1);
  wait.resolve(); await flush(); r.time.advance(250); await flush(); assert.equal(writes.length, 2);
  assert.equal(writes[1].gameState.score, 8); assert.equal(r.status().phase, 'saved');
});
test('unexpected acknowledgement fails closed', async () => {
  for (const ack of [null, undefined, {}, { ok: false }, { ok: true, unexpected: 1 }]) {
    const r = rig({ get: async () => null, set: async () => ack });
    await r.store.load(); r.store.facade.setGameState(game()); r.time.advance(1000); await flush();
    assert.equal(r.status().phase, 'failed'); assert.equal(r.status().dirty, true);
  }
});
test('clear/new-game operations keep best score; duplicate/lower updates do not publish', async () => {
  const writes = [], r = rig({ get: async () => envelope(game(8, 8), 16), set: async (_, value) => { writes.push(plain(value)); return { ok: true }; } });
  await r.store.load(); r.store.facade.setBestScore(0); r.store.facade.setGameState(game(8, 8));
  r.time.advance(1000); await flush(); assert.equal(writes.length, 0);
  r.store.facade.clearGameState(); r.time.advance(250); await flush();
  assert.equal(writes[0].bestScore, 16); assert.equal(writes[0].gameState, null);
  r.store.facade.setGameState(game(2)); r.time.advance(1000); await flush(); assert.equal(writes[1].bestScore, 16);
});
test('rapid local updates stay below broker quota and preserve safe integer score validation', async () => {
  const times = [], r = rig({ get: async () => null, set: async () => { times.push(r.time.now()); return { ok: true }; } });
  await r.store.load();
  for (let i = 0; i < 300; i++) { r.store.facade.setGameState(game(2, i)); r.time.advance(100); await flush(); }
  assert.ok(times.length <= 30);
  assert.ok(times.every((time, i) => i === 0 || time - times[i - 1] >= 1000));
  assert.throws(() => r.store.facade.setBestScore(Infinity));
  assert.equal(r.store.facade.getBestScore(), 299);
});
test('dispose cancels scheduled work and prevents late read activation', async () => {
  const writes = [], r = rig({ get: async () => null, set: async (_, value) => { writes.push(value); return { ok: true }; } });
  await r.store.load(); r.store.facade.setGameState(game()); r.store.dispose(); r.time.advance(20000); await flush();
  assert.equal(writes.length, 0); assert.equal(r.time.count(), 0); assert.throws(() => r.store.facade.getBestScore());
  const wait = deferred(), second = rig({ get: () => wait.promise, set: async () => ({ ok: true }) });
  const loading = second.store.load(); second.store.dispose(); const count = second.statuses.length;
  wait.resolve(envelope()); assert.equal(await loading, false); assert.equal(second.statuses.length, count);
});
test('dispose ignores late write acknowledgement and does not reschedule', async () => {
  const wait = deferred(); let writes = 0;
  const r = rig({ get: async () => null, set: () => { writes++; return wait.promise; } });
  await r.store.load(); r.store.facade.setGameState(game()); r.time.advance(1000);
  r.store.facade.setGameState(game(4)); r.store.dispose(); const count = r.statuses.length;
  wait.resolve({ ok: true }); await flush(); r.time.advance(20000);
  assert.equal(writes, 1); assert.equal(r.statuses.length, count);
});
test('keyboard map covers arrows, Vim/WASD and R without stealing modifiers or edits', () => {
  const c = context(), fn = c.Orion2048Input.keyboardAction;
  for (const [key, direction] of [['ArrowUp', 0], ['ArrowRight', 1], ['ArrowDown', 2], ['ArrowLeft', 3], ['w', 0], ['d', 1], ['s', 2], ['a', 3], ['k', 0], ['l', 1], ['j', 2], ['h', 3]]) assert.deepEqual(plain(fn({ key }, true)), { type: 'move', direction });
  assert.deepEqual(plain(fn({ key: 'r' }, true)), { type: 'restart' });
  assert.deepEqual(plain(fn({ key: 'R' }, true)), { type: 'restart' });
  assert.deepEqual(plain(fn({ key: 'W' }, true)), { type: 'move', direction: 0 });
  for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented']) assert.equal(fn({ key: 'r', [modifier]: true }, true), null);
  assert.equal(fn({ key: 'ArrowUp' }, false), null); assert.equal(fn({ key: 'Tab' }, true), null);
  assert.equal(fn({ key: 'a', target: { isContentEditable: true } }, true), null);
  assert.equal(fn({ key: 'a', target: { closest: () => ({}) } }, true), null);
});
test('swipes retain source threshold/direction and reject invalid endpoints', () => {
  const fn = context().Orion2048Input.swipeDirection;
  for (const [x, y, result] of [[20, 0, 1], [-20, 0, 3], [0, 20, 2], [0, -20, 0], [10, 0, null], [NaN, 0, null]]) assert.equal(fn({ x: 0, y: 0 }, { x, y }), result);
  assert.equal(fn(null, { x: 0, y: 0 }), null);
});

function fakeDocument() {
  function node() {
    const handlers = new Map();
    return {
      hidden: false, inert: false, disabled: false, textContent: '', focusCount: 0, attributes: {},
      addEventListener(type, fn) { handlers.set(type, [...(handlers.get(type) || []), fn]); },
      removeEventListener(type, fn) { handlers.set(type, (handlers.get(type) || []).filter((v) => v !== fn)); },
      fire(type, event = {}) { event.preventDefault ??= () => {}; for (const fn of handlers.get(type) || []) fn(event); },
      focus() { this.focusCount++; }, setPointerCapture() {}, closest() { return null; },
      setAttribute(key, value) { this.attributes[key] = value; }, handlers,
    };
  }
  const nodes = { root: node(), board: node(), retryGame: node(), newGame: node(), keep: node(), message: node(), retrySave: node(), warning: node() };
  const doc = node(); doc.focused = true; doc.hasFocus = () => doc.focused;
  doc.getElementById = (id) => ({ 'game-root': nodes.root, 'save-status': nodes.message, 'save-retry': nodes.retrySave, 'save-warning': nodes.warning }[id]);
  doc.querySelector = (selector) => ({ '.game-container': nodes.board, '.retry-button': nodes.retryGame, '.restart-button': nodes.newGame, '.keep-playing-button': nodes.keep }[selector]);
  return { doc, nodes };
}
test('input listeners honour inactive/focus/dispose gates and focus only on user action', () => {
  const c = context(), { doc, nodes } = fakeDocument(); let instance;
  const Constructor = c.Orion2048Input.createInputConstructor(doc, (input) => { instance = input; });
  new Constructor(); const moves = []; let restarts = 0;
  instance.on('move', (direction) => moves.push(direction)); instance.on('restart', () => restarts++);
  assert.equal(nodes.board.focusCount, 0);
  doc.fire('keydown', { key: 'ArrowUp' }); assert.deepEqual(moves, [0]);
  doc.focused = false; doc.fire('keydown', { key: 'ArrowRight' }); assert.deepEqual(moves, [0]);
  nodes.root.inert = true; nodes.newGame.fire('click'); assert.equal(restarts, 0);
  nodes.root.inert = false; nodes.newGame.fire('click'); assert.equal(restarts, 1); assert.equal(nodes.board.focusCount, 1);
  instance.dispose(); doc.focused = true; doc.fire('keydown', { key: 'ArrowUp' }); nodes.newGame.fire('click');
  assert.deepEqual(moves, [0]); assert.equal(restarts, 1);
});
test('pointer swipe excludes buttons, mouse, cancelled and secondary touches', () => {
  const c = context(), { doc, nodes } = fakeDocument(); let input;
  new (c.Orion2048Input.createInputConstructor(doc, (value) => { input = value; }))();
  const moves = []; input.on('move', (direction) => moves.push(direction));
  const down = { pointerType: 'touch', pointerId: 1, button: 0, clientX: 0, clientY: 0 };
  const up = { pointerId: 1, clientX: 40, clientY: 0 };
  nodes.board.fire('pointerdown', { ...down, target: { closest: () => ({}) } }); nodes.board.fire('pointerup', up);
  nodes.board.fire('pointerdown', { ...down, pointerType: 'mouse' }); nodes.board.fire('pointerup', up);
  nodes.board.fire('pointerdown', down); nodes.board.fire('pointercancel'); nodes.board.fire('pointerup', up);
  nodes.board.fire('pointerdown', down); nodes.board.fire('pointerdown', { ...down, isPrimary: false, pointerId: 2 }); nodes.board.fire('pointerup', up);
  assert.deepEqual(moves, []);
  nodes.board.fire('pointerdown', down); nodes.board.fire('pointerup', up); assert.deepEqual(moves, [1]);
});
test('bootstrap waits for preload, persists Keep going flag with a host-owned stub (no game code)', async () => {
  const { doc, nodes } = fakeDocument(), time = clock(), read = deferred(), writes = [], lifecycle = new Map();
  nodes.root.hidden = true; nodes.root.inert = true; let constructions = 0, manager;
  const storage = { get: () => read.promise, set: async (_, value) => { writes.push(plain(value)); return { ok: true }; } };
  const c = context({ document: doc, window: { orion: { storage } }, addEventListener: (kind, fn) => lifecycle.set(kind, fn), setTimeout: time.set, clearTimeout: time.clear, Date: { now: time.now },
    HTMLActuator: function StubActuator() {},
    GameManager: function StubGame(size, Input, Actuator, Storage) {
      constructions++; assert.equal(size, 4); manager = this; this.inputManager = new Input();
      const facade = new Storage(); facade.setGameState(game(2048, 2048));
      this.state = game(2048, 2048); this.state.won = true;
      this.serialize = () => this.state;
      this.inputManager.on('keepPlaying', () => { this.state.keepPlaying = true; });
    },
  });
  vm.runInContext(fs.readFileSync(path.join(own, 'boot.js'), 'utf8'), c, { filename: 'boot.js' });
  assert.equal(constructions, 0); assert.equal(nodes.root.hidden, true); read.resolve(null); await flush();
  assert.equal(constructions, 1); assert.equal(nodes.root.attributes['data-game-ready'], 'true'); assert.equal(nodes.board.focusCount, 0);
  nodes.keep.fire('click'); time.advance(1000); await flush();
  assert.equal(writes.length, 1); assert.equal(writes[0].gameState.keepPlaying, true);
  lifecycle.get('pagehide')(); assert.equal(nodes.root.inert, true);
});
test('bootstrap blocks construction on invalid saved state and allows deliberate read retry', async () => {
  const { doc, nodes } = fakeDocument(), time = clock(); let constructions = 0, reads = 0;
  nodes.root.hidden = true; nodes.root.inert = true;
  const c = context({ document: doc, window: { orion: { storage: { get: async () => { reads++; return {}; }, set: async () => { throw new Error('must not write'); } } } },
    addEventListener() {}, setTimeout: time.set, clearTimeout: time.clear, Date: { now: time.now }, GameManager() { constructions++; } });
  vm.runInContext(fs.readFileSync(path.join(own, 'boot.js'), 'utf8'), c); await flush();
  assert.equal(constructions, 0); assert.equal(nodes.root.hidden, true); assert.equal(nodes.retrySave.hidden, false);
  time.advance(1000); nodes.retrySave.fire('click'); await flush(); assert.equal(reads, 2); assert.equal(constructions, 0);
});
