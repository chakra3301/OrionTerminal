import type { Effect, SceneNode, Stroke } from '@open-pencil/scene-graph';
import { nativeAppearance, nativeAppearanceTween, validNativeAppearance, type NativeAppearance } from './prototypeNativeAppearance';

type Slot<T> = { from?: T; to?: T };
type Sample = (progress: number) => NativeAppearance;

const MAX_STROKES = 64;
const MAX_EFFECTS = 32;
const blur = (effect: Effect) => effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR';
const sameDashLength = (a?: number[], b?: number[]) => (a?.length ?? 0) === (b?.length ?? 0);
const resolvedDashLength = (stroke: Stroke, appearance: NativeAppearance) => (stroke.dashPattern ?? appearance.dash).length;

function align<T>(from: readonly T[], to: readonly T[], compatible: (a: T, b: T) => boolean): Slot<T>[] {
  const rows = from.length + 1, columns = to.length + 1;
  const scores = Array.from({ length: rows }, () => new Uint8Array(columns));
  for (let i = from.length - 1; i >= 0; i--) for (let j = to.length - 1; j >= 0; j--) {
    scores[i]![j] = compatible(from[i]!, to[j]!)
      ? scores[i + 1]![j + 1]! + 1
      : Math.max(scores[i + 1]![j]!, scores[i]![j + 1]!);
  }
  const result: Slot<T>[] = [];
  let i = 0, j = 0;
  while (i < from.length || j < to.length) {
    if (i < from.length && j < to.length && compatible(from[i]!, to[j]!) && scores[i]![j] === scores[i + 1]![j + 1]! + 1) {
      result.push({ from: from[i++]!, to: to[j++]! });
    } else if (i < from.length && (j === to.length || scores[i + 1]![j]! >= scores[i]![j + 1]!)) {
      result.push({ from: from[i++]! });
    } else result.push({ to: to[j++]! });
  }
  return result;
}

function strokeCompatible(a: Stroke, b: Stroke, from: NativeAppearance, to: NativeAppearance) {
  return a.align === b.align && (a.cap ?? from.cap) === (b.cap ?? to.cap) && (a.join ?? from.join) === (b.join ?? to.join) && resolvedDashLength(a, from) === resolvedDashLength(b, to);
}

function neutralStroke(stroke: Stroke): Stroke {
  return { ...structuredClone(stroke), weight: 0, opacity: 0, color: { ...stroke.color, a: 0 }, visible: true };
}

function neutralEffect(effect: Effect): Effect {
  return { ...structuredClone(effect), color: { ...effect.color, a: 0 }, radius: 0, spread: 0, offset: { x: 0, y: 0 }, visible: true };
}

function compatibleShadow(a: Effect, b: Effect) {
  return a.type === b.type && !blur(a) && (a.blendMode ?? 'NORMAL') === (b.blendMode ?? 'NORMAL') && a.showShadowBehindNode === b.showShadowBehindNode;
}

function firstBlur(effects: readonly Effect[]) { return effects.findIndex(blur); }

function createAlignedAppearance(from: NativeAppearance, to: NativeAppearance): { from: NativeAppearance; to: NativeAppearance } | undefined {
  if (from.cap !== to.cap || from.join !== to.join || from.independent !== to.independent || !sameDashLength(from.dash, to.dash)) return;
  if (!validNativeAppearance(from) || !validNativeAppearance(to)) return;
  if ([...from.effects, ...to.effects].some(effect => effect.type === 'BACKGROUND_BLUR')) return;

  const fromBlurIndex = firstBlur(from.effects), toBlurIndex = firstBlur(to.effects);
  const fromBlur = fromBlurIndex < 0 ? undefined : from.effects[fromBlurIndex];
  const toBlur = toBlurIndex < 0 ? undefined : to.effects[toBlurIndex];
  if (fromBlur && toBlur && ((fromBlur.blendMode ?? 'NORMAL') !== (toBlur.blendMode ?? 'NORMAL') || fromBlur.showShadowBehindNode !== toBlur.showShadowBehindNode)) return;

  const fromShadows = from.effects.filter(effect => !blur(effect));
  const toShadows = to.effects.filter(effect => !blur(effect));
  const effects: Slot<Effect>[] = [];
  if (fromBlur || toBlur) effects.push({ ...(fromBlur ? { from: fromBlur } : {}), ...(toBlur ? { to: toBlur } : {}) });
  effects.push(...align(fromShadows, toShadows, compatibleShadow));

  const strokes = align(from.strokes, to.strokes, (a, b) => strokeCompatible(a, b, from, to));
  if (strokes.length > MAX_STROKES || effects.length > MAX_EFFECTS) return;

  const startEffects = effects.map(slot => {
    const effect = slot.from ?? neutralEffect(slot.to!);
    return { ...structuredClone(effect), visible: true };
  });
  const endEffects = effects.map(slot => {
    let effect = slot.to ?? neutralEffect(slot.from!);
    if (slot.from && slot.to && blur(slot.from) && blur(slot.to) && slot.from.type !== slot.to.type) effect = { ...structuredClone(effect), type: slot.from.type };
    return { ...structuredClone(effect), visible: true };
  });
  const startStrokes = strokes.map(slot => slot.from ? structuredClone(slot.from) : neutralStroke(slot.to!));
  const endStrokes = strokes.map(slot => slot.to ? structuredClone(slot.to) : neutralStroke(slot.from!));
  const alignedFrom: NativeAppearance = { ...structuredClone(from), strokes: startStrokes, effects: startEffects };
  const alignedTo: NativeAppearance = { ...structuredClone(to), strokes: endStrokes, effects: endEffects };
  if (!nativeAppearanceTween(alignedFrom, alignedTo)) return;
  return { from: alignedFrom, to: alignedTo };
}

/** Aligns changing stroke/effect stacks without replacing their native scene node. */
export function createNativeReactMotionAppearance(fromNode: SceneNode, toNode: SceneNode): Sample | undefined {
  const from = nativeAppearance(fromNode), to = nativeAppearance(toNode);
  const aligned = createAlignedAppearance(from, to);
  if (!aligned) return;
  const tween = nativeAppearanceTween(aligned.from, aligned.to);
  if (!tween) return;
  return progress => {
    if (!Number.isFinite(progress) || Math.abs(progress) > 100) throw new Error('Smart Animate progress must be finite and within -100 to 100.');
    if (progress === 0) return structuredClone(from);
    if (progress === 1) return structuredClone(to);
    return tween(progress);
  };
}
