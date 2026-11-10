import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { DesignView, type DesignNode, type DesignProps } from './reactExportRuntime';
import { selectionToDesignModel } from './reactExport';
let host: HTMLDivElement, root: Root, editor: Editor;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); editor = createEditor(); });
afterEach(() => { act(() => root.unmount()); host.remove(); editor.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const child: DesignNode = { id: 'child', name: 'Child', visible: true, style: { position: 'absolute', left: 70, top: 10, width: 40, height: 40 }, children: [] };
function frame(): DesignNode { return { id: 'frame', name: 'Frame', visible: true, clipContent: true, style: { position: 'relative', width: 80, height: 60, borderRadius: '4px 8px 12px 16px', display: 'flex', flexDirection: 'row', gap: 8, padding: 4 }, image: 'data:image/png;base64,AA==', imageStyle: { left: '-10%', top: '-10%', width: '120%', height: '120%' }, children: [{ ...child }] }; }
function mount(node: DesignNode, props: DesignProps = {}) { act(() => root.render(<DesignView nodes={[node]} width={200} height={200} {...props} />)); return host.querySelector<HTMLElement>(`[data-name="${node.name}"]`)!; }
it('separates own expanded artwork from rounded child clipping and moves layout exactly once', () => {
  const element = mount(frame()), clip = element.querySelector<HTMLElement>(':scope > [data-xdesign-content-clip]')!, image = element.querySelector<HTMLImageElement>(':scope > img')!;
  expect(element.style.overflow).toBe('visible'); expect(element.style.display).toBe(''); expect(element.style.padding).toBe(''); expect(element.style.borderRadius).toBe('4px 8px 12px 16px');
  for (const [property, value] of Object.entries({ overflow: 'hidden', 'border-radius': 'inherit', display: 'flex', 'row-gap': '8px', 'column-gap': '8px', 'padding-top': '4px', 'padding-right': '4px', 'padding-bottom': '4px', 'padding-left': '4px', width: '100%', height: '100%', 'box-sizing': 'border-box' })) expect(clip.style.getPropertyValue(property)).toBe(value);
  expect(image.style.left).toBe('-10%'); expect(image.style.width).toBe('120%'); expect(clip.querySelector('[data-name="Child"]')).toBeTruthy(); expect(image.parentElement).toBe(element);
  const update = frame(); update.style.paddingLeft = 12; update.style.columnGap = 10; mount(update);
  expect(clip.style.paddingLeft).toBe('12px'); expect(clip.style.paddingRight).toBe('4px'); expect(clip.style.rowGap).toBe('8px'); expect(clip.style.columnGap).toBe('10px');
  mount(frame()); for (const side of ['top', 'right', 'bottom', 'left']) expect(clip.style.getPropertyValue(`padding-${side}`)).toBe('4px'); expect(clip.style.rowGap).toBe('8px'); expect(clip.style.columnGap).toBe('8px');
});
it('preserves multi-value padding and gaps including whitespace inside functional CSS lengths', () => {
  const node = frame(); node.style.padding = 'calc(4px + 2px) 8px 10px 12px'; node.style.gap = '6px 14px'; node.style.paddingLeft = 16;
  const clip = mount(node).querySelector<HTMLElement>('[data-xdesign-content-clip]')!;
  expect(clip.style.paddingTop).toBe('calc(6px)'); expect(clip.style.paddingRight).toBe('8px'); expect(clip.style.paddingBottom).toBe('10px'); expect(clip.style.paddingLeft).toBe('16px'); expect(clip.style.rowGap).toBe('6px'); expect(clip.style.columnGap).toBe('14px');
});
it('preserves old exported models that expressed clipping only through overflow', () => {
  const node = frame(); delete node.clipContent; node.style.overflow = 'hidden'; const element = mount(node); expect(element.style.overflow).toBe('visible'); expect(element.querySelector(':scope > [data-xdesign-content-clip]')).toBeTruthy();
});
it('retains rounded scrolling, fixed-child clipping and saved scroll callbacks with own paint outside', () => {
  const node = frame(), changed = vi.fn(); node.scroll = { axis: 'both', initial: { x: 3, y: 5 } }; node.children.push({ ...child, id: 'fixed', name: 'Fixed', scrollBehaviour: 'fixed', fixedStyle: { position: 'absolute', left: 0, top: 0, width: 10, height: 10 } });
  const element = mount(node, { onScrollPositionChange: changed }), viewport = element.querySelector<HTMLElement>('[data-xdesign-scroll]')!, fixed = element.querySelector<HTMLElement>('[data-xdesign-fixed]')!;
  expect(element.style.overflow).toBe('visible'); expect(element.querySelector(':scope > img')).toBeTruthy(); expect(viewport.style.borderRadius).toBe('inherit'); expect(viewport.scrollLeft).toBe(3); expect(viewport.scrollTop).toBe(5); expect(fixed.style.overflow).toBe('hidden'); expect(fixed.style.borderRadius).toBe('inherit'); expect(fixed.querySelector('[data-name="Fixed"]')).toBeTruthy();
  act(() => { viewport.scrollLeft = 15; viewport.dispatchEvent(new Event('scroll', { bubbles: true })); }); expect(changed).toHaveBeenLastCalledWith('frame', { x: 15, y: 5 });
});
it('exports native frame clip semantics and radii without inventing clipping for other layer types', () => {
  const native = editor.graph.createNode('FRAME', editor.state.currentPageId, { width: 80, height: 60, name: 'Native', clipsContent: true, cornerRadius: 12 }); editor.graph.createNode('RECTANGLE', native.id, { width: 40, height: 40, x: 70 }); const model = selectionToDesignModel(editor.graph, [native.id]), node = model.nodes[0]!;
  expect(node.clipContent).toBe(true); expect(node.style.overflow).toBeUndefined(); expect(node.style.borderRadius).toBe(12); const element = mount(node); expect(element.style.borderRadius).toBe('12px'); expect(element.querySelector(':scope > [data-xdesign-content-clip]')).toBeTruthy();
  const rectangle = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 80, height: 60, clipsContent: true }); expect(selectionToDesignModel(editor.graph, [rectangle.id]).nodes[0]!.clipContent).toBe(false);
});
