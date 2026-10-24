import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomCommentHistoryClient, type RoomCommentHistoryState } from './roomCommentHistoryClient';
import type { RoomCommentContext } from './roomCommentClient';
import type { RoomCommentHistoryEntry } from './roomCommentProtocol';
const documentId = 'history_document_001', actor = { id: 'history_member_001', name: 'Reviewer', role: 'viewer' as const };
const entry: RoomCommentHistoryEntry = { id: 201, clientId: 'history_client_001', requestId: 'history_request_001', threadId: 'history_thread', action: 'edit', undone: false, step: 0, revision: 2 };
let client: RoomCommentHistoryClient, state: RoomCommentHistoryState, context: RoomCommentContext | null, current: boolean;
const open = vi.fn(), list = vi.fn(), close = vi.fn(), changes = vi.fn();
const page = (entries = [entry], next: number | null = null) => ({ version: 1, documentId, actor, entries, next });
beforeEach(() => {
  current = true; context = { serverUrl: 'https://rooms.example/', actor, epoch: 1, revision: 1 }; open.mockReset(); list.mockReset(); close.mockReset(); changes.mockReset();
  list.mockResolvedValue(page()); open.mockResolvedValue({ list, dispose: close });
  client = new RoomCommentHistoryClient(documentId, { current: () => current, context: () => context, onState: next => { state = next; changes(next); }, open }); state = client.snapshot;
});
afterEach(() => client.dispose());
it('stays idle until explicitly requested, admits only current member summaries and returns detached state', async () => {
  expect(open).not.toHaveBeenCalled(); expect(state.phase).toBe('idle'); await client.load(); expect(list).toHaveBeenCalledWith(expect.any(AbortSignal),undefined); expect(close).toHaveBeenCalledOnce(); expect(state.entries).toEqual([entry]);
  const copy = client.snapshot; copy.entries[0]!.step = 999; expect(client.snapshot.entries[0]!.step).toBe(0); expect(context!.actor.role).toBe('viewer');
});
it('replaces bounded pages instead of accumulating history and validates cursors before opening a handle', async () => {
  const entries = Array.from({ length: 100 }, (_,index) => ({ ...entry, id: 201-index, requestId: `history_request_${String(index).padStart(3,'0')}` })); list.mockResolvedValueOnce(page(entries,102)); await client.load(); expect(state.next).toBe(102);
  list.mockResolvedValueOnce(page([{ ...entry,id:101 }],null)); await client.load(102); expect(state.entries).toHaveLength(1); expect(state.before).toBe(102); expect(state.next).toBeNull();
  for (const cursor of [0,-1,Number.MAX_SAFE_INTEGER+1,NaN]) await expect(client.load(cursor)).rejects.toThrow('cursor'); expect(open).toHaveBeenCalledTimes(2);
});
it('refuses foreign actors/documents, malformed pages and unknown failures without retaining actionable stale rows', async () => {
  await client.load();
  for (const reply of [{ ...page(),actor:{...actor,id:'foreign_member_001'} }, { ...page(),documentId:'foreign_document_001' }, { ...page(),entries:[entry,entry] }, { ...page(),secret:'no' }]) {
    list.mockResolvedValueOnce(reply); await expect(client.load()).rejects.toThrow(); expect(state.phase).toBe('error'); expect(state.entries).toEqual([]);
  }
  list.mockRejectedValueOnce(new Error('Offline')); await expect(client.load()).rejects.toThrow('Offline'); expect(state.error).toBe('Offline'); await client.load(); expect(state.error).toBeNull(); expect(state.phase).toBe('ready');
});
it('holds one request slot through cancellation and suppresses stale responses when a command invalidates history', async () => {
  let release!: (reply: unknown) => void; list.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); const work = client.load(); await vi.waitFor(() => expect(release).toBeDefined());
  const signal = list.mock.calls[0]![0] as AbortSignal; client.invalidate(); expect(signal.aborted).toBe(true); expect(state.entries).toEqual([]); await expect(client.load()).rejects.toThrow('finish loading');
  release(page()); await expect(work).rejects.toThrow('room changed'); expect(state.phase).toBe('idle'); expect(close).toHaveBeenCalledOnce(); await client.load(); expect(state.phase).toBe('ready');
});
it.each(['server','member','epoch','disconnect'] as const)('clears published history and cancels late work on %s changes', async change => {
  await client.load(); let release!: (reply: unknown) => void; list.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); const work = client.load(); await vi.waitFor(() => expect(release).toBeDefined());
  context = change === 'disconnect' ? null : { ...context!, ...(change === 'server' ? { serverUrl: 'https://other.example/' } : change === 'member' ? { actor:{...actor,id:'foreign_member_001'} } : { epoch:2 }) }; client.refresh(); expect(state.entries).toEqual([]);
  release(page()); await expect(work).rejects.toThrow('room changed'); expect(state.phase).toBe('idle'); expect(close).toHaveBeenCalledTimes(2);
});
it('closes a late-opened transport without reading after the canvas is disposed', async () => {
  let release!: (transport: {list:typeof list;dispose:typeof close}) => void; open.mockImplementationOnce(() => new Promise(resolve => { release=resolve; })); const work=client.load(); client.dispose(); release({list,dispose:close}); await expect(work).rejects.toThrow('room changed'); expect(list).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce(); expect(client.snapshot.phase).toBe('closed');
});
it('preserves the one-request bound through slow disposal and never opens a disconnected or inactive canvas', async () => {
  let release!: () => void; close.mockImplementationOnce(() => new Promise<void>(resolve => { release=resolve; })); const work=client.load(); await vi.waitFor(() => expect(release).toBeDefined()); await expect(client.load()).rejects.toThrow('finish loading'); release(); await work;
  current=false; await expect(client.load()).rejects.toThrow('Connect'); current=true; context=null; client.refresh(); expect(state.entries).toEqual([]); await expect(client.load()).rejects.toThrow('Connect'); expect(open).toHaveBeenCalledOnce();
});
