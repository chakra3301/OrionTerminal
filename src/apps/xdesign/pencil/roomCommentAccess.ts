import { validCommentAuthor, type CommentAuthor } from './comments';
import type { RoomUiState } from './roomSession';

export function roomCommentAccess(shared: boolean, room: RoomUiState | null, local: CommentAuthor | null, readOnly: boolean, commands = false) {
  const configured = shared && (!room || !!room.preference || !!room.creation || !!room.connection || !!room.comments?.pending);
  const actor = room?.connection?.actor;
  const author = configured ? actor && validCommentAuthor({ id: actor.id, name: actor.name }) ? { id: actor.id, name: actor.name } : null : local;
  const connected = !!room?.connection && ['online', 'readonly', 'syncing'].includes(room.connection.phase);
  const writable = !!author && (configured ? commands && !room?.opening && !room?.creation && connected : !readOnly);
  const reason = writable ? '' : configured ? room?.creation ? 'Publish the room before adding comments.' : !connected ? 'Connect to the room before adding comments.' : 'Wait for room comments to load.' : 'The comment identity is unavailable.';
  const scope = JSON.stringify([configured ? room?.preference?.documentId ?? 'room' : 'local', room?.preference?.serverUrl, author?.id, author?.name]);
  return { author, configured, writable, reason, scope };
}
