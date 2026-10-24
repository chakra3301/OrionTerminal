import { expect, it } from 'vitest';
import { blurDocumentPoint, boundBlurViewport, FIT_BLUR_VIEW, panBlurViewport, zoomBlurViewport } from './blurViewport';

it('keeps an interior pointer anchor fixed through zoom and zoom-out', () => {
  const rect = { left: 10, top: 20, width: 400, height: 200 }, anchor = blurDocumentPoint(rect, 800, 400, FIT_BLUR_VIEW, 110, 120)!;
  expect(anchor).toEqual([200, 200]);
  const zoomed = zoomBlurViewport(800, 400, FIT_BLUR_VIEW, 2, anchor)!;
  expect(zoomed).toEqual({ x: 100, y: 100, zoom: 2 });
  expect(blurDocumentPoint(rect, 800, 400, zoomed, 110, 120)).toEqual(anchor);
  expect(zoomBlurViewport(800, 400, zoomed, 1, anchor)).toEqual(FIT_BLUR_VIEW);
});

it('maps zoomed/panned portrait and landscape letterboxes in original document pixels', () => {
  const rect = { left: 10, top: 20, width: 200, height: 200 };
  expect(blurDocumentPoint(rect, 400, 200, { x: 100, y: 50, zoom: 2 }, 110, 120)).toEqual([200, 100]);
  expect(blurDocumentPoint(rect, 200, 400, { x: 50, y: 100, zoom: 2 }, 110, 120)).toEqual([100, 200]);
  expect(blurDocumentPoint(rect, 400, 200, { x: 100, y: 50, zoom: 2 }, 10, 70)).toEqual([100, 50]);
});

it('pans by CSS distance at the current contained zoom without changing its source object', () => {
  const view = { x: 100, y: 50, zoom: 2 }, before = { ...view };
  expect(panBlurViewport({ left: 0, top: 0, width: 400, height: 200 }, 400, 200, view, 40, 20)).toEqual({ x: 80, y: 40, zoom: 2 });
  expect(view).toEqual(before);
});

it('bounds zoom and pan with limited image-edge margin and refuses invalid coordinates', () => {
  expect(boundBlurViewport(400, 200, { x: -1000, y: 1000, zoom: 2 })).toEqual({ x: -50, y: 125, zoom: 2 });
  const rect = { left: 0, top: 0, width: 400, height: 200 }, unbounded = { x: -1000, y: 1000, zoom: 1000 }, bounded = boundBlurViewport(400, 200, unbounded)!;
  expect(blurDocumentPoint(rect, 400, 200, unbounded, 200, 100)).toEqual(blurDocumentPoint(rect, 400, 200, bounded, 200, 100));
  expect(panBlurViewport(rect, 400, 200, unbounded, 10, 20)).toEqual(panBlurViewport(rect, 400, 200, bounded, 10, 20));
  expect(zoomBlurViewport(400, 200, unbounded, 32)).toEqual(zoomBlurViewport(400, 200, bounded, 32));
  expect(zoomBlurViewport(400, 200, FIT_BLUR_VIEW, 1000)?.zoom).toBe(64);
  expect(zoomBlurViewport(400, 200, FIT_BLUR_VIEW, .2)?.zoom).toBe(1);
  expect(zoomBlurViewport(400, 200, FIT_BLUR_VIEW, Number.NaN)).toBeUndefined();
  expect(blurDocumentPoint({ left: 0, top: 0, width: 0, height: 0 }, 400, 200, FIT_BLUR_VIEW, 20, 30)).toBeUndefined();
  expect(panBlurViewport({ left: 0, top: 0, width: 400, height: 200 }, 0, 200, FIT_BLUR_VIEW, 20, 30)).toBeUndefined();
});
