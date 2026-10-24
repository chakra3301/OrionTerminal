export type MagneticPoint = [number, number];
export type MagneticSettings = { width: number; contrast: number; frequency: number };
export type MagneticRequest = { guide: MagneticPoint[]; width: number; contrast: number; fixedEnd?: boolean };
export type MagneticTrace = { points: MagneticPoint[]; snapped: boolean; visited: number };
export type MagneticSnapshot = { points: MagneticPoint[]; anchors: MagneticPoint[]; pending: boolean; snapped: boolean; error: string | null };
const MAX_POINTS = 8192;
const length = (a: MagneticPoint, b: MagneticPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a: MagneticPoint, b: MagneticPoint) => a[0] === b[0] && a[1] === b[1];

export function compactMagneticPath(points: readonly MagneticPoint[]): MagneticPoint[] {
  const out: MagneticPoint[] = [];
  for (const p of points) {
    if (out.length && same(p, out.at(-1)!)) continue;
    while (out.length >= 2) {
      const a = out.at(-2)!, b = out.at(-1)!;
      const abx = b[0] - a[0], aby = b[1] - a[1], bpx = p[0] - b[0], bpy = p[1] - b[1];
      // Resampling a straight pointer segment introduces floating subtraction error.
      const roundoff = Number.EPSILON * 32 * Math.max(1, ...a.map(Math.abs), ...b.map(Math.abs), ...p.map(Math.abs)) * (Math.abs(abx) + Math.abs(aby) + Math.abs(bpx) + Math.abs(bpy) + 1);
      if (Math.abs(abx * bpy - aby * bpx) > roundoff || abx * bpx + aby * bpy < 0) break;
      out.pop();
    }
    out.push([...p]);
  }
  return out;
}

export function magneticWidth(width: number, pressure: number, enabled: boolean): number {
  return Math.max(1, Math.min(256, width * (enabled && Number.isFinite(pressure) ? 1 - .8 * Math.max(0, Math.min(1, pressure)) : 1)));
}

// A prefix response remains useful while the pointer moves. It is accepted only
// for its original anchor, then the unsolved pointer suffix stays provisional.
export class MagneticDraft {
  private pieces: MagneticPoint[][] = [];
  private guide: MagneticPoint[];
  private tail: MagneticPoint[];
  private resolved = 1;
  private generation = 0;
  private flight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private editing = false;
  private snapped = false;
  private error: string | null = null;
  private fixedEnd = false;
  constructor(private start: MagneticPoint, private settings: MagneticSettings, private load: (request: MagneticRequest) => Promise<MagneticTrace>, private changed: (snapshot: MagneticSnapshot) => void) {
    this.guide = [[...start]]; this.tail = [[...start]];
  }
  get snapshot(): MagneticSnapshot {
    return { points: this.pieces.flatMap(piece => piece.slice(0, -1)).concat(this.tail), anchors: [this.start, ...this.pieces.map(piece => piece.at(-1)!)], pending: !!this.flight || !!this.timer || this.resolved < this.guide.length, snapped: this.snapped, error: this.error };
  }
  get locked() { return this.editing || this.disposed; }
  configure(settings: MagneticSettings) {
    if (settings.width === this.settings.width && settings.contrast === this.settings.contrast && settings.frequency === this.settings.frequency) return;
    this.settings = settings; this.generation++; this.resolved = 1; this.error = null;
    this.schedule();
  }
  move(point: MagneticPoint) {
    if (this.locked || point.some(v => !Number.isFinite(v))) return;
    const last = this.guide.at(-1)!; const count = Math.max(1, Math.ceil(length(last, point) / 8));
    if (this.guide.length + count > MAX_POINTS) { this.error = "Add a fastening point before tracing farther."; this.emit(); return; }
    if (length(last, point) < .25) return;
    for (let i = 1; i <= count; i++) {
      const next: MagneticPoint = [last[0] + (point[0] - last[0]) * i / count, last[1] + (point[1] - last[1]) * i / count];
      this.guide.push(next); this.tail.push(next);
    }
    this.error = null; this.emit(); this.schedule();
  }
  async fasten(point: MagneticPoint, manual?: MagneticPoint[]) {
    if (this.locked) return;
    this.move(point); this.editing = true;
    try {
      let path: MagneticPoint[];
      if (manual) {
        this.invalidate(); path = compactMagneticPath([this.guide[0]!, ...manual, point]);
      } else {
        this.fixedEnd = true; this.generation++; this.resolved = 1;
        await this.flush(); path = compactMagneticPath(this.tail);
      }
      if (this.disposed) return;
      const total = this.pieces.reduce((n, p) => n + p.length - 1, 0) + path.length;
      if (total > MAX_POINTS) throw new Error("This outline is too detailed; remove a fastening point or use a shorter outline.");
      if (path.length > 1) this.pieces.push(path);
      const anchor = path.at(-1)!; this.guide = [[...anchor]]; this.tail = [[...anchor]]; this.resolved = 1; this.generation++; this.error = null;
    } catch (error) { if (!this.disposed) this.error = String(error); }
    finally { this.fixedEnd = false; this.editing = false; this.emit(); }
  }
  undo() {
    if (this.locked) return;
    this.invalidate(); const piece = this.pieces.pop();
    if (!piece) { this.guide = [[...this.start]]; this.tail = [[...this.start]]; }
    else { this.guide = [[...piece[0]!]]; this.tail = [[...piece[0]!]]; }
    this.resolved = 1; this.error = null; this.emit();
  }
  previewManual(points: MagneticPoint[]) {
    if (this.locked) return;
    this.invalidate(); const anchor = this.guide[0]!;
    this.guide = [[...anchor]]; this.tail = compactMagneticPath([anchor, ...points]); this.resolved = 1; this.error = null; this.emit();
  }
  async outline(): Promise<MagneticPoint[] | null> {
    if (this.locked) return null;
    this.editing = true;
    try { await this.flush(); const points = compactMagneticPath(this.snapshot.points); if (points.length < 3 || points.length > MAX_POINTS) throw new Error("Trace an outline with at least three points before closing."); return points; }
    catch (error) { if (!this.disposed) { this.error = String(error); this.emit(); } return null; }
    finally { this.editing = false; }
  }
  private invalidate() { this.generation++; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  dispose() { this.disposed = true; this.invalidate(); }
  private emit() { if (!this.disposed) this.changed(this.snapshot); }
  private schedule() {
    if (this.disposed || this.flight || this.timer || this.guide.length <= this.resolved) return;
    this.timer = setTimeout(() => { this.timer = null; void this.pump(); }, 40);
  }
  private async flush() {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    while (!this.disposed && this.guide.length > this.resolved) {
      await (this.flight ?? this.pump());
      if (this.error) throw new Error(this.error);
      if (this.timer) clearTimeout(this.timer); this.timer = null;
    }
    if (this.disposed) throw new Error("Magnetic outline was cancelled.");
    if (this.error) throw new Error(this.error);
  }
  private pump(): Promise<void> {
    if (this.flight) return this.flight;
    const guide = this.guide.map(p => [...p] as MagneticPoint), generation = this.generation;
    if (this.disposed || guide.length < 2) return Promise.resolve();
    this.flight = (async () => {
      try {
        const trace = await this.load({ guide, width: this.settings.width, contrast: this.settings.contrast, ...(this.fixedEnd ? { fixedEnd: true } : {}) });
        if (this.disposed || generation !== this.generation) return;
        if (trace.points.length < 2 || trace.points.length > MAX_POINTS || trace.points.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v))) || !same(trace.points[0]!, guide[0]!) || typeof trace.snapped !== "boolean") throw new Error("The image engine returned an invalid magnetic trace.");
        this.tail = trace.points.concat(this.guide.slice(guide.length)); this.resolved = guide.length; this.snapped = trace.snapped; this.error = null;
        if (!this.editing) this.autoFasten(trace.points, this.guide.slice(guide.length));
        this.emit();
      } catch (error) { if (!this.disposed && generation === this.generation) { this.error = String(error); this.resolved = this.guide.length; this.emit(); } }
      finally { this.flight = null; if (!this.error) this.schedule(); this.emit(); }
    })();
    this.emit(); return this.flight;
  }
  private autoFasten(path: MagneticPoint[], suffix: MagneticPoint[]) {
    const spacing = 4 + (100 - this.settings.frequency) * .5;
    let last = 0, distance = 0;
    for (let i = 1; i < path.length; i++) {
      distance += length(path[i - 1]!, path[i]!);
      if (distance < spacing || i === path.length - 1) continue;
      const piece = compactMagneticPath(path.slice(last, i + 1));
      if (this.pieces.reduce((n, p) => n + p.length - 1, 0) + piece.length >= MAX_POINTS) break;
      this.pieces.push(piece); last = i; distance = 0;
    }
    if (last) {
      this.tail = path.slice(last).concat(suffix); this.guide = path.slice(last).concat(suffix); this.resolved = path.length - last; this.generation++;
    }
  }
}
