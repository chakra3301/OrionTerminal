import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { DesignView, type DesignNode } from './reactExportRuntime';

it('paints native text and mask pixels once while keeping accessible text and clipped semantic targets', async () => {
  const text: DesignNode = { id: 'text', name: 'Native glyphs', visible: true, style: { position: 'absolute', left: 8, top: 10, width: 100, height: 24 }, children: [], text: 'Café', runs: [{ text: 'Café', style: { color: 'red' } }], sceneCovered: true, image: 'data:image/png;base64,AA==' };
  const target: DesignNode = { id: 'target', name: 'Masked target', visible: true, sceneCovered: true, style: { position: 'absolute', width: 60, height: 40 }, children: [], navigation: { action: 'navigate', target: 'next', transition: 'instant', duration: 0 } };
  const mask: DesignNode = { id: 'mask', name: 'Native masked pixels', visible: true, sceneCovered: true, maskPath: 'M10 10h30v30h-30Z', style: { position: 'absolute', width: 120, height: 80 }, children: [target], image: 'data:image/png;base64,AQ==' };
  const parent: DesignNode = { id: 'root', name: 'Root', visible: true, style: { width: 120, height: 80 }, children: [text, mask] };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<DesignView nodes={[parent]} width={120} height={80} />));
    const glyphs = host.querySelector<HTMLElement>('[data-name="Native glyphs"]')!;
    expect(glyphs.textContent).toBe('Café'); expect(glyphs.style.color).toBe('transparent'); expect(glyphs.querySelector('span')?.style.color).toBe('transparent'); expect(glyphs.querySelectorAll('img')).toHaveLength(1);
    const region = host.querySelector<HTMLElement>('[data-xdesign-mask]')!;
    expect(region.style.clipPath).toBe(''); expect(region.style.pointerEvents).toBe('none');
    expect(region.querySelector('img')?.parentElement).toBe(region);
    const clipped = region.querySelector<HTMLElement>('[style*="clip-path"]')!;
    expect(clipped.style.pointerEvents).toBe('auto'); expect(clipped.querySelector('[data-name="Masked target"]')).not.toBeNull(); expect(clipped.querySelector('img')).toBeNull();
    expect(region.querySelectorAll('img')).toHaveLength(1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
