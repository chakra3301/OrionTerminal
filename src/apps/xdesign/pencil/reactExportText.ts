import type { CharacterStyleOverride, SceneNode } from '@open-pencil/scene-graph';
import type { CSSProperties } from 'react';

export function textStyle(text: CharacterStyleOverride): CSSProperties {
  const style: CSSProperties = {};
  const fill = text.fills?.find(paint => paint.visible && paint.type === 'SOLID');
  if (fill) style.color = `rgba(${Math.round(fill.color.r * 255)},${Math.round(fill.color.g * 255)},${Math.round(fill.color.b * 255)},${fill.color.a * fill.opacity})`;
  if (text.fontFamily !== undefined) style.fontFamily = text.fontFamily;
  if (text.fontSize !== undefined) style.fontSize = text.fontSize;
  if (text.fontWeight !== undefined) style.fontWeight = text.fontWeight;
  if (text.italic !== undefined) style.fontStyle = text.italic ? 'italic' : 'normal';
  if (text.letterSpacing !== undefined) style.letterSpacing = text.letterSpacing;
  if (text.lineHeight !== undefined) style.lineHeight = text.lineHeight === null ? 'normal' : `${text.lineHeight}px`;
  if (text.textDecoration !== undefined) style.textDecorationLine = text.textDecoration === 'UNDERLINE' ? 'underline' : text.textDecoration === 'STRIKETHROUGH' ? 'line-through' : 'none';
  if (text.textDecorationStyle !== undefined) style.textDecorationStyle = text.textDecorationStyle.toLowerCase() as CSSProperties['textDecorationStyle'];
  if (text.textDecorationThickness !== undefined) style.textDecorationThickness = text.textDecorationThickness === null ? 'auto' : `${text.textDecorationThickness}px`;
  const decoration = text.textDecorationFills?.find(paint => paint.visible && paint.type === 'SOLID');
  if (decoration) style.textDecorationColor = `rgba(${Math.round(decoration.color.r * 255)},${Math.round(decoration.color.g * 255)},${Math.round(decoration.color.b * 255)},${decoration.color.a * decoration.opacity})`;
  if (text.textDecorationSkipInk !== undefined) style.textDecorationSkipInk = text.textDecorationSkipInk ? 'auto' : 'none';
  if (text.textUnderlineOffset !== undefined) style.textUnderlineOffset = text.textUnderlineOffset === null ? 'auto' : `${text.textUnderlineOffset}px`;
  if (text.fontVariations !== undefined) style.fontVariationSettings = text.fontVariations.map(variation => `${JSON.stringify(variation.axis)} ${variation.value}`).join(', ') || 'normal';
  if (text.fontFeatures !== undefined) style.fontFeatureSettings = text.fontFeatures.map(feature => `${JSON.stringify(feature.tag)} ${feature.enabled ? 1 : 0}`).join(', ') || 'normal';
  return style;
}

export function textRuns(node: SceneNode) {
  if (!node.styleRuns.length) return undefined;
  const boundaries = new Set([0, node.text.length]);
  const runs = node.styleRuns.filter(run => Number.isInteger(run.start) && Number.isInteger(run.length) && run.length > 0)
    .map(run => ({ ...run, start: Math.max(0, Math.min(node.text.length, run.start)), end: Math.max(0, Math.min(node.text.length, run.start + run.length)) }));
  for (const run of runs) { boundaries.add(run.start); boundaries.add(run.end); }
  const ordered = [...boundaries].sort((a, b) => a - b);
  return ordered.slice(0, -1).map((start, index) => {
    const overrides = runs.filter(run => run.start <= start && run.end > start).reduce<CharacterStyleOverride>((style, run) => ({ ...style, ...run.style }), {});
    return { text: node.text.slice(start, ordered[index + 1]), style: textStyle(overrides), lang: overrides.textLanguage ?? undefined };
  });
}
