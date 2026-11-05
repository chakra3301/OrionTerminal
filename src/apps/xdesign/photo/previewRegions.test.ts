import { expect, it } from 'vitest';
import { photoPreviewRegions } from './previewRegions';
import { FIT_BLUR_VIEW } from './blurViewport';

it('requests original source pixels only when they improve the fit preview at the measured zoom', () => {
  const document = { width: 4096, height: 2048 }, frame = { width: 800, height: 400 };
  expect(photoPreviewRegions(document, FIT_BLUR_VIEW, frame)).toEqual([]);
  expect(photoPreviewRegions(document, { x: 1024, y: 512, zoom: 2 }, frame)).toEqual([]);
  expect(photoPreviewRegions(document, { x: 1536, y: 768, zoom: 4 }, frame)).toEqual([
    { x: 1536, y: 768, width: 512, height: 512, scale: 1 }, { x: 2048, y: 768, width: 512, height: 512, scale: 1 },
  ]);
  expect(photoPreviewRegions({ width: 80, height: 60 }, { x: 20, y: 15, zoom: 4 }, frame)).toEqual([]);
});
it('keeps reduced sampling aligned to source pixels and covers clipped odd document edges', () => {
  const document = { width: 8191, height: 2047 }, frame = { width: 800, height: 300 };
  const regions = photoPreviewRegions(document, { x: 4096.3, y: 900.7, zoom: 4 }, frame);
  expect(regions.length).toBeGreaterThan(0); expect(regions.every(region => region.scale === 2 && region.x % 2 === 0 && region.y % 2 === 0)).toBe(true);
  expect(regions[0]!.x).toBe(4096); expect(regions[0]!.y).toBe(900);
  const edge = photoPreviewRegions(document, { x: 8191, y: 2047, zoom: 32 }, frame);
  expect(edge.every(region => region.x + region.width <= document.width && region.y + region.height <= document.height)).toBe(true);
  expect(Math.max(...edge.map(region => region.x + region.width))).toBe(document.width);
  expect(Math.max(...edge.map(region => region.y + region.height))).toBe(document.height);
});
it('bounds paired tile count and pixel storage at high density without filling unseen image regions', () => {
  const regions = photoPreviewRegions({ width: 16384, height: 1024 }, { x: 4000, y: 200, zoom: 8 }, { width: 2400, height: 400 }, 4);
  expect(regions.length).toBeGreaterThan(0); expect(regions.length).toBeLessThanOrEqual(8);
  expect(regions.every(region => region.scale <= 64 && (region.scale & (region.scale - 1)) === 0 && Math.ceil(region.width / region.scale) <= 512 && Math.ceil(region.height / region.scale) <= 512)).toBe(true);
  expect(regions.reduce((total, region) => total + Math.ceil(region.width / region.scale) * Math.ceil(region.height / region.scale), 0)).toBeLessThanOrEqual(2_097_152);
  expect(regions[0]!.x).toBeGreaterThan(0);
});
it('refuses invalid document, viewport and measurement inputs', () => {
  const document = { width: 4096, height: 2048 }, view = { x: 1000, y: 500, zoom: 4 }, frame = { width: 800, height: 400 };
  expect(photoPreviewRegions(document, view, { ...frame, width: 0 })).toEqual([]);
  expect(photoPreviewRegions(document, { ...view, x: Number.NaN }, frame)).toEqual([]);
  expect(photoPreviewRegions({ ...document, width: 4096.5 }, view, frame)).toEqual([]);
  expect(photoPreviewRegions(document, view, frame, Infinity)).toEqual([]);
});
