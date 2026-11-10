import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InspectPanel } from './InspectPanel';
import * as runtime from './runtime';
import * as exports from '../exportXD';
let editor: Editor, host: HTMLDivElement, root: Root;
const delivered = 'export default function Ready() { return <button>Ready</button>; }';
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); editor = createEditor();
  const node = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Ready' }); editor.select([node.id]);
  runtime.usePencilWorkspace.setState({ editor, busy: false });
  vi.spyOn(runtime, 'exportPencil').mockResolvedValue(new TextEncoder().encode(delivered));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<InspectPanel tab="code"/>));
  await act(async () => { const select = host.querySelector('select')!; select.value = 'react'; select.dispatchEvent(new Event('change', { bubbles: true })); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); editor.dispose(); runtime.usePencilWorkspace.setState({ editor: null, busy: false }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (name: string) => [...host.querySelectorAll('button')].find(button => button.textContent === name)!;
const refresh = () => runtime.usePencilWorkspace.setState(state => ({ version: state.version + 1 }));

it('generates on request, retains code while panning, and invalidates layer and theme edits', async () => {
  expect(runtime.exportPencil).not.toHaveBeenCalled(); await act(async () => button('Generate React component').click());
  expect(host.querySelector('textarea')!.value).toBe(delivered); expect(button('Copy code').disabled).toBe(false);
  await act(async () => { editor.state.panX = 50; refresh(); }); expect(runtime.exportPencil).toHaveBeenCalledTimes(1); expect(button('Copy code').disabled).toBe(false);
  await act(async () => editor.graph.updateNode([...editor.state.selectedIds][0]!, { width: 300 })); expect(button('Copy code').disabled).toBe(true);
  await act(async () => button('Generate React component').click()); expect(button('Copy code').disabled).toBe(false);
  await act(async () => { const collection = editor.graph.createCollection('Theme'); editor.graph.createVariable('Ink', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 }); refresh(); }); expect(button('Copy code').disabled).toBe(true);
});

it('discards a pending export when the page changes', async () => {
  let resolve!: (bytes: Uint8Array) => void;
  vi.mocked(runtime.exportPencil).mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => button('Generate React component').click());
  await act(async () => { editor.state.currentPageId = editor.graph.createNode('CANVAS', editor.graph.rootId, { name: 'Other page' }).id; editor.state.selectedIds.clear(); refresh(); });
  await act(async () => resolve(new TextEncoder().encode(delivered)));
  expect(host.querySelector('textarea')!.value).toBe(''); expect(button('Copy code').disabled).toBe(true);
});

it('exports a native archive with the existing save flow and reports cancellation accurately', async () => {
  const save = vi.spyOn(exports, 'saveExport').mockResolvedValue(false);
  await act(async () => { const select = host.querySelector('select')!; select.value = 'native-react'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelector('textarea')).toBeNull();
  await act(async () => button('Export native React').click());
  expect(runtime.exportPencil).toHaveBeenCalledWith('NATIVE_REACT', 1, [...editor.state.selectedIds]);
  expect(save).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Export cancelled.');
});

it('does not save a native archive after its captured source changes', async () => {
  let resolve!: (bytes: Uint8Array) => void;
  vi.mocked(runtime.exportPencil).mockReturnValue(new Promise(done => { resolve = done; }));
  const save = vi.spyOn(exports, 'saveExport').mockResolvedValue(true);
  await act(async () => { const select = host.querySelector('select')!; select.value = 'native-react'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => button('Export native React').click());
  await act(async () => editor.graph.updateNode([...editor.state.selectedIds][0]!, { width: 400 }));
  await act(async () => resolve(new Uint8Array([1, 2, 3])));
  expect(save).not.toHaveBeenCalled();
});
