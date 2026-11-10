import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { FILTERS } from './controls';
import { FilterBrowser } from './FilterBrowser';

it('exposes every filter with searchable categories and retains the selected command identity', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), select = vi.fn();
  try {
    await act(async () => root.render(<FilterBrowser disabled={false} select={select}/>));
    expect(FILTERS).toHaveLength(115); expect(new Set(FILTERS.map(action => action.id)).size).toBe(115);
    expect(host.querySelectorAll('button')).toHaveLength(115);
    const input = host.querySelector('input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'watercolor'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(host.querySelectorAll('button')).toHaveLength(1); expect(host.querySelector('details')!.open).toBe(true);
    await act(async () => host.querySelector('button')!.click());
    expect(select).toHaveBeenCalledWith(FILTERS.find(action => action.id === 'filter.gallery.watercolor'));
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'nothingmatches'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(host.querySelector('[role="status"]')!.textContent).toContain('No filters match');
    await act(async () => root.render(<FilterBrowser disabled select={select}/>)); expect(input.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
