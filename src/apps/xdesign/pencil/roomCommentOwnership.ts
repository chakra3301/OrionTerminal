import type { RoomActor } from './sharedRoomProtocol';

export type CommentAuthorGrants = ReadonlySet<string>;

// Only the service supplies this set, after resolving current room membership.
export function ownsCommentAuthor(authorId: string, actor: RoomActor, grants?: CommentAuthorGrants): boolean {
  return authorId === actor.id || grants?.has(authorId) === true;
}
