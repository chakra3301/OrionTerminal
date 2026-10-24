import type { Effect, SceneNode, Stroke } from '@open-pencil/scene-graph';
import { effectOverflow, strokeOverflow } from '@open-pencil/scene-graph/geometry';
import { smartRgbaAt } from './prototypeSmartColor';
export type NativeAppearance = {
  strokes: Stroke[]; effects: Effect[];
  cap: SceneNode['strokeCap']; join: SceneNode['strokeJoin']; miter: number; dash: number[];
  independent: boolean; borders: [number, number, number, number];
};
export type ArtworkInsets = { left: number; top: number; right: number; bottom: number };
const caps = ['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL'], joins = ['MITER', 'BEVEL', 'ROUND'];
const effects = ['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'FOREGROUND_BLUR'];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value >= 0;
const color = (value: Stroke['color']) => !!value && [value.r, value.g, value.b, value.a].every(value => finite(value) && value >= 0 && value <= 1);
const dash = (value: unknown): value is number[] => Array.isArray(value) && value.length <= 256 && value.every(positive) && (!value.length || value.some(value => value > 0));
export function nativeAppearance(node: SceneNode): NativeAppearance {
  return structuredClone({ strokes: node.strokes.filter(stroke => stroke.visible), effects: node.effects.filter(effect => effect.visible), cap: node.strokeCap, join: node.strokeJoin, miter: node.strokeMiterLimit, dash: node.dashPattern, independent: node.independentStrokeWeights, borders: [node.borderTopWeight, node.borderRightWeight, node.borderBottomWeight, node.borderLeftWeight] });
}
export function validNativeAppearance(value: NativeAppearance) {
  return !!value && Array.isArray(value.strokes) && value.strokes.length <= 64 && value.strokes.every(stroke => !!stroke && stroke.visible === true && color(stroke.color) && positive(stroke.weight) && positive(stroke.opacity) && stroke.opacity <= 1 && ['INSIDE', 'CENTER', 'OUTSIDE'].includes(stroke.align) && (stroke.cap === undefined || caps.includes(stroke.cap)) && (stroke.join === undefined || joins.includes(stroke.join)) && (stroke.dashPattern === undefined || dash(stroke.dashPattern))) && Array.isArray(value.effects) && value.effects.length <= 32 && value.effects.every(effect => !!effect && effect.visible === true && effects.includes(effect.type) && color(effect.color) && !!effect.offset && finite(effect.offset.x) && finite(effect.offset.y) && positive(effect.radius) && finite(effect.spread) && (effect.blendMode === undefined || typeof effect.blendMode === 'string' && effect.blendMode.length <= 64) && (effect.showShadowBehindNode === undefined || typeof effect.showShadowBehindNode === 'boolean')) && caps.includes(value.cap) && joins.includes(value.join) && positive(value.miter) && dash(value.dash) && typeof value.independent === 'boolean' && Array.isArray(value.borders) && value.borders.length === 4 && value.borders.every(positive);
}
const empty: NativeAppearance = { strokes: [], effects: [], cap: 'NONE', join: 'MITER', miter: 4, dash: [], independent: false, borders: [0, 0, 0, 0] };
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const nonnegative = (a: number, b: number, p: number) => Math.max(0, lerp(a, b, p));
const rgba = (a: Stroke['color'], b: Stroke['color'], p: number) => { const [r, g, blue, alpha] = smartRgbaAt([a.r, a.g, a.b, a.a], [b.r, b.g, b.b, b.a], p); return { r, g, b: blue, a: alpha }; };
const sameDash = (a?: number[], b?: number[]) => (a?.length ?? 0) === (b?.length ?? 0);
function interpolateDash(a: number[], b: number[], p: number) {
  const values = a.map((value, index) => nonnegative(value, b[index]!, p));
  if (values.length && !values.some(value => value > 0)) values[0] = .0001;
  return values;
}
export function nativeAppearanceTween(from?: NativeAppearance, to?: NativeAppearance): ((p: number) => NativeAppearance) | undefined {
  const a = from ?? empty, b = to ?? empty;
  if (!validNativeAppearance(a) || !validNativeAppearance(b) || a.strokes.length !== b.strokes.length || a.effects.length !== b.effects.length || a.cap !== b.cap || a.join !== b.join || a.independent !== b.independent || !sameDash(a.dash, b.dash) || a.strokes.some((stroke, index) => { const end = b.strokes[index]!; return stroke.align !== end.align || (stroke.cap ?? a.cap) !== (end.cap ?? b.cap) || (stroke.join ?? a.join) !== (end.join ?? b.join) || !sameDash(stroke.dashPattern ?? a.dash, end.dashPattern ?? b.dash); }) || a.effects.some((effect, index) => { const end = b.effects[index]!; return effect.type !== end.type || (effect.blendMode ?? 'NORMAL') !== (end.blendMode ?? 'NORMAL') || effect.showShadowBehindNode !== end.showShadowBehindNode; })) return;
  const start = structuredClone(a), end = structuredClone(b);
  return p => {
    if (!finite(p)) throw new Error('Choose a finite native appearance position.');
    if (p === 0) return structuredClone(start); if (p === 1) return structuredClone(end);
    return { ...start, miter: nonnegative(start.miter, end.miter, p), dash: interpolateDash(start.dash, end.dash, p), borders: start.borders.map((value, index) => nonnegative(value, end.borders[index]!, p)) as NativeAppearance['borders'], strokes: start.strokes.map((stroke, index) => { const target = end.strokes[index]!; return { ...stroke, color: rgba(stroke.color, target.color, p), weight: nonnegative(stroke.weight, target.weight, p), opacity: Math.max(0, Math.min(1, lerp(stroke.opacity, target.opacity, p))), dashPattern: interpolateDash(stroke.dashPattern ?? start.dash, target.dashPattern ?? end.dash, p) }; }), effects: start.effects.map((effect, index) => { const target = end.effects[index]!; return { ...effect, color: rgba(effect.color, target.color, p), radius: nonnegative(effect.radius, target.radius, p), spread: lerp(effect.spread, target.spread, p), offset: { x: lerp(effect.offset.x, target.offset.x, p), y: lerp(effect.offset.y, target.offset.y, p) } }; }) };
  };
}
export function nativeArtworkInsets(appearance?: NativeAppearance, network?: SceneNode['vectorNetwork']): ArtworkInsets {
  if (!appearance) return { left: 0, top: 0, right: 0, bottom: 0 };
  const strokes = appearance.independent ? appearance.strokes.map(stroke => ({ ...stroke, weight: Math.max(stroke.weight, ...appearance.borders) })) : appearance.strokes;
  const stroke = strokeOverflow(strokes, appearance.cap, network), overflow = effectOverflow(appearance.effects);
  return { left: stroke + overflow.left, top: stroke + overflow.top, right: stroke + overflow.right, bottom: stroke + overflow.bottom };
}
export function artworkInsetStyle(width: number, height: number, insets: ArtworkInsets) {
  return { left: `${-100 * insets.left / width}%`, top: `${-100 * insets.top / height}%`, right: 'auto', bottom: 'auto', width: `${100 * (width + insets.left + insets.right) / width}%`, height: `${100 * (height + insets.top + insets.bottom) / height}%` };
}
