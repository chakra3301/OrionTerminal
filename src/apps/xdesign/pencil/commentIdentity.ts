import { ulid } from 'ulid';
import { validCommentAuthor, type CommentAuthor } from './comments';

const KEY = 'orion.xdesign.comment-author';
export function commentIdentity(): CommentAuthor {
  const saved = localStorage.getItem(KEY);
  if (saved !== null) {
    let value: unknown;
    try { if (saved.length > 4096) throw new Error(); value = JSON.parse(saved); } catch { throw new Error('The saved comment identity could not be read.'); }
    if (!validCommentAuthor(value)) throw new Error('The saved comment identity is invalid.');
    return value;
  }
  const author = { id: ulid(), name: 'You' }; localStorage.setItem(KEY, JSON.stringify(author)); return author;
}
export function renameCommentIdentity(author: CommentAuthor, name: string): CommentAuthor {
  const next = { ...author, name: name.trim() };
  if (!validCommentAuthor(next)) throw new Error('Enter a name of 1–128 characters.');
  const current = commentIdentity(); if (current.id !== author.id) throw new Error('The comment identity changed. Reopen Comments before continuing.');
  localStorage.setItem(KEY, JSON.stringify(next)); return next;
}
