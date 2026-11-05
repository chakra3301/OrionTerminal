import type { Editor } from '@open-pencil/core/editor';
import { getWorldMatrix, TransformMatrix } from '@open-pencil/scene-graph';
import type { CanvasPresenceSnapshot } from './canvasPresence';
import { presencePage } from './canvasPresence';
import type { CanvasRoomSession } from './roomSession';

const names = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function presenceCaption(name: string): string {
  const characters = [...names.segment(name)].map(part => part.segment);
  return characters.length > 24 ? `${characters.slice(0, 23).join('')}…` : name;
}
export function presenceColor(actorId: string): string {
  let hash = 0; for (const char of actorId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `var(--${['neon-magenta', 'neon-cyan', 'neon-green', 'neon-violet', 'neon-yellow'][hash % 5]})`;
}
export function presenceSelectionPoints(editor: Editor, id: string): { x: number; y: number }[] | null {
  const node = editor.graph.getNode(id); if (!node || node.internalOnly || node.type === 'CANVAS') return null;
  const seen = new Set<string>(); let ancestor = node;
  while (ancestor.type !== 'CANVAS') { if (seen.has(ancestor.id) || ancestor.internalOnly || !ancestor.parentId) return null; seen.add(ancestor.id); const parent = editor.graph.getNode(ancestor.parentId); if (!parent) return null; ancestor = parent; }
  if (ancestor.id !== editor.state.currentPageId || ancestor.internalOnly) return null;
  const matrix = getWorldMatrix(node, editor.graph);
  const points = [{ x: 0, y: 0 }, { x: node.width, y: 0 }, { x: node.width, y: node.height }, { x: 0, y: node.height }].map(point => TransformMatrix.mapPoint(matrix, point)).map(point => ({ x: point.x * editor.state.zoom + editor.state.panX, y: point.y * editor.state.zoom + editor.state.panY }));
  return points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)) ? points : null;
}
export function PresenceCanvas({ editor, presence }: { editor: Editor; presence: CanvasPresenceSnapshot | null }) {
  if (!presence?.peers.length) return null;
  return <svg className="xd-presence-canvas" aria-hidden="true">{presence.peers.filter(peer => peer.state.pageId === editor.state.currentPageId && presencePage(editor, peer.state.pageId)).map(peer => {
    const color = presenceColor(peer.actor.id), cursor = peer.state.cursor, name = presenceCaption(peer.actor.name);
    return <g key={peer.clientId} style={{ color }}>{peer.state.selection.map(id => { const points = presenceSelectionPoints(editor, id); return points ? <polygon key={id} points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5"/> : null; })}{cursor && <g transform={`translate(${cursor[0] * editor.state.zoom + editor.state.panX},${cursor[1] * editor.state.zoom + editor.state.panY})`}><path d="M0 0L0 16L4 12L7 19L10 17L7 10L13 10Z" fill="currentColor" stroke="var(--bg-0)" strokeWidth="1"/><rect x="8" y="20" width={Math.min(172, name.length * 7 + 12)} height="20" fill="var(--xd-panel)" stroke="currentColor"/><text x="14" y="34" fill="var(--t-primary)">{name}</text></g>}</g>;
  })}</svg>;
}
export function PresenceControls({ editor, room, presence, busy, report }: { editor: Editor; room: CanvasRoomSession; presence: CanvasPresenceSnapshot; busy: boolean; report: (message: string) => void }) {
  const run = (work: () => void) => { try { work(); } catch (error) { report(error instanceof Error ? error.message : String(error)); } };
  return <div className="xd-presence-controls" aria-label="Room collaborators" data-xd-follow="true">
    {presence.following && <><span title={`Following ${presence.following.name}`}>Following {presence.following.name}</span><button type="button" onClick={() => room.stopFollowing()}>Stop following</button></>}
    {presence.error && <button type="button" title={presence.error} disabled={busy} onClick={() => run(() => room.retryPresence())}>Retry presence</button>}
    {presence.phase === 'connecting' && <span role="status">Connecting presence…</span>}
    {presence.peers.length ? <details><summary>{presence.peers.length + 1} here</summary><div className="xd-presence-peers" aria-label="Collaborators to follow">{presence.peers.map(peer => <button type="button" key={peer.clientId} data-xd-follow="true" aria-label={`Follow ${peer.actor.name}`} aria-pressed={presence.following?.clientId === peer.clientId} disabled={busy || !!editor.state.editingTextId || !presencePage(editor, peer.state.pageId)} onClick={() => run(() => room.followPeer(peer.clientId))}><i aria-hidden="true" style={{ background: presenceColor(peer.actor.id) }}/><span>{peer.actor.name}<small>{peer.actor.role} · {editor.graph.getNode(peer.state.pageId)?.name ?? 'Unavailable page'}</small></span></button>)}</div></details> : presence.phase === 'online' && !presence.error && <span>Only you</span>}
  </div>;
}
