import { bakeRemembered, unbaked, type GradientMethod } from "./gradientMethod";
import type { GradientFill } from "./types";

export type XY = readonly [number, number];
export type LiveStop = { location: number; color: string; midpoint: number };
/** A live gradient's on-canvas line and colour stops, sorted as the engine indexes them. `method` is the Method its stored stops were baked for (they show as the stops the user set), null when the fill keeps its own stops. */
export type StopWidget = { from: XY; to: XY; reverse: boolean; stops: LiveStop[]; method: GradientMethod | null };
export type StopTarget = { kind: "stop" | "midpoint"; index: number } | { kind: "line"; location: number };
export type StopEdit = { action: "add"; location: number } | { action: "move"; index: number; location: number } | { action: "delete"; index: number } | { action: "color"; index: number; color: string } | { action: "midpoint"; index: number; location: number };

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
// Locations in the Gradient Editor's 0.1% steps.
const round = (value: number) => Math.round(value * 1000) / 1000;
const rgb = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) || 0);
const toHex = (values: number[]) => `#${values.map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`;

export function stopWidget(fill: GradientFill): StopWidget {
  const source = unbaked(fill.stops);
  // Midpoints pair with the stops as stored, before sorting, as in the engine.
  const stops = (source?.stops ?? fill.stops).map(([location, color], at): LiveStop => ({ location, color, midpoint: source ? .5 : fill.midpoints[at] ?? .5 })).sort((a, b) => a.location - b.location);
  return { from: fill.from, to: fill.to, reverse: fill.reverse, stops, method: source?.method ?? null };
}

export function linePoint(widget: StopWidget, location: number): [number, number] {
  const t = widget.reverse ? 1 - location : location;
  return [widget.from[0] + (widget.to[0] - widget.from[0]) * t, widget.from[1] + (widget.to[1] - widget.from[1]) * t];
}

/** The location a point projects to (clamped to the line) and its distance from the line; null for a line of no length. */
export function lineLocation(widget: StopWidget, at: XY): { location: number; away: number } | null {
  const dx = widget.to[0] - widget.from[0], dy = widget.to[1] - widget.from[1], length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const px = at[0] - widget.from[0], py = at[1] - widget.from[1], t = (px * dx + py * dy) / length ** 2;
  return { location: round(clamp(widget.reverse ? 1 - t : t)), away: Math.abs(px * dy - py * dx) / length };
}

const midpointAt = (stops: LiveStop[], index: number) => stops[index]!.location + (stops[index + 1]!.location - stops[index]!.location) * stops[index]!.midpoint;
/** Midpoint diamonds sit on segments of some length, and only on a fill's own stops: baked stops keep no midpoints. */
const diamonds = (widget: StopWidget) => widget.method ? [] : widget.stops.slice(0, -1).flatMap((stop, index) => widget.stops[index + 1]!.location > stop.location ? [index] : []);

export function midpointPoints(widget: StopWidget): { index: number; at: [number, number] }[] {
  return diamonds(widget).map(index => ({ index, at: linePoint(widget, midpointAt(widget.stops, index)) }));
}

/** What a press within `radius` hits: the nearest stop, else the nearest midpoint diamond, else the line between its ends. */
export function stopTarget(widget: StopWidget, at: XY, radius: number): StopTarget | null {
  const near = (points: { index: number; at: [number, number] }[]) => points.map(point => ({ index: point.index, distance: Math.hypot(point.at[0] - at[0], point.at[1] - at[1]) })).filter(point => point.distance <= radius).sort((a, b) => a.distance - b.distance)[0];
  const stop = near(widget.stops.map((stop, index) => ({ index, at: linePoint(widget, stop.location) })));
  if (stop) return { kind: "stop", index: stop.index };
  const midpoint = near(midpointPoints(widget));
  if (midpoint) return { kind: "midpoint", index: midpoint.index };
  const dx = widget.to[0] - widget.from[0], dy = widget.to[1] - widget.from[1], length = Math.hypot(dx, dy), t = length > 0 ? ((at[0] - widget.from[0]) * dx + (at[1] - widget.from[1]) * dy) / length ** 2 : NaN;
  const projected = lineLocation(widget, at);
  return projected && t >= 0 && t <= 1 && projected.away <= radius ? { kind: "line", location: projected.location } : null;
}

/** The edit a press on `target` and release at `end` makes, as in Photoshop: a click on the line adds a stop, a dragged stop moves, or goes once dragged four radii off the line (a gradient keeps two), and a dragged diamond moves its midpoint. Clicks on stops and diamonds, drags along the line and unchanged places make none. */
export function stopEdit(widget: StopWidget, target: StopTarget, start: XY, end: XY, radius: number): StopEdit | null {
  const click = Math.hypot(end[0] - start[0], end[1] - start[1]) < radius, projected = lineLocation(widget, end);
  if (target.kind === "line") return click ? { action: "add", location: target.location } : null;
  const stop = widget.stops[target.index];
  if (click || !projected || !stop) return null;
  if (target.kind === "stop") {
    if (projected.away > 4 * radius && widget.stops.length > 2) return { action: "delete", index: target.index };
    return projected.location === stop.location ? null : { action: "move", index: target.index, location: projected.location };
  }
  const next = widget.stops[target.index + 1];
  if (!next || next.location <= stop.location) return null;
  const midpoint = round(clamp((projected.location - stop.location) / (next.location - stop.location), .05, .95));
  return midpoint === stop.midpoint ? null : { action: "midpoint", index: target.index, location: midpoint };
}

/** The widget as a drag in progress shows it; `leaving` is the stop that goes if released there. */
export function shownWidget(widget: StopWidget, edit: StopEdit | null): StopWidget & { leaving: number | null } {
  const patch = (index: number, change: Partial<LiveStop>) => ({ ...widget, stops: widget.stops.map((stop, at) => at === index ? { ...stop, ...change } : stop), leaving: null });
  if (edit?.action === "move") return patch(edit.index, { location: edit.location });
  if (edit?.action === "midpoint") return patch(edit.index, { midpoint: edit.location });
  return { ...widget, leaving: edit?.action === "delete" ? edit.index : null };
}

// The Gradient Editor's colour midpoints, kept as the engine keeps them: one per segment between sorted stops, as a
// fraction of the segment, and none stored when every midpoint sits at 50%. Locations are the sorted stops' locations.
const perStop = (count: number, mids: number[]) => Array.from({ length: count }, (_, at) => mids[at] ?? .5);
const stored = (mids: number[]) => { const segments = mids.slice(0, -1); return segments.every(mid => Math.abs(mid - .5) < 1e-6) ? [] : segments; };

export const midpointLocation = (locations: number[], mids: number[], segment: number) => locations[segment]! + (locations[segment + 1]! - locations[segment]!) * (mids[segment] ?? .5);
export const segmentFraction = (locations: number[], segment: number, location: number) => round(clamp((location - locations[segment]!) / (locations[segment + 1]! - locations[segment]!), .05, .95));
export const withMidpoint = (count: number, mids: number[], segment: number, value: number) => stored(perStop(count, mids).map((mid, at) => at === segment ? round(clamp(value, .05, .95)) : mid));

/** A moved stop keeps the midpoint after it, as the engine pairs them; the stops reorder by a stable sort, as the editor's do. */
export function movedMidpoints(locations: number[], mids: number[], index: number, location: number): number[] {
  const moved = locations.map((at, i) => i === index ? location : at), order = locations.map((_, i) => i).sort((a, b) => moved[a]! - moved[b]!), per = perStop(locations.length, mids);
  return stored(order.map(i => per[i]!));
}

/** Splitting a segment resets its midpoint, and the new stop's segment starts at 50%. */
export function addedMidpoints(locations: number[], mids: number[], location: number): number[] {
  const per = perStop(locations.length, mids), before = locations.filter(at => at <= location).length;
  if (before > 0) per[before - 1] = .5;
  per.splice(before, 0, .5);
  return stored(per);
}

export function removedMidpoints(count: number, mids: number[], index: number): number[] {
  const per = perStop(count, mids);
  per.splice(index, 1);
  return stored(per);
}

/** Photoshop shows the diamonds either side of the selected colour stop, and the one being edited. */
export function editorDiamonds(locations: number[], around: number | null, selected: number | null): number[] {
  const segments = around === null ? [] : [around - 1, around];
  if (selected !== null && !segments.includes(selected)) segments.push(selected);
  return segments.filter(segment => segment >= 0 && segment < locations.length - 1 && locations[segment + 1]! > locations[segment]!).sort((a, b) => a - b);
}

/** Linear between stored stops: the colour the fill renders at `t`. */
function sampled(stops: [number, string][], t: number): string {
  const sorted = [...stops].sort((a, b) => a[0] - b[0]), after = sorted.findIndex(([at]) => at >= t);
  if (after <= 0) return sorted[after < 0 ? sorted.length - 1 : 0]![1].slice(0, 7);
  const [t0, a] = sorted[after - 1]!, [t1, b] = sorted[after]!, k = t1 > t0 ? (t - t0) / (t1 - t0) : 0, from = rgb(a), to = rgb(b);
  return toHex(from.map((value, at) => value + (to[at]! - value) * k));
}

/** One command per edit, so one history step: `gradient.fill.stop` on a fill's own stops; on baked stops, the edited stops re-baked for their Method in one `gradient.fill.set`. Null when the edit cannot be made. */
export function stopCommand(fill: GradientFill, edit: StopEdit, layer: number): { id: string; params: Record<string, unknown> } | null {
  const widget = stopWidget(fill), stop = "index" in edit ? widget.stops[edit.index] : undefined;
  if (!widget.method) {
    // A picked colour keeps the stop's own alpha.
    const color = edit.action === "color" && stop?.color.length === 9 && edit.color.length === 7 ? edit.color + stop.color.slice(7) : undefined;
    return { id: "gradient.fill.stop", params: { layer, kind: "color", ...edit, ...color && { color } } };
  }
  const stops: [number, string][] = widget.stops.map(({ location, color }) => [location, color]);
  if (edit.action === "add") stops.push([edit.location, sampled(fill.stops, edit.location)]);
  else if (edit.action === "move" && stop) stops[edit.index] = [edit.location, stop.color];
  else if (edit.action === "delete" && stop && stops.length > 2) stops.splice(edit.index, 1);
  else if (edit.action === "color" && stop) stops[edit.index] = [stop.location, edit.color.slice(0, 7)];
  else return null;
  const baked = bakeRemembered(stops.sort((a, b) => a[0] - b[0]), widget.method);
  return baked ? { id: "gradient.fill.set", params: { layer, stops: baked } } : null;
}
