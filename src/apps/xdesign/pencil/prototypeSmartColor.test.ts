import { expect, it } from 'vitest';
import { smartColorTween } from './prototypeSmartColor';

it('premultiplies changing color and alpha using the CSS Color 4 sRGB example', () => {
  const tween = smartColorTween('rgb(24% 12% 98% / 0.4)', 'rgb(62% 26% 64% / 0.6)')!;
  expect(tween(0.5)).toBe('rgba(119.34,52.02,197.88,0.5)');
  expect(tween(0)).toBe('rgb(24% 12% 98% / 0.4)'); expect(tween(1)).toBe('rgb(62% 26% 64% / 0.6)');
});
it.each(['transparent', 'rgba(255,0,0,0)', '#f000'])('keeps the visible hue when interpolating from %s to opaque blue', color => {
  expect(smartColorTween(color, 'color(srgb 0 0 1)')!(0.5)).toBe('rgba(0,0,255,0.5)');
});
it('supports legacy computed RGB, hex alpha and modern percent syntax without rounding away intermediate color', () => {
  expect(smartColorTween('rgb(255, 0, 0)', 'rgba(0,0,255,1)')!(0.5)).toBe('rgba(127.5,0,127.5,1)');
  expect(smartColorTween('#ff000080', 'rgb(0 0 255 / 100%)')!(0.5)).toBe('rgba(85.221932,0,169.778068,0.75098)');
});
it('keeps spring overshoot finite and refuses nonfinite timeline input', () => {
  const tween = smartColorTween('rgba(255,0,0,.4)', 'rgba(0,0,255,1)')!;
  expect(tween(-2)).toBe('rgba(0,0,0,0)'); expect(tween(2)).toBe('rgba(0,0,255,1)'); expect(() => tween(NaN)).toThrow('finite');
});
it.each(['color(display-p3 1 0 0)', 'oklch(.7 .2 30)', 'rgb(none 0 0)', 'var(--paint)', 'rgba(1,2,3,4,5)', 'rgb(1 2 3 /)', 'color(srgb 1e999 0 0)', 'currentcolor'])('refuses unsupported or invalid paint %s instead of manufacturing a color', value => {
  expect(smartColorTween(value, '#fff')).toBeUndefined(); expect(smartColorTween('#fff', value)).toBeUndefined();
});
