import { readPresenceRequest, readPresenceResponse, readPresenceState, type PresencePeer, type PresenceRequest, type PresenceState } from './roomPresenceProtocol';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { RoomRequestFailure } from './sharedRoomConnection';

export type PresenceIdentity = { clientId: string; sequence: number };
export type RoomPresenceSnapshot = { phase: 'connecting' | 'online' | 'retrying' | 'error' | 'closed'; clientId: string; peers: PresencePeer[]; error: string | null };
export type RoomPresenceOptions = {
  request: (packet: PresenceRequest, signal: AbortSignal) => Promise<unknown>;
  state: () => PresenceState | null;
  current: () => boolean;
  onState: (state: RoomPresenceSnapshot) => void;
  disposeTransport: () => Promise<void>;
  now?: () => number;
};
type Lease = { peer: PresencePeer; expiresAt: number; seenAt: number; stateJson: string };
const interrupted = () => new DOMException('Presence was cancelled.', 'AbortError');
async function bounded(work: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work.then(() => true, () => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

export class RoomPresenceClient {
  private closed = false;
  private stopped = false;
  private running: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly leases = new Map<string, Lease>();
  private visible = new Set<string>();
  private attempt = 0;
  private phase: RoomPresenceSnapshot['phase'] = 'connecting';
  private error: string | null = null;
  private readonly now: () => number;
  constructor(readonly documentId: string, readonly actorId: string, readonly identity: PresenceIdentity, private readonly options: RoomPresenceOptions) {
    validateSharedDocumentId(documentId); validateSharedDocumentId(actorId); validateSharedDocumentId(identity.clientId);
    if (!Number.isSafeInteger(identity.sequence) || identity.sequence < 0) throw new Error('Invalid presence sequence.');
    this.now = options.now ?? (() => performance.now());
  }
  get snapshot(): RoomPresenceSnapshot {
    const now = this.now();
    return { phase: this.phase, clientId: this.identity.clientId, error: this.error, peers: [...this.visible].flatMap(id => {
      const lease = this.leases.get(id); if (!lease || lease.expiresAt <= now || id === this.identity.clientId) return [];
      return [{ ...lease.peer, actor: { ...lease.peer.actor }, state: readPresenceState(lease.peer.state), expiresInMs: lease.expiresAt - now }];
    }) };
  }
  private notify(): void { try { this.options.onState(this.snapshot); } catch {} }
  private next(state: PresenceState | null): PresenceRequest {
    if (!Number.isSafeInteger(this.identity.sequence + 1)) throw new Error('Reopen the canvas before publishing presence.');
    return readPresenceRequest({ version: 1, documentId: this.documentId, clientId: this.identity.clientId, sequence: ++this.identity.sequence, state });
  }
  start(): void { if (this.closed || this.running || this.timer) return; this.notify(); this.expire(); this.kick(); }
  private expire(): void {
    clearTimeout(this.expiryTimer); if (this.closed) return;
    if (!this.options.current()) { void this.dispose(); return; }
    const now = this.now(); let changed = false, wait = 1000;
    for (const id of this.visible) { const lease = this.leases.get(id); if (!lease || lease.expiresAt <= now) { this.visible.delete(id); changed = true; } else wait = Math.min(wait, lease.expiresAt - now); }
    for (const [id, lease] of this.leases) if (lease.expiresAt <= now && now - lease.seenAt >= 90_000) this.leases.delete(id);
    if (changed) this.notify(); this.expiryTimer = setTimeout(() => this.expire(), Math.max(1, wait));
  }
  private kick(): void {
    if (this.closed || this.stopped || this.running) return;
    const work = Promise.resolve().then(() => this.cycle()); this.running = work;
    void work.finally(() => { if (this.running === work) this.running = null; if (!this.closed && !this.stopped) this.timer = setTimeout(() => { this.timer = undefined; this.kick(); }, this.attempt ? Math.min(8000, 500 * 2 ** Math.min(this.attempt, 4)) : 250); });
  }
  private async cycle(): Promise<void> {
    if (this.closed || !this.options.current()) { void this.dispose(); return; }
    const controller = new AbortController(); this.controller = controller;
    let requesting = false, received = false, timedOut = false;
    const timeout = setTimeout(() => { if (this.closed) return; timedOut = true; controller.abort(); this.visible.clear(); this.phase = 'retrying'; this.error = 'Presence timed out. Retrying…'; this.notify(); }, 8000);
    try {
      const packet = this.next(this.options.state()), sentAt = this.now(); requesting = true;
      const value = await this.options.request(packet, controller.signal); received = true;
      if (this.closed || controller.signal.aborted || !this.options.current()) throw interrupted();
      const response = readPresenceResponse(value, packet); if (response.actor.id !== this.actorId) throw new Error('Presence belongs to a different membership.');
      const now = this.now(), visible = new Set<string>();
      for (const peer of response.peers) {
        const old = this.leases.get(peer.clientId), stateJson = JSON.stringify(peer.state);
        if (old?.peer.actor.id === peer.actor.id && (peer.sequence < old.peer.sequence || peer.sequence === old.peer.sequence && stateJson !== old.stateJson) || old && old.expiresAt > now && old.peer.actor.id !== peer.actor.id) throw new Error('The presence response regressed or changed a peer identity.');
        // Subtract the full round trip; the same sequence can never renew an old lease.
        const expiresAt = old?.peer.actor.id === peer.actor.id && old.peer.sequence === peer.sequence ? Math.min(old.expiresAt, sentAt + peer.expiresInMs) : sentAt + peer.expiresInMs;
        this.leases.set(peer.clientId, { peer, expiresAt, stateJson, seenAt: now }); if (expiresAt > now) visible.add(peer.clientId);
      }
      if (this.leases.size > 256) for (const [id, lease] of [...this.leases].sort((a, b) => a[1].seenAt - b[1].seenAt)) { if (this.leases.size <= 256) break; if (lease.expiresAt <= now) this.leases.delete(id); }
      if (this.leases.size > 256) throw new Error('The presence service exceeded its retained identity limit.');
      this.visible = visible; this.phase = 'online'; this.error = null; this.attempt = 0; this.notify(); this.expire();
    } catch (value) {
      if (this.closed) return;
      if (!this.options.current()) { void this.dispose(); return; }
      const error = value instanceof Error ? value : new Error(String(value));
      if (!requesting || !timedOut && (received || !(error instanceof RoomRequestFailure) || error.status < 500 && error.status !== 429)) { this.stopped = true; this.visible.clear(); this.phase = 'error'; }
      else { this.attempt++; this.phase = 'retrying'; }
      this.error = timedOut ? 'Presence timed out. Retrying…' : error.message; this.notify();
    } finally { clearTimeout(timeout); if (this.controller === controller) this.controller = null; }
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.phase = 'closed'; this.visible.clear(); clearTimeout(this.timer); clearTimeout(this.expiryTimer); this.controller?.abort();
    // Allocate leave before another connection can publish with this identity.
    let leave: PresenceRequest | undefined; try { leave = this.next(null); } catch {}
    const pending = this.running;
    this.closing = Promise.resolve().then(async () => {
      try {
        if ((!pending || await bounded(pending, 1000)) && leave) {
          const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1000);
          try { await bounded(Promise.resolve().then(() => this.options.request(leave!, controller.signal)), 1000); }
          finally { controller.abort(); clearTimeout(timer); }
        }
      } finally { this.leases.clear(); await this.options.disposeTransport().catch(() => {}); }
    });
    this.notify();
    return this.closing;
  }
}
