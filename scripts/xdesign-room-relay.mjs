import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { roomEngine } from './xdesign-room-engine.mjs';
import { RoomError, RoomStore } from './xdesign-room-store.mjs';
import { RoomPresence } from './xdesign-room-presence.mjs';

const MAX_BODY = 46 * 1024 * 1024;
function bearer(request) {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith('Bearer ')) throw new RoomError(401, 'unauthorized', 'A valid room credential is required.');
  return value.slice(7);
}
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new RoomError(422, 'invalid', 'Invalid room request fields.');
  if (value.version !== 1) throw new RoomError(422, 'version', 'Unsupported shared room protocol version.');
  return value;
}
async function body(request, limit = MAX_BODY) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new RoomError(415, 'format', 'Use a JSON room request.');
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new RoomError(415, 'format', 'Compressed room request bodies are unsupported.');
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new RoomError(413, 'capacity', 'The room request exceeds its transfer limit.');
  const chunks = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.byteLength; if (bytes > limit) throw new RoomError(413, 'capacity', 'The room request exceeds its transfer limit.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
  catch { throw new RoomError(422, 'invalid', 'Invalid room request JSON.'); }
}
function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}
export async function createRoomRelay({ database, adminSecret, grantSecret = adminSecret, engine: suppliedEngine }) {
  if (typeof adminSecret !== 'string' || adminSecret.length < 32 || adminSecret.length > 256 || /[\x00-\x20\x7f]/.test(adminSecret)) throw new Error('Configure a private room administrator secret using 32–256 non-whitespace characters.');
  const engine = suppliedEngine ?? await roomEngine(), store = new RoomStore(database, engine.api, { grantSecret }), administrator = createHash('sha256').update(adminSecret).digest();
  const presence = new RoomPresence(store, engine.api);
  const admin = request => {
    if (!timingSafeEqual(createHash('sha256').update(bearer(request)).digest(), administrator)) throw new RoomError(401, 'unauthorized', 'Room administrator access is required.');
  };
  const rates = new Map();
  let closed = false;
  const handle = async (request, response) => {
    try {
      if (closed) throw new RoomError(503, 'offline', 'The room service is closing.');
      const now = Date.now(), address = request.socket.remoteAddress ?? '', prior = rates.get(address);
      if (prior && now - prior.at < 1000 && prior.count >= 80) throw new RoomError(429, 'rate', 'Wait before retrying the room request.');
      rates.set(address, prior && now - prior.at < 1000 ? { at: prior.at, count: prior.count + 1 } : { at: now, count: 1 });
      if (rates.size > 1024) for (const [key, value] of rates) if (now - value.at > 60_000) rates.delete(key);
      const url = new URL(request.url, 'http://room.local');
      if (url.search) throw new RoomError(422, 'invalid', 'Room credentials and state belong in headers and JSON, not query strings.');
      if (request.method === 'POST' && url.pathname === '/v1/rooms') {
        admin(request); const value = object(await body(request), ['version', 'documentId', 'name', 'ownerName', 'checkpoint', 'requestId']); admin(request);
        let checkpoint; try { checkpoint = engine.api.readRoomBinary(value.checkpoint); } catch { throw new RoomError(422, 'invalid', 'Invalid shared room checkpoint.'); }
        return send(response, 201, store.create(value.documentId, value.name, value.ownerName, checkpoint, value.requestId));
      }
      const recovery = /^\/v1\/rooms\/([A-Za-z0-9_-]{16,128})\/grants\/(create|invite)\/([A-Za-z0-9_-]{16,128})$/.exec(url.pathname);
      if (recovery) {
        if (request.method !== 'GET') throw new RoomError(405, 'method', 'Grant recovery requires GET.');
        const [, documentId, kind, requestId] = recovery;
        if (kind === 'create') { admin(request); return send(response, 200, store.recoverGrant(documentId, kind, requestId)); }
        const actor = store.authorize(documentId, bearer(request)); return send(response, 200, store.recoverGrant(documentId, kind, requestId, actor));
      }
      const libraries = /^\/v1\/rooms\/([A-Za-z0-9_-]{16,128})\/libraries(?:\/(revision)|\/receipts\/([A-Za-z0-9_-]{16,128}))?$/.exec(url.pathname);
      if (libraries) {
        const [, documentId, revision, requestId] = libraries, credential = bearer(request);
        let actor = store.authorize(documentId, credential);
        if (requestId) {
          if (request.method !== 'GET') throw new RoomError(405, 'method', 'Library receipt recovery requires GET.');
          return send(response, 200, store.recoverLibrary(documentId, actor, requestId));
        }
        if (!revision && request.method === 'GET') return send(response, 200, store.libraryCatalog(documentId, actor));
        if (request.method !== 'POST') throw new RoomError(405, 'method', 'Library reads and publications require POST.');
        const value = await body(request, revision ? 4096 : engine.api.ROOM_LIBRARY_TRANSFER_LIMIT); actor = store.authorize(documentId, credential);
        return send(response, 200, revision ? await store.libraryRevision(documentId, actor, value) : await store.publishLibrary(documentId, actor, value));
      }
      const images = /^\/v1\/rooms\/([A-Za-z0-9_-]{16,128})\/images(?:\/(revision|uploads)(?:\/([A-Za-z0-9_-]{16,128})(?:\/(commit|chunks\/([0-9]{1,3})))?)?|\/([A-Za-z0-9_-]{16,128})\/revisions\/([a-f0-9]{64})\/chunks\/([0-9]{1,3}))?$/.exec(url.pathname);
      if (images) {
        const [, documentId, route, requestId, action, index, imageId, revisionId, readIndex] = images, credential = bearer(request);
        let actor = store.authorize(documentId, credential);
        if (imageId && request.method === 'GET') return send(response, 200, store.imageChunk(documentId, actor, imageId, revisionId, Number(readIndex)));
        if (!route && !imageId && request.method === 'GET') return send(response, 200, store.imageCatalog(documentId, actor));
        if (route === 'uploads' && requestId && !action && request.method === 'GET') return send(response, 200, store.imageUpload(documentId, actor, requestId));
        if (route === 'uploads' && requestId && !action && request.method === 'DELETE') return send(response, 200, store.dismissImage(documentId, actor, requestId));
        if (route === 'uploads' && requestId && index !== undefined && request.method === 'PUT') {
          const value = await body(request, engine.api.ROOM_IMAGE_MESSAGE_BYTES); actor = store.authorize(documentId, credential);
          return send(response, 200, store.putImageChunk(documentId, actor, requestId, Number(index), value));
        }
        if (request.method === 'POST' && (route === 'revision' && !requestId || route === 'uploads' && (!requestId || action === 'commit'))) {
          const value = await body(request, engine.api.ROOM_IMAGE_METADATA_BYTES); actor = store.authorize(documentId, credential);
          if (requestId && value?.requestId !== requestId) throw new RoomError(409, 'request', 'The shared image action belongs to another upload.');
          return send(response, 200, route === 'revision' ? store.imageRevision(documentId, actor, value) : requestId ? store.commitImage(documentId, actor, value) : store.beginImage(documentId, actor, value));
        }
        throw new RoomError(405, 'method', 'This shared image endpoint does not support that operation.');
      }
      const ownership = /^\/v1\/rooms\/([A-Za-z0-9_-]{16,128})\/comments\/ownership$/.exec(url.pathname);
      if (ownership) {
        if (request.method !== 'GET') throw new RoomError(405, 'method', 'Comment ownership requires GET.');
        const documentId = ownership[1], actor = store.authorize(documentId, bearer(request));
        return send(response, 200, store.commentOwnership(documentId, actor));
      }
      const authors = /^\/v1\/rooms\/([A-Za-z0-9_-]{16,128})\/comments\/authors(?:\/grants\/([A-Za-z0-9_-]{16,128}))?$/.exec(url.pathname);
      if (authors) {
        const [, documentId, requestId] = authors, credential = bearer(request);
        let actor = store.authorize(documentId, credential); store.owner(actor);
        if (request.method === 'GET') return send(response, 200, requestId ? store.recoverCommentAuthor(documentId, actor, requestId) : store.commentAuthors(documentId, actor));
        if (request.method === 'POST' && !requestId) {
          const value = object(await body(request, 4096), ['version', 'authorId', 'memberId', 'step', 'requestId']);
          actor = store.authorize(documentId, credential);
          return send(response, 200, store.assignCommentAuthor(documentId, actor, value));
        }
        throw new RoomError(405, 'method', 'Author grants require GET or POST.');
      }
      const history = /^\/v1\/rooms\/([A-Za-z0-9_-]{16,128})\/comments\/history(?:\/([1-9][0-9]{0,15}))?$/.exec(url.pathname);
      if (history) {
        if (request.method !== 'GET') throw new RoomError(405,'method','Comment history requires GET.');
        const [,documentId,before]=history, actor=store.authorize(documentId,bearer(request));
        return send(response,200,store.commentHistory(documentId,actor,before===undefined?undefined:Number(before)));
      }
      const comments = /^\/v1\/rooms\/([A-Za-z0-9_-]{16,128})\/comments(?:\/(recover))?$/.exec(url.pathname);
      if (comments) {
        if (request.method !== 'POST') throw new RoomError(405, 'method', 'Comment actions and recovery require POST.');
        const [, documentId, recovery] = comments, credential = bearer(request);
        let actor = store.authorize(documentId, credential);
        const value = await body(request, engine.api.COMMENT_REQUEST_LIMIT); actor = store.authorize(documentId, credential);
        if (value?.documentId !== documentId) throw new RoomError(409, 'document', 'The comment request belongs to another room.');
        return send(response, 200, store.comment(actor, value, !!recovery));
      }
      const match = /^\/v1\/rooms\/([A-Za-z0-9_-]{16,128})\/(sync|members|presence)(?:\/([A-Za-z0-9_-]{16,128}))?$/.exec(url.pathname);
      if (!match) throw new RoomError(404, 'missing', 'Room endpoint was not found.');
      const [, documentId, route, memberId] = match, credential = bearer(request);
      let actor = store.authorize(documentId, credential);
      if (route === 'presence' && !memberId && request.method === 'POST') {
        const value = await body(request, 64 * 1024); actor = store.authorize(documentId, credential);
        if (value?.documentId !== documentId) throw new RoomError(409, 'document', 'The presence request belongs to a different room.');
        return send(response, 200, presence.exchange(actor, value));
      }
      if (route === 'sync' && !memberId && request.method === 'POST') {
        const value = await body(request); actor = store.authorize(documentId, credential);
        if (value?.documentId !== documentId) throw new RoomError(409, 'document', 'The request belongs to a different shared document.');
        return send(response, 200, store.exchange(actor, value));
      }
      if (route === 'members') {
        store.owner(actor);
        if (request.method === 'GET' && !memberId) return send(response, 200, { version: 1, documentId, members: store.members(documentId, actor) });
        if (request.method === 'POST' && !memberId) {
          const value = object(await body(request), ['version', 'name', 'role', 'requestId']); actor = store.authorize(documentId, credential);
          return send(response, 201, { version: 1, documentId, ...store.invite(documentId, actor, value.name, value.role, value.requestId) });
        }
        if (request.method === 'PATCH' && memberId) {
          const value = object(await body(request), ['version', 'role']); actor = store.authorize(documentId, credential);
          store.changeMember(documentId, actor, memberId, value.role); return send(response, 200, { version: 1, documentId });
        }
        if (request.method === 'DELETE' && memberId) { store.changeMember(documentId, actor, memberId, null); return send(response, 200, { version: 1, documentId }); }
      }
      throw new RoomError(405, 'method', 'This room endpoint does not support that operation.');
    } catch (error) {
      if (!response.destroyed) send(response, error instanceof RoomError ? error.status : 500, { version: 1, error: error instanceof RoomError ? error.code : 'storage', message: error instanceof RoomError ? error.message : 'The room operation failed. The last accepted checkpoint was preserved.' });
    }
  };
  const server = createServer(handle);
  server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5000;
  return {
    server, store, presence, engine, handle,
    listen(port = 0, host = '127.0.0.1') {
      if (host !== '127.0.0.1' && host !== '::1') throw new Error('Bind the room service to loopback and use a TLS reverse proxy for remote access.');
      return new Promise((resolve, reject) => { const failure = error => reject(error); server.once('error', failure); server.listen(port, host, () => { server.off('error', failure); const address = server.address(); resolve(`http://${host === '::1' ? '[::1]' : host}:${address.port}`); }); });
    },
    async close() {
      if (closed) return; closed = true;
      if (server.listening) await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
      presence.close(); store.close(); rates.clear();
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.XDESIGN_ROOM_DATABASE) throw new Error('Set XDESIGN_ROOM_DATABASE to a dedicated room database path. The Orion application database is not supported.');
  const relay = await createRoomRelay({ database: process.env.XDESIGN_ROOM_DATABASE, adminSecret: process.env.XDESIGN_ROOM_ADMIN_SECRET, grantSecret: process.env.XDESIGN_ROOM_GRANT_SECRET });
  const port = process.env.XDESIGN_ROOM_PORT ? Number(process.env.XDESIGN_ROOM_PORT) : 4787;
  if (!Number.isInteger(port) || port < 1 || port > 65535) { await relay.close(); throw new Error('Invalid room service port.'); }
  try { console.log(`XDesign room service: ${await relay.listen(port)}`); }
  catch (error) { await relay.close(); throw error; }
  const stop = () => { void relay.close().then(() => process.exit(0), () => process.exit(1)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
