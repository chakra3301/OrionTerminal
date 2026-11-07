import { describe, expect, it } from "vitest";
import { ensureNetwork, fireCell, MAX_PULSES, REFRACTORY, seeded, stepNetwork, veinWidth } from "./veins";

/** Deterministic random for the tests. */
function lcg(seed = 7) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const ring = (n: number): Array<[number, number]> => Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);

describe("Brain veins", () => {
  it("is widest where a link leaves a note and thins toward the middle", () => {
    const len = 200;
    const atA = veinWidth(0, len, 4, 2, 0.35, 16);
    const mid = veinWidth(len / 2, len / 2, 4, 2, 0.35, 16);
    const atB = veinWidth(len, 0, 4, 2, 0.35, 16);
    expect(atA).toBeGreaterThan(atB);
    expect(atB).toBeGreaterThan(mid);
    expect(mid).toBeLessThan(0.4);
    expect(seeded(1, 2)).toBe(seeded(1, 2));
  });

  it("keeps the network while the graph is unchanged and rebuilds when links change", () => {
    const net = ensureNetwork(null, 6, ring(6), lcg());
    expect(ensureNetwork(net, 6, ring(6))).toBe(net);
    expect(ensureNetwork(net, 6, ring(6).slice(1))).not.toBe(net);
  });

  it("fires a note: it glows, rests, and sends signals down its real links only", () => {
    const net = ensureNetwork(null, 6, ring(6), lcg());
    expect(fireCell(net, 0, { rnd: () => 0 })).toBe(true);
    expect(net.fire[0]).toBe(1);
    expect(net.rest[0]).toBeCloseTo(REFRACTORY);
    expect(net.pulses.map((p) => p.e).sort()).toEqual([0, 5]);
    expect(fireCell(net, 0, { rnd: () => 0 })).toBe(false);
    expect(fireCell(net, 0, { rnd: () => 0, force: true })).toBe(true);
  });

  it("signals travel, arrive, and can pass on", () => {
    const net = ensureNetwork(null, 6, ring(6), lcg());
    net.pulses = [{ e: 0, dir: 1, u: 0, speed: 1 }];
    for (let k = 0; k < 12; k++) stepNetwork(net, 0, 0.1, { spontaneous: false, rnd: () => 0 });
    expect(net.fire[1]!).toBeGreaterThan(0);
    expect(net.rest[1]!).toBeGreaterThan(0);
  });

  it("never fires a note with no links, and never lets activity run away", () => {
    const lonely = ensureNetwork(null, 2, [], lcg());
    stepNetwork(lonely, 100, 0.016, { rnd: lcg(2) });
    expect(lonely.fire[0]).toBe(0);
    const n = 40;
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j += 3) edges.push([i, j]);
    const net = ensureNetwork(null, n, edges, lcg());
    const rnd = lcg(3);
    for (let k = 0; k < 600; k++) {
      stepNetwork(net, k / 2, 1 / 2, { rnd });
      expect(net.pulses.length).toBeLessThanOrEqual(MAX_PULSES);
    }
  });
});
