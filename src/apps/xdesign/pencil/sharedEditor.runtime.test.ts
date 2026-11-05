import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
import { SceneGraph } from '@open-pencil/scene-graph';
import { useXDesign } from '../store';
import { useXDProjects } from '../projectsStore';
import { usePencilWorkspace, startPencilSession, startSharedPencilSession, persistPencil } from './runtime';
import { SharedDesign } from './sharedDesign';
import { SharedEditorBinding } from './sharedEditor';
import { deserializeGraph, serializeGraph } from './graphDocument';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock('@/lib/db', () => ({ getAppState: vi.fn(async () => null) }));
let session: ReturnType<typeof startPencilSession> | undefined;
const replicas: SharedDesign[] = [];
beforeEach(() => {
  useXDesign.getState().hydrate(null); const id = ulid(); useXDProjects.setState({ activeId: id, transitioning: false, ready: true, registry: [{ id, name: 'Shared runtime', createdAt: 0, updatedAt: 0 }] });
  usePencilWorkspace.setState({ editor: null, busy: false, error: null });
});
afterEach(() => { session?.dispose(); session = undefined; replicas.splice(0).forEach(replica => replica.dispose()); });
function documentData() { const graph = new SceneGraph(); return { formatVersion: 1 as const, graph: serializeGraph(graph), pageId: graph.getPages()[0]!.id, panX: 20, panY: 40, zoom: 1.5, photoLinks: {} }; }
it('binds a fresh runtime editor before ready and persists actual local and peer design changes', async () => {
  const doc = documentData(); useXDesign.setState({ pencilDocument: doc }); let binding!: SharedEditorBinding, replica!: SharedDesign, peer!: SharedDesign;
  const ready = vi.fn(() => expect(binding).toBeDefined());
  session = startPencilSession(document.createElement('div'), doc, ready, editor => {
    replica = SharedDesign.fromGraph(editor.graph); peer = SharedDesign.fromUpdate(replica.update()); replicas.push(replica, peer);
    binding = new SharedEditorBinding(editor, replica, { publish: persistPencil, isCurrent: () => usePencilWorkspace.getState().editor === editor, onUpdate: change => peer.receive(change.update) }); return binding;
  });
  const editor = session.editor, node = editor.graph.createNode('RECTANGLE', doc.pageId); binding.flush(); editor.updateNodeWithUndo(node.id, { x: 150 }); binding.flush();
  await binding.receive(peer.edit('Peer', graph => graph.updateNode(node.id, { width: 210 })).update);
  const saved = useXDesign.getState().pencilDocument!; expect(deserializeGraph(saved.graph).getNode(node.id)).toMatchObject({ x: 150, width: 210 }); expect(saved.panX).toBe(20); expect(saved.zoom).toBe(1.5); ready.mockClear();
  editor.undoAction(); expect(node.width).toBe(210); expect(node.x).toBe(0); persistPencil(); session.dispose(); session = undefined; expect(usePencilWorkspace.getState().editor).toBeNull();
});
it('preserves the local document and releases editor state when the startup binding fails', () => {
  const doc = documentData(); useXDesign.setState({ pencilDocument: doc }); const ready = vi.fn();
  expect(() => startPencilSession(document.createElement('div'), doc, ready, () => { throw new Error('Room unavailable'); })).toThrow('Room unavailable'); expect(ready).not.toHaveBeenCalled(); expect(usePencilWorkspace.getState().editor).toBeNull(); expect(useXDesign.getState().pencilDocument).toBe(doc); expect(usePencilWorkspace.getState().error).toContain('Room unavailable');
});
it('keeps the default local runtime on its original native history path', () => {
  const doc = documentData(); useXDesign.setState({ pencilDocument: doc }); session = startPencilSession(document.createElement('div'), doc, () => {});
  const node = session.editor.graph.createNode('RECTANGLE', doc.pageId); session.editor.updateNodeWithUndo(node.id, { x: 100 }); session.editor.undoAction(); expect(node.x).toBe(0); session.editor.redoAction(); expect(node.x).toBe(100); expect(node.id).toMatch(/^0:/);
});
it('loads the production shared entry with project guards and owned busy state', async () => {
  const doc = documentData(), replica = SharedDesign.fromGraph(deserializeGraph(doc.graph)); replicas.push(replica); useXDesign.setState({ pencilDocument: doc });
  session = await startSharedPencilSession(document.createElement('div'), doc, replica, () => {});
  const graph = session.editor.graph, node = graph.createNode('RECTANGLE', doc.pageId); session.editor.updateNodeWithUndo(node.id, { x: 80 }); const ready = session.editor.switchPage(doc.pageId); expect(usePencilWorkspace.getState().busy).toBe(true); await ready; expect(usePencilWorkspace.getState().busy).toBe(false);
  useXDProjects.setState({ activeId: ulid() }); expect(() => session!.editor.updateNodeWithUndo(node.id, { x: 100 })).toThrow('no longer active'); expect(replica.graph.getNode(node.id)!.x).toBe(80);
});
