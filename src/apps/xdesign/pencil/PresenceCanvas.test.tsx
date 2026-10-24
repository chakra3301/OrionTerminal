import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { SceneGraph } from '@open-pencil/scene-graph';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyPresenceViewport, type CanvasPresenceSnapshot } from './canvasPresence';
import { PresenceCanvas, PresenceControls, presenceSelectionPoints, presenceCaption } from './PresenceCanvas';
import type { CanvasRoomSession } from './roomSession';
import { serializeGraph } from './document';
let editor: Editor, root: Root, container: HTMLElement, nodeId: string, pageId: string;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const graph = new SceneGraph(); pageId = graph.getPages()[0]!.id;
  const frame = graph.createNode('FRAME', pageId, { x: 100, y: 50, width: 200, height: 100, rotation: 90 }); nodeId = graph.createNode('RECTANGLE', frame.id, { x: 10, y: 20, width: 40, height: 30 }).id;
  editor = createEditor({ graph, getViewportSize: () => ({ width: 800, height: 600 }) }); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); editor.dispose(); container.remove(); vi.unstubAllGlobals(); });
function presence(): CanvasPresenceSnapshot { return { clientId: 'local_presence_001', phase: 'online', error: null, following: null, peers: [{ clientId: 'remote_presence_001', sequence: 1, expiresInMs: 15000, actor: { id: 'remote_membership_001', name: 'Partner', role: 'viewer' }, state: { pageId, cursor: [12, 24], selection: [nodeId, 'missing'], view: { center: [500, 400], zoom: 1, width: 800, height: 600 }, following: null } }] }; }
it('truncates cursor captions at grapheme boundaries for emoji, accents and joined family glyphs', () => {
  expect(presenceCaption('👩🏽‍🎨'.repeat(24))).toBe('👩🏽‍🎨'.repeat(24)); expect(presenceCaption('👩🏽‍🎨'.repeat(25))).toBe('👩🏽‍🎨'.repeat(23) + '…');
  expect(presenceCaption('e\u0301'.repeat(25))).toBe('e\u0301'.repeat(23) + '…');
});
it('draws transformed current-page selection corners and cursor labels without touching the graph or intercepting input', () => {
  const before = serializeGraph(editor.graph), snapshot = presence(); const points = presenceSelectionPoints(editor, nodeId)!;
  expect(points[0]!.x).toBeCloseTo(230); expect(points[0]!.y).toBeCloseTo(10);
  act(() => root.render(<PresenceCanvas editor={editor} presence={snapshot}/>)); expect(container.querySelectorAll('polygon')).toHaveLength(1); expect(container.querySelector('text')!.textContent).toBe('Partner'); expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  expect(serializeGraph(editor.graph)).toBe(before); expect(editor.undo.canUndo).toBe(false); expect(presenceSelectionPoints(editor, 'missing')).toBeNull();
  snapshot.peers[0]!.state.pageId = 'missing'; act(() => root.render(<PresenceCanvas editor={editor} presence={snapshot}/>)); expect(container.querySelector('text')).toBeNull();
});
it('suppresses cross-page and internal node outlines, including internal ancestors', () => {
  const hiddenPage = editor.graph.createNode('CANVAS', editor.graph.rootId, { name: 'Internal', internalOnly: true }); const hidden = editor.graph.createNode('RECTANGLE', hiddenPage.id, { width: 20, height: 20 }); expect(presenceSelectionPoints(editor, hidden.id)).toBeNull();
  editor.graph.updateNode(nodeId, { internalOnly: true }); expect(presenceSelectionPoints(editor, nodeId)).toBeNull();
  const second = editor.graph.createNode('CANVAS', editor.graph.rootId, { name: 'Other' }), rectangle = editor.graph.createNode('RECTANGLE', second.id, { width: 20, height: 20 }); expect(presenceSelectionPoints(editor, rectangle.id)).toBeNull();
});
it.each([1, .001, 1e-8])('fits a peer viewport at zoom %s into the local canvas with the correct center and no undo entry', zoom => {
  const before = serializeGraph(editor.graph); applyPresenceViewport(editor, { center: [500, 400], zoom, width: 1600, height: 1200 }, 800, 600);
  expect(editor.state.zoom).toBeCloseTo(Math.max(1e-8, zoom / 2), 10); expect(Math.abs(editor.screenToCanvas(400, 300).x - 500) * editor.state.zoom).toBeLessThan(1e-8); expect(Math.abs(editor.screenToCanvas(400, 300).y - 400) * editor.state.zoom).toBeLessThan(1e-8); expect(serializeGraph(editor.graph)).toBe(before); expect(editor.undo.canUndo).toBe(false);
});
it('keeps Stop available while follow navigation is busy and exposes member/page/access through native controls', () => {
  const stop = vi.fn(), follow = vi.fn(), retry = vi.fn(), report = vi.fn(), room = { stopFollowing: stop, followPeer: follow, retryPresence: retry } as unknown as CanvasRoomSession, snapshot = presence(); snapshot.following = { clientId: snapshot.peers[0]!.clientId, actorId: snapshot.peers[0]!.actor.id, name: 'Partner' };
  act(() => root.render(<PresenceControls editor={editor} room={room} presence={snapshot} busy={true} report={report}/>)); const button = container.querySelector('button')!; expect(button.textContent).toBe('Stop following'); expect(button.disabled).toBe(false); expect(button.closest('[inert]')).toBeNull(); act(() => button.click()); expect(stop).toHaveBeenCalledOnce();
  const peerButton = container.querySelector('[aria-label="Follow Partner"]') as HTMLButtonElement; expect(peerButton.disabled).toBe(true); expect(peerButton.textContent).toContain('viewer');
  act(() => root.render(<PresenceControls editor={editor} room={room} presence={snapshot} busy={false} report={report}/>)); act(() => (container.querySelector('[aria-label="Follow Partner"]') as HTMLButtonElement).click()); expect(follow).toHaveBeenCalledWith('remote_presence_001'); expect(report).not.toHaveBeenCalled();
  snapshot.error = 'Presence unavailable'; act(() => root.render(<PresenceControls editor={editor} room={room} presence={snapshot} busy={false} report={report}/>)); const retryButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry presence')!; act(() => retryButton.click()); expect(retry).toHaveBeenCalledOnce();
});
