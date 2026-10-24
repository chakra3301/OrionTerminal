import { expect, it } from 'vitest';
import { designEase, designSpringAt, designSpringDuration, isDesignSpring, type DesignSpring } from './reactExportRuntime';

const spring: DesignSpring = { type: 'spring', mass: 1, stiffness: 100, damping: 10, initialVelocity: 0 };
function integrate(config: DesignSpring, seconds: number) {
  let x = 0, v = config.initialVelocity ?? 0;
  const steps = Math.ceil(seconds / 0.0001), dt = seconds / steps;
  const acceleration = (position: number, velocity: number) => (config.stiffness * (1 - position) - config.damping * velocity) / config.mass;
  for (let step = 0; step < steps; step++) {
    const a = acceleration(x, v), b = acceleration(x + v * dt / 2, v + a * dt / 2), c = acceleration(x + (v + a * dt / 2) * dt / 2, v + b * dt / 2), d = acceleration(x + (v + b * dt / 2) * dt, v + c * dt);
    x += dt / 6 * (v + 2 * (v + a * dt / 2) + 2 * (v + b * dt / 2) + v + c * dt);
    v += dt / 6 * (a + 2 * b + 2 * c + d);
  }
  return { x, v };
}
it.each([
  { damping: 10 }, { damping: 20 }, { damping: 40 }, { damping: 19.9999 }, { damping: 20.0001 },
  { mass: 2, stiffness: 400, damping: 20 }, { initialVelocity: 12 }, { initialVelocity: -5 },
])('matches an independent RK4 spring simulation for %j', patch => {
  const config = { ...spring, ...patch };
  for (const seconds of [0.001, 0.037, 0.1, 0.4, 1, 2]) expect(designSpringAt(config, seconds)).toBeCloseTo(integrate(config, seconds).x, 6);
  expect(designSpringAt(config, 0)).toBeCloseTo(0, 10);
});
it('preserves physical overshoot, initial velocity and dimensional parameter scaling', () => {
  expect(designSpringAt(spring, 0.4)).toBeGreaterThan(1.1);
  expect(designSpringAt({ ...spring, initialVelocity: -5 }, 0.001)).toBeLessThan(0);
  const scaled = { ...spring, mass: 2, stiffness: 200, damping: 20 };
  expect(designSpringAt(scaled, 0.4)).toBeCloseTo(designSpringAt(spring, 0.4), 10);
  expect(designSpringDuration(scaled)).toBe(designSpringDuration(spring));
  expect(designSpringDuration({ ...spring, mass: 2 })).toBeGreaterThan(designSpringDuration(spring));
});
it.each([spring, { ...spring, damping: 20 }, { ...spring, damping: 40 }, { ...spring, initialVelocity: 12 }])('chooses a finite settled duration for %j', config => {
  const duration = designSpringDuration(config);
  expect(Number.isInteger(duration)).toBe(true); expect(duration).toBeGreaterThan(0); expect(duration).toBeLessThanOrEqual(10000);
  for (const extra of [0, 0.01, 0.1, 0.5, 1]) { const state = integrate(config, duration / 1000 + extra); expect(Math.abs(1 - state.x)).toBeLessThanOrEqual(0.001); expect(Math.abs(state.v)).toBeLessThanOrEqual(0.001); }
  expect(designEase(0, config, duration)).toBe(0); expect(designEase(1, config, duration)).toBe(1);
  expect(designEase(0.2, config, duration)).toBeCloseTo(integrate(config, duration / 5000).x, 6);
});
it('refuses non-finite, ill-typed, unbounded and non-settling springs', () => {
  for (const invalid of [null, [], { ...spring, type: 'cubic' }, { ...spring, initialVelocity: null }, { ...spring, mass: 0 }, { ...spring, stiffness: Infinity }, { ...spring, damping: NaN }, { ...spring, mass: 101 }, { ...spring, stiffness: 10001 }, { ...spring, initialVelocity: -101 }]) expect(isDesignSpring(invalid)).toBe(false);
  expect(isDesignSpring({ type: 'spring', mass: 1, stiffness: 100, damping: 10 })).toBe(true);
  expect(() => designSpringAt({ ...spring, mass: 0 }, 1)).toThrow('finite positive');
  expect(() => designSpringAt(spring, -1)).toThrow(); expect(() => designSpringAt(spring, NaN)).toThrow();
  expect(() => designSpringDuration({ ...spring, damping: 0.01 })).toThrow('ten seconds');
  expect(() => designSpringDuration({ ...spring, mass: 100, stiffness: 0.01, damping: 1000 })).toThrow('ten seconds');
  for (let index = 0; index < 140; index++) expect(designSpringDuration({ ...spring, stiffness: 100 + index })).toBeGreaterThan(0);
  expect(designSpringDuration(spring)).toBeGreaterThan(0);
});
it('keeps linear and cubic easing exact at endpoints and computes the cubic time coordinate', () => {
  expect(designEase(0.3, 'linear')).toBe(0.3);
  expect(designEase(0.5, [0.42, 0, 0.58, 1])).toBeCloseTo(0.5, 5);
  expect(designEase(0.5, 'ease-in')).toBeCloseTo(0.315357, 5);
  expect(designEase(0.5, 'ease-out')).toBeCloseTo(0.684643, 5);
});
