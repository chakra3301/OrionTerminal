import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTENDED_FILTERS } from './extendedFilters';
import { GALLERY_ACTION } from './galleryFilters';
import { FilterStructuredOptions, structuredFilterOverrides } from './FilterStructuredOptions';
import type { PhotoAction } from './controls';

let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const action = (id: string) => EXTENDED_FILTERS.find(item => item.id === id)!;
const render = (entry: PhotoAction, values: Record<string, unknown>, change: (key: string, value: unknown) => void, disabled = false) => act(() => root.render(<FilterStructuredOptions action={entry} values={values} disabled={disabled} change={change}/>));
const click = (label: string) => act(() => { const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label)!; button.click(); });
const numberInput = (label: string, value: string) => act(() => { const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
const select = (label: string, value: string) => act(() => { const input = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); });

describe('structured native filter options', () => {
  it('creates an editable identity kernel, emits finite coefficients, and leaves its input values untouched', () => {
    const change = vi.fn(), values: Record<string, unknown> = {};
    render(action('filter.other.custom'), values, change);
    click('Edit kernel');
    const kernel = change.mock.calls.at(-1)![1] as number[];
    expect(kernel).toHaveLength(25); expect(kernel[12]).toBe(1); expect(kernel.filter(value => value !== 0)).toEqual([1]);
    render(action('filter.other.custom'), { ...values, kernel }, change);
    numberInput('Kernel coefficient 1', '2.5');
    const changed = change.mock.calls.at(-1)![1] as number[];
    expect(changed[0]).toBe(2.5); expect(changed[12]).toBe(1); expect(kernel[0]).toBe(0);
    expect(structuredFilterOverrides(action('filter.other.custom'), { kernel })).toEqual(new Set(['kernel']));
  });

  it('seeds native point, light, pin, and path arrays from scalar aliases', () => {
    const change = vi.fn();
    render(action('filter.distort.shear'), { amount: 35 }, change); click('Edit shear points');
    expect(change.mock.calls.at(-1)).toEqual(['points', [[0, 0], [0.5, 0.35], [1, 0]]]);

    change.mockClear(); render(action('filter.render.lightingEffects'), { lightType: 'point', lightX: 0.3, intensity: 40 }, change); click('Edit lights');
    const lights = change.mock.calls.at(-1)![1] as Record<string, unknown>[];
    expect(lights).toHaveLength(1); expect(lights[0]).toMatchObject({ kind: 'point', x: 0.3, intensity: 40, color: [1, 1, 1] });
    expect(structuredFilterOverrides(action('filter.render.lightingEffects'), { lights })).toContain('lightType');

    change.mockClear(); render(action('filter.blurGallery.irisBlur'), { centerX: 0.4, radiusX: 0.2, blur: 30 }, change); click('Edit iris blur pins');
    expect(change.mock.calls.at(-1)![1]).toEqual([{ x: 0.4, y: 0.5, radiusX: 0.2, radiusY: 0.25, angle: 0, roundness: 0, feather: 0.5, blur: 30 }]);

    change.mockClear(); render(action('filter.blurGallery.pathBlur'), { startX: 0.1, endY: 0.8, speed: 120, taper: 15 }, change); click('Edit blur paths');
    expect(change.mock.calls.at(-1)![1]).toEqual([{ points: [[0.1, 0.5], [0.8, 0.8]], speed: 120, taper: 15 }]);
  });

  it('edits ordered gallery effects with native typed params and preserves source arrays', () => {
    const initial = [{ filter: 'coloredPencil', params: { pencilWidth: 4, strokePressure: 8, paperBrightness: 25 }, visible: true }];
    const before = structuredClone(initial), values = { effects: initial }, change = vi.fn();
    render(GALLERY_ACTION, values, change);
    select('Gallery effect 1 filter', 'filter.gallery.grain');
    const selected = change.mock.calls.at(-1)![1] as Record<string, unknown>[];
    expect(selected[0]).toMatchObject({ filter: 'grain', visible: true, params: { intensity: 40, contrast: 50, grainType: 'regular' } });
    render(GALLERY_ACTION, { effects: selected }, change);
    select('Grain type', 'soft');
    const typed = change.mock.calls.at(-1)![1] as Record<string, unknown>[];
    expect((typed[0]!.params as Record<string, unknown>).grainType).toBe('soft');
    render(GALLERY_ACTION, { effects: typed }, change);
    click('New effect layer');
    const added = change.mock.calls.at(-1)![1] as Record<string, unknown>[];
    expect(added).toHaveLength(2);
    render(GALLERY_ACTION, { effects: added }, change);
    click('Move gallery effect 2 up');
    expect((change.mock.calls.at(-1)![1] as Record<string, unknown>[]).map(effect => effect.filter)).toEqual(['coloredPencil', 'grain']);
    expect(initial).toEqual(before);
    expect(structuredFilterOverrides(GALLERY_ACTION, { effects: typed })).toContain('effects');
  });

  it('does not emit changes while disabled and exposes arrays only when explicitly activated', () => {
    const change = vi.fn();
    render(action('filter.blurGallery.fieldBlur'), { centerX: 0.2, centerY: 0.6 }, change, true);
    const edit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Edit field blur pins')!;
    expect(edit.disabled).toBe(true); edit.click(); expect(change).not.toHaveBeenCalled();
    expect(structuredFilterOverrides(action('filter.blurGallery.fieldBlur'), { centerX: 0.2 })).toEqual(new Set());
  });
});
