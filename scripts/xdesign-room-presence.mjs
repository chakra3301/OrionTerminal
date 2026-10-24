import { createHash } from 'node:crypto';
import { RoomError } from './xdesign-room-store.mjs';

const RETAIN = 90_000;
export class RoomPresence {
  constructor(store, engine, { now = () => performance.now() } = {}) { this.store = store; this.engine = engine; this.now = now; this.rooms = new Map(); this.lastSweep = -Infinity; }
  sweep(now) {
    if (now - this.lastSweep < 1000) return;
    this.lastSweep = now;
    for (const [id, room] of this.rooms) { for (const [key, peer] of room) if (now - peer.at >= RETAIN) room.delete(key); if (!room.size) this.rooms.delete(id); }
  }
  exchange(actor, input) {
    let request;
    try { request = this.engine.readPresenceRequest(input); } catch { throw new RoomError(422, 'invalid', 'Invalid room presence request.'); }
    const member = this.store.principal(request.documentId, actor), now = this.now(); this.sweep(now);
    const members = new Map(this.store.db.prepare('SELECT id,name,role,revoked FROM members WHERE room_id=?').all(request.documentId).map(member => [member.id, member]));
    const currentMember = members.get(member.id); if (!currentMember || currentMember.revoked) throw new RoomError(401, 'unauthorized', 'Room access is unavailable. Reconnect with a valid membership credential.');
    const memberActor = member => this.engine.readPresenceResponse({ version: 1, documentId: request.documentId, clientId: request.clientId, sequence: request.sequence, actor: { id: member.id, name: member.name, role: member.role }, peers: [] }, request).actor;
    let currentActor;
    try { currentActor = memberActor(currentMember); } catch { throw new RoomError(409, 'presence-member', 'This membership cannot publish presence.'); }
    const room = this.rooms.get(request.documentId) ?? new Map(), key = `${member.id}/${request.clientId}`;
    for (const [id, peer] of room) if (members.get(peer.actorId)?.revoked || !members.has(peer.actorId)) room.delete(id);
    if ([...room.values()].some(peer => peer.clientId === request.clientId && peer.actorId !== member.id)) throw new RoomError(409, 'presence-client', 'This presence client belongs to another member.');
    const old = room.get(key), digest = createHash('sha256').update(JSON.stringify(request.state)).digest('hex');
    if (old && (old.sequence > request.sequence || old.sequence === request.sequence && old.digest !== digest)) throw new RoomError(409, 'presence-order', 'This presence sequence has already been used.');
    if (!old || old.sequence < request.sequence) {
      const active = peer => peer.state && now - peer.at < this.engine.PRESENCE_TTL;
      if (!old && room.size >= this.engine.PRESENCE_PEERS || request.state && (!old || !active(old)) && [...room.values()].filter(peer => peer.actorId === member.id && peer.clientId !== request.clientId && active(peer)).length >= 4) throw new RoomError(429, 'capacity', 'Wait for an inactive presence session to expire.');
      if (!old && this.rooms.size >= 128 && !this.rooms.has(request.documentId)) throw new RoomError(429, 'capacity', 'The presence service has reached its room limit.');
      room.set(key, { actorId: member.id, clientId: request.clientId, sequence: request.sequence, digest, state: request.state, at: now }); this.rooms.set(request.documentId, room);
    }
    const peers = [];
    for (const peer of room.values()) {
      const current = members.get(peer.actorId), expiresInMs = this.engine.PRESENCE_TTL - (now - peer.at);
      if (!peer.state || !current || current.revoked || expiresInMs <= 0) continue;
      let actor;
      // Legacy member rows stay intact even when their labels cannot cross native JSON.
      try { actor = memberActor(current); } catch { continue; }
      peers.push({ clientId: peer.clientId, sequence: peer.sequence, actor, state: peer.state, expiresInMs });
    }
    return { version: 1, documentId: request.documentId, clientId: request.clientId, sequence: request.sequence, actor: currentActor, peers };
  }
  close() { this.rooms.clear(); }
}
