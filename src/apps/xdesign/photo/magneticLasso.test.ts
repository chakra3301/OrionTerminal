import { afterEach, describe, expect, it, vi } from "vitest";
import { compactMagneticPath, MagneticDraft, magneticWidth, type MagneticRequest, type MagneticTrace } from "./magneticLasso";
const settings = { width: 10, contrast: 10, frequency: 0 };
const trace = (request: MagneticRequest): MagneticTrace => ({ points: request.guide, snapped: false, visited: request.guide.length });
afterEach(() => vi.useRealTimers());
describe("magnetic outline sequencing", () => {
  it("compacts exact straight runs while preserving corners, reversals and subpixels", () => {
    expect(compactMagneticPath([[0,0],[0,0],[1,0],[2,0],[2,1],[2,2],[2,1],[2.25,1.5]])).toEqual([[0,0],[2,0],[2,2],[2,1],[2.25,1.5]]);
    expect(compactMagneticPath([[30,10],[30+10/3,10+20/3],[30+20/3,10+40/3],[40,30]])).toEqual([[30,10],[40,30]]);
    expect(compactMagneticPath([[99990,99980],[99990+10/3,99980+20/3],[99990+20/3,99980+40/3],[100000,100000]])).toEqual([[99990,99980],[100000,100000]]);
    expect(magneticWidth(10,1,true)).toBeCloseTo(2); expect(magneticWidth(10,.5,true)).toBe(6); expect(magneticWidth(10,1,false)).toBe(10); expect(magneticWidth(1,1,true)).toBe(1); expect(magneticWidth(1000,0,true)).toBe(256);
  });
  it("serializes requests and retains native prefix feedback during pointer motion", async () => {
    vi.useFakeTimers(); const pending: Array<(value: MagneticTrace) => void> = [];
    const load = vi.fn((_request: MagneticRequest) => new Promise<MagneticTrace>(resolve => pending.push(resolve))); const changed = vi.fn();
    const draft = new MagneticDraft([10,10],settings,load,changed);
    draft.move([20,10]); await vi.advanceTimersByTimeAsync(40); expect(load).toHaveBeenCalledOnce();
    draft.move([25,15]); draft.move([30,20]); expect(load).toHaveBeenCalledOnce();
    pending.shift()!({points:[[10,10],[15,9],[20,10]],snapped:true,visited:40}); await Promise.resolve(); await Promise.resolve();
    expect(draft.snapshot.points).toContainEqual([15,9]); expect(draft.snapshot.points.at(-1)).toEqual([30,20]);
    await vi.advanceTimersByTimeAsync(40); expect(load).toHaveBeenCalledTimes(2); draft.dispose(); pending.shift()!(trace(load.mock.calls[1]![0])); await Promise.resolve();
  });
  it("places multiple frequency anchors on native geometry and removes one at a time", async () => {
    vi.useFakeTimers(); const load = vi.fn(async (request: MagneticRequest) => ({...trace(request), points: Array.from({length:91},(_,i)=>[10+i,10] as [number,number])}));
    const low = new MagneticDraft([10,10],settings,load,()=>{}); low.move([100,10]); await vi.advanceTimersByTimeAsync(40); expect(low.snapshot.anchors.length).toBe(2);
    const high = new MagneticDraft([10,10],{...settings,frequency:100},load,()=>{}); high.move([100,10]); await vi.advanceTimersByTimeAsync(40); expect(high.snapshot.anchors.length).toBeGreaterThan(20);
    const count = high.snapshot.anchors.length; high.undo(); expect(high.snapshot.anchors.length).toBe(count-1); expect(high.snapshot.points.at(-1)).toEqual(high.snapshot.anchors.at(-1)); low.dispose(); high.dispose();
  });
  it("pins manual endpoints and waits for fresh tracing after an old reply", async () => {
    vi.useFakeTimers(); let finish!: (value: MagneticTrace) => void;
    let calls=0; const load = vi.fn((request: MagneticRequest): Promise<MagneticTrace> => ++calls===1 ? new Promise<MagneticTrace>(resolve=>finish=resolve) : Promise.resolve(trace(request)));
    const draft = new MagneticDraft([10.25,10.5],settings,load,()=>{}); draft.move([20,15]); await vi.advanceTimersByTimeAsync(40);
    const anchor = draft.fasten([25.25,20.5]); expect(draft.locked).toBe(true); finish({points:[[10.25,10.5],[20,99]],snapped:true,visited:1}); await anchor;
    expect(load.mock.lastCall![0].fixedEnd).toBe(true); expect(draft.snapshot.anchors.at(-1)).toEqual([25.25,20.5]); expect(draft.snapshot.points).not.toContainEqual([20,99]); draft.dispose();
  });
  it("Alt manual segments retain freehand corners and ignore cancelled native replies", async () => {
    vi.useFakeTimers(); let finish!: (value: MagneticTrace) => void; const changed=vi.fn();
    const draft = new MagneticDraft([10,10],settings,()=>new Promise(resolve=>finish=resolve),changed); draft.move([20,10]); await vi.advanceTimersByTimeAsync(40);
    draft.previewManual([[30,10],[30,25]]); await draft.fasten([35,25],[[30,10],[30,25]]);
    expect(draft.snapshot.points).toEqual([[10,10],[30,10],[30,25],[35,25]]);
    const count = changed.mock.calls.length; draft.dispose(); finish({points:[[10,10],[20,99]],snapped:true,visited:1}); await Promise.resolve(); await Promise.resolve(); expect(changed).toHaveBeenCalledTimes(count);
  });
  it("keeps trace failures retryable and refuses malformed native outlines", async () => {
    const load = vi.fn(async (request: MagneticRequest) => trace(request)); load.mockRejectedValueOnce(new Error("corridor too large"));
    const draft = new MagneticDraft([10,10],settings,load,()=>{}); draft.move([20,15]); expect(await draft.outline()).toBeNull(); expect(draft.snapshot.error).toContain("corridor too large");
    await draft.fasten([25,20]); expect(draft.snapshot.error).toBeNull(); draft.move([30,10]); expect(await draft.outline()).toEqual([[10,10],[20,15],[25,20],[30,10]]); draft.dispose();
    const bad = new MagneticDraft([1,1],settings,async()=>({points:[[1,1],[NaN,20]],snapped:true,visited:1}),()=>{}); bad.move([10,20]); expect(await bad.outline()).toBeNull(); expect(bad.snapshot.error).toContain("invalid magnetic trace"); bad.dispose();
  });
});
