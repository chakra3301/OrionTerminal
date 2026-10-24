import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./motion.js', import.meta.url), 'utf8');
function fixture(systemReduced = false) {
  const events = () => ({
    listeners: new Map(),
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    removeEventListener(name) { this.listeners.delete(name); },
    emit(name, event = {}) { this.listeners.get(name)?.(event); },
  });
  const element = (top = 0, initialClasses = []) => {
    const classes = new Set(initialClasses);
    const properties = new Map();
    return { ...events(), dataset: {}, attributes: {},
      classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name), toggle(name, active) { active ? classes.add(name) : classes.delete(name); } },
      style: { setProperty: (name, value) => properties.set(name, value), removeProperty: name => properties.delete(name), getPropertyValue: name => properties.get(name) },
      setAttribute(name, value) { this.attributes[name] = value; },
      getBoundingClientRect: () => ({ top, bottom: top + 500, height: 500, left: 0, width: 1200 }),
    };
  };
  const root = element();
  const hero = element(-200);
  const world = element();
  const toggle = element();
  const previews = [element(100, ['app-visual']), element(1200, ['app-visual'])];
  const ambient = [world, element(), element()];
  const preference = { ...events(), matches: systemReduced };
  const window = { ...events(), matchMedia: query => query.includes('reduced-motion') ? preference : { matches: true } };
  const document = { ...events(), hidden: false, documentElement: root, querySelector: selector => ({ '.hero': hero, '.hero-world': world, '.flow-scenes': ambient[1], '.closing-art': ambient[2], '.motion-toggle': toggle })[selector], querySelectorAll: () => previews };
  const callbacks = new Map();
  const observers = [];
  let lastFrame = 0;
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    intersect(target, isIntersecting) { this.callback([{ target, isIntersecting }]); }
  }
  window.IntersectionObserver = Observer;
  runInNewContext(source, { window, document, IntersectionObserver: Observer, innerHeight: 800, devicePixelRatio: 2,
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: callback => { callbacks.set(++lastFrame, callback); return lastFrame; },
    cancelAnimationFrame: id => callbacks.delete(id),
  });
  return { root, hero, world, toggle, previews, ambient, preference, window, document, callbacks, observers };
}

test('system reduced motion starts static and cannot be overridden by the site', () => {
  const f = fixture(true);
  assert.equal(f.root.dataset.reducedMotion, 'true');
  assert.equal(f.root.classList.contains('motion-enabled'), false);
  assert.equal(f.toggle.disabled, true);
  assert.equal(f.observers.length, 0);
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.window.listeners.has('scroll'), false);
  assert.ok(f.previews.every(preview => !preview.classList.contains('reveal-pending')));
});

test('visibility pauses work, offscreen artwork stops scheduling, preference change releases resources', () => {
  const f = fixture();
  assert.ok(!f.previews[0].classList.contains('reveal-pending'));
  assert.ok(f.previews[1].classList.contains('reveal-pending'));
  f.observers[0].intersect(f.world, true);
  assert.equal(f.callbacks.size, 1);
  f.document.hidden = true;
  f.document.emit('visibilitychange');
  assert.equal(f.root.dataset.motionPaused, 'true');
  assert.equal(f.callbacks.size, 0);
  f.document.hidden = false;
  f.document.emit('visibilitychange');
  assert.equal(f.callbacks.size, 1);
  const [id, callback] = [...f.callbacks][0]; f.callbacks.delete(id); callback();
  assert.equal(f.world.style.getPropertyValue('--hero-y'), '3.5px');
  f.observers[0].intersect(f.world, false);
  f.window.emit('scroll');
  assert.equal(f.callbacks.size, 0);
  f.preference.matches = true;
  f.preference.emit('change');
  assert.equal(f.root.dataset.reducedMotion, 'true');
  assert.equal(f.root.classList.contains('motion-enabled'), false);
  assert.equal(f.observers[0].targets.size, 0);
  assert.equal(f.window.listeners.has('scroll'), false);
  assert.equal(f.world.style.getPropertyValue('--hero-y'), undefined);
});

test('manual reduction and keyboard focus keep every app preview available', () => {
  const f = fixture();
  f.previews[1].emit('focus');
  assert.ok(!f.previews[1].classList.contains('reveal-pending'));
  f.toggle.emit('click');
  assert.equal(f.root.dataset.reducedMotion, 'true');
  assert.equal(f.toggle.attributes['aria-pressed'], 'true');
  f.toggle.emit('click');
  assert.equal(f.root.dataset.reducedMotion, 'false');
  assert.ok(f.root.classList.contains('motion-enabled'));
});
