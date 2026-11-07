import { describe, expect, it } from "vitest";
import { dendriteTree, ensureNetwork, fireCell, MAX_PULSES, REFRACTORY, seeded, stepNetwork } from "./neurons";

/** Deterministic random for the tests. */
function lcg(seed = 7) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const ring = (n: number): Array<[number, number]> => Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);

describe("Brain neurons", () => {
  it("grows the same dendrites for the same cell, branching outward", () => {
    const a = dendriteTree(42, 5, 3);
    const b = dendriteTree(42, 5, 3);
    expect(a.map((l) => Array.from(l))).toEqual(b.map((l) => Array.from(l)));
    expect(a).toHaveLength(3);
    // Each level forks in two, so finer levels have more branches.
    const branches = a.map((l) => l.length / 4);
    expect(branches[1]!).toBeGreaterThan(branches[0]!);
    expect(seeded(1, 2)).toBe(seeded(1, 2));
  });

  it("keeps the network while the graph is unchanged and rebuilds when links change", () => {
    const net = ensureNetwork(null, 6, ring(6), lcg());
    expect(ensureNetwork(net, 6, ring(6))).toBe(net);
    expect(ensureNetwork(net, 6, ring(6).slice(1))).not.toBe(net);
  });

  it("fires a cell: it flashes, rests, and sends signals down its axons", () => {
    const net = ensureNetwork(null, 6, ring(6), lcg());
    expect(fireCell(net, 0, { rnd: () => 0 })).toBe(true);
    expect(net.fire[0]).toBe(1);
    expect(net.rest[0]).toBeCloseTo(REFRACTORY);
    expect(net.pulses.map((p) => p.e).sort()).toEqual([0, 5]);
    // Resting cells don't fire again unless forced (hover).
    expect(fireCell(net, 0, { rnd: () => 0 })).toBe(false);
    expect(fireCell(net, 0, { rnd: () => 0, force: true })).toBe(true);
  });

  it("signals travel, arrive, and can fire the next cell", () => {
    const net = ensureNetwork(null, 6, ring(6), lcg());
    net.pulses = [{ e: 0, dir: 1, u: 0, speed: 1 }];
    for (let k = 0; k < 12; k++) stepNetwork(net, 0, 0.1, { spontaneous: false, rnd: () => 0 });
    expect(net.fire[1]!).toBeGreaterThan(0);
    // Cell 1 fired on, so a signal went on to cell 2 (not back down edge 0).
    expect(net.rest[1]!).toBeGreaterThan(0);
  });

  it("never lets activity run away", () => {
    const n = 40;
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j += 3) edges.push([i, j]);
    const net = ensureNetwork(null, n, edges, lcg());
    const rnd = lcg(3);
    for (let k = 0; k < 600; k++) {
      stepNetwork(net, k / 60, 1 / 60, { rnd });
      expect(net.pulses.length).toBeLessThanOrEqual(MAX_PULSES);
    }
  });
});
