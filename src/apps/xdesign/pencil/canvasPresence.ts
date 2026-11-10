import type { Editor } from '@open-pencil/core/editor';
import { NativeRoomTransport } from './nativeRoomTransport';
import { RoomPresenceClient, type PresenceIdentity, type RoomPresenceSnapshot } from './roomPresenceClient';
import { readPresenceState, type PresencePeer, type PresenceState } from './roomPresenceProtocol';
import { usePhotoWorkspace } from '../photo/runtime';
import { isDesignDialogOpen } from '../useDesignDialog';

export type CanvasPresenceSnapshot = RoomPresenceSnapshot & { following: { clientId: string; actorId: string; name: string } | null };
type Options = { current: () => boolean; navigable: () => boolean; onState: (state: CanvasPresenceSnapshot) => void };
export function presencePage(editor: Editor, pageId: string): boolean { const page = editor.graph.getNode(pageId); return page?.type === 'CANVAS' && !page.internalOnly; }
export function applyPresenceViewport(editor: Editor, view: PresenceState['view'], width: number, height: number): void {
  if (width < 4 || height < 4) throw new Error('Enlarge the canvas before following.');
  const zoom = Math.max(1e-8, Math.min(256, view.zoom * Math.min(width / view.width, height / view.height))), [x, y] = view.center;
  if (zoom >= .02) editor.setZoomAroundPoint(zoom, width / 2, height / 2);
  else {
    // The public fit API preserves legitimate zoom levels below the zoom setter's minimum.
    const w = width / zoom - 160, h = height / zoom - 160; editor.zoomToBounds(x - w / 2, y - h / 2, x + w / 2, y + h / 2);
  }
  editor.pan(width / 2 - (x * editor.state.zoom + editor.state.panX), height / 2 - (y * editor.state.zoom + editor.state.panY));
}
export class CanvasPresence {
  private closed = false;
  private started = false;
  private readonly opening = new AbortController();
  private client: RoomPresenceClient | null = null;
  private state: RoomPresenceSnapshot;
  private cursor: [number, number] | null = null;
  private target: CanvasPresenceSnapshot['following'] = null;
  private switching: AbortController | null = null;
  private switchingPage: string | null = null;
  private applying = false;
  private queued = false;
  private viewError: string | null = null;
  private readonly cleanup: (() => void)[] = [];
  constructor(readonly editor: Editor, readonly canvas: HTMLElement, readonly documentId: string, readonly actorId: string, readonly identity: PresenceIdentity, readonly serverUrl: string, private readonly options: Options) {
    this.state = { phase: 'connecting', clientId: identity.clientId, peers: [], error: null };
    const wrap = canvas.parentElement ?? canvas, root = canvas.closest('.xd-pencil') ?? wrap;
    const listen = <K extends keyof (HTMLElementEventMap & DocumentEventMap & WindowEventMap)>(node: HTMLElement | Window | Document, event: K, callback: (event: (HTMLElementEventMap & DocumentEventMap & WindowEventMap)[K]) => void) => {
      node.addEventListener(event, callback as EventListener, { capture: true }); this.cleanup.push(() => node.removeEventListener(event, callback as EventListener, { capture: true }));
    };
    listen(wrap, 'pointermove', event => { const rect = canvas.getBoundingClientRect(); this.cursor = rect.width > 0 && rect.height > 0 && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom ? [(event.clientX - rect.left) * canvas.clientWidth / rect.width, (event.clientY - rect.top) * canvas.clientHeight / rect.height] : null; });
    listen(wrap, 'pointerleave', () => { this.cursor = null; });
    listen(root as HTMLElement, 'pointerdown', event => { if (!(event.target instanceof Element && event.target.closest('[data-xd-follow]'))) this.stopFollowing(); });
    listen(root as HTMLElement, 'wheel', () => this.stopFollowing());
    listen(root as HTMLElement, 'keydown', () => this.stopFollowing());
    listen(window, 'blur', () => { this.cursor = null; this.stopFollowing(); });
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') { this.cursor = null; this.stopFollowing(); } });
    this.cleanup.push(editor.onEditorEvent('viewport:changed', () => { if (!this.applying) this.stopFollowing(); }), editor.onEditorEvent('page:changed', () => { this.cursor = null; if (!this.applying) this.stopFollowing(); }));
    this.cleanup.push(usePhotoWorkspace.subscribe(state => { if (state.shapeId) { this.cursor = null; this.stopFollowing(); } }));
    if (typeof ResizeObserver !== 'undefined') { const observer = new ResizeObserver(() => this.apply()); observer.observe(canvas); this.cleanup.push(() => observer.disconnect()); }
  }
  get snapshot(): CanvasPresenceSnapshot { return { ...this.state, error: this.state.error ?? this.viewError, following: this.target ? { ...this.target } : null }; }
  private notify(): void { if (!this.closed && this.options.current()) this.options.onState(this.snapshot); }
  private sample(): PresenceState | null {
    if (!this.options.current() || usePhotoWorkspace.getState().shapeId || document.visibilityState === 'hidden' || this.canvas.clientWidth < 1 || this.canvas.clientHeight < 1 || !presencePage(this.editor, this.editor.state.currentPageId)) return null;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight, center = this.editor.screenToCanvas(width / 2, height / 2), cursor = this.cursor && document.hasFocus() ? this.editor.screenToCanvas(...this.cursor) : null;
    return readPresenceState({ pageId: this.editor.state.currentPageId, cursor: cursor ? [cursor.x, cursor.y] : null, selection: [...this.editor.state.selectedIds].slice(0, 64), view: { center: [center.x, center.y], zoom: this.editor.state.zoom, width, height }, following: this.target?.clientId ?? null });
  }
  start(): void {
    if (this.started || this.closed) return; this.started = true;
    this.notify();
    void (async () => {
      let transport: NativeRoomTransport | undefined;
      try {
        transport = await NativeRoomTransport.open(this.serverUrl, this.documentId, this.opening.signal);
        if (this.closed || !this.options.current()) { await transport.dispose(); return; }
        const network = transport;
        this.client = new RoomPresenceClient(this.documentId, this.actorId, this.identity, { current: () => !this.closed && this.options.current(), state: () => this.sample(), request: (packet, signal) => network.presence(packet, signal), disposeTransport: () => network.dispose(), onState: state => this.received(state) }); this.client.start();
      } catch (error) { await transport?.dispose().catch(() => {}); if (!this.closed && this.options.current()) { this.state = { ...this.state, phase: 'error', peers: [], error: error instanceof Error ? error.message : 'Presence could not connect.' }; this.notify(); } }
    })();
  }
  private peer(): PresencePeer | undefined {
    const target = this.target; if (!target) return undefined;
    const peers = this.client?.snapshot.peers ?? this.state.peers;
    const peer = peers.find(peer => peer.clientId === target.clientId && peer.actor.id === target.actorId);
    if (!peer || !presencePage(this.editor, peer.state.pageId)) return undefined;
    const seen = new Set([this.identity.clientId]); let next: PresencePeer | undefined = peer;
    while (next) { if (seen.has(next.clientId) || next.state.following === this.identity.clientId) return undefined; seen.add(next.clientId); const following: string | null = next.state.following; next = peers.find(peer => peer.clientId === following); }
    return peer;
  }
  follow(clientId: string): void {
    if (!this.options.current() || !this.options.navigable() || usePhotoWorkspace.getState().shapeId || isDesignDialogOpen()) throw new Error('Finish the current edit before following.');
    const peer = this.state.peers.find(peer => peer.clientId === clientId); if (!peer || clientId === this.identity.clientId) throw new Error('This collaborator is no longer present.');
    this.stopFollowing(); this.target = { clientId, actorId: peer.actor.id, name: peer.actor.name };
    if (!this.peer()) { this.target = null; throw new Error('This collaborator’s page or follow target is unavailable.'); }
    this.viewError = null; this.notify(); this.apply();
  }
  stopFollowing(): void { if (!this.target) return; this.target = null; this.switching?.abort(); this.notify(); }
  private received(state: RoomPresenceSnapshot): void {
    if (this.closed) return; this.state = state;
    const peer = this.peer(); if (this.target && !peer) this.stopFollowing();
    else if (this.target && peer) { this.target.name = peer.actor.name; if (this.switchingPage && this.switchingPage !== peer.state.pageId) this.switching?.abort(); }
    this.notify(); this.apply();
  }
  private apply(): void {
    if (this.applying) { this.queued = true; return; }
    const peer = this.peer(); if (!peer || !this.options.current() || !this.options.navigable() || usePhotoWorkspace.getState().shapeId || isDesignDialogOpen()) return;
    const target = this.target; this.applying = true; this.queued = false;
    void (async () => {
      const controller = new AbortController(); this.switching = controller;
      try {
        if (this.editor.state.currentPageId !== peer.state.pageId) { this.switchingPage = peer.state.pageId; await this.editor.switchPage(peer.state.pageId, { signal: controller.signal }); }
        const latest = this.peer();
        if (this.closed || controller.signal.aborted || this.target !== target || !latest || !this.options.current()) return;
        if (this.editor.state.currentPageId !== latest.state.pageId) { this.queued = true; return; }
        if (!this.options.navigable() || usePhotoWorkspace.getState().shapeId || isDesignDialogOpen()) return;
        applyPresenceViewport(this.editor, latest.state.view, this.canvas.clientWidth, this.canvas.clientHeight);
      } catch (error) { if (!controller.signal.aborted && !this.closed && this.target === target) { this.viewError = `Could not follow this page: ${error instanceof Error ? error.message : String(error)}`; this.stopFollowing(); } }
      finally { if (this.switching === controller) { this.switching = null; this.switchingPage = null; } this.applying = false; if (this.queued && this.target) this.apply(); }
    })();
  }
  dispose(): void { if (this.closed) return; this.closed = true; this.opening.abort(); this.switching?.abort(); this.target = null; this.cursor = null; for (const cleanup of this.cleanup.splice(0)) cleanup(); void this.client?.dispose(); this.client = null; }
}
