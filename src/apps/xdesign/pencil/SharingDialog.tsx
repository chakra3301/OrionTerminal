import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { useDesignDialog } from '../useDesignDialog';
import { CanvasRoomSession, joinSharedRoom, prepareSharedRoom, type RoomUiState } from './roomSession';
import type { RoomGrant, RoomMember } from './nativeRoomTransport';
import { forgetRoomGrant, loadRoomGrants, type PendingRoomInvitation } from './roomGrants';
import { RoomAuthorsPanel } from './RoomAuthorsPanel';
import { usePencilWorkspace } from './runtime';

function connectionLabel(state: RoomUiState | null): string {
  if (state?.recovery) return state.recovery === 'local' ? 'Creating local copy…' : 'Opening shared version…';
  if (state?.opening) return 'Connecting…'; const connection = state?.connection;
  if (!connection) return 'Local editing';
  if (connection.phase === 'readonly') return 'Connected as viewer';
  if (connection.phase === 'online') return connection.unsent ? 'Saving changes…' : 'All changes shared';
  if (connection.phase === 'disconnected') return 'Disconnected';
  if (connection.phase === 'retrying') return 'Reconnecting…';
  if (connection.phase === 'error') return 'Connection needs attention';
  return connection.phase === 'closed' ? 'Disconnected' : 'Synchronizing…';
}
export function SharingDialog({ session, close }: { session: CanvasRoomSession | null; close: () => void }) {
  const [state, setState] = useState<RoomUiState | null>(session?.snapshot ?? null), [tab, setTab] = useState<'connection' | 'join' | 'create'>(session ? 'connection' : 'create');
  const [server, setServer] = useState(session?.snapshot.preference?.serverUrl ?? ''), [documentId, setDocumentId] = useState(''), [projectName, setProjectName] = useState('Shared design'), [secret, setSecret] = useState('');
  const [members, setMembers] = useState<RoomMember[]>([]), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const [ownerName, setOwnerName] = useState(''), [memberName, setMemberName] = useState(''), [access, setAccess] = useState<'editor' | 'viewer'>('editor');
  const [invitations, setInvitations] = useState<PendingRoomInvitation[]>([]), [handoff, setHandoff] = useState<{ pending: PendingRoomInvitation; grant: RoomGrant; copied: boolean } | null>(null);
  const readOnly = usePencilWorkspace(value => value.readOnly);
  const alive = useRef(true), work = useRef<AbortController | null>(null), dialog = useDesignDialog<HTMLDivElement>(close, pending);
  useEffect(() => { alive.current = true; return () => { alive.current = false; work.current?.abort(); }; }, []);
  useEffect(() => { setState(session?.snapshot ?? null); setMembers([]); return session?.subscribe(setState); }, [session]);
  const refreshInvitations = async () => { if (!session) return; const grants = await loadRoomGrants(session.projectId); if (alive.current) setInvitations(grants.filter((grant): grant is PendingRoomInvitation => grant.kind === 'invite')); };
  useEffect(() => { setHandoff(null); setInvitations([]); void refreshInvitations().catch(error => { if (alive.current) setError(error instanceof Error ? error.message : 'Pending invitations could not load.'); }); }, [session]);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (work.current) return; const controller = new AbortController(); work.current = controller; setPending(true); setError('');
    try { await action(controller.signal); if (alive.current) setSecret(''); }
    catch (error) { if (alive.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : 'The room operation failed.'); }
    finally { if (work.current === controller) work.current = null; if (alive.current) setPending(false); }
  };
  const owner = state?.connection?.actor?.role === 'owner';
  const creation = state?.creation;
  const recovery = !creation && state?.connection?.unsent && ['error','readonly','disconnected'].includes(state.connection.phase);
  const changeTab = (tab: 'connection' | 'join' | 'create') => { setTab(tab); setError(''); setSecret(''); if (tab === 'connection') setServer(session?.snapshot.creation?.serverUrl ?? session?.snapshot.preference?.serverUrl ?? ''); };
  return <div ref={dialog} className="xd-pencil-dialog xd-sharing-dialog" role="dialog" aria-modal="true" aria-label="Share design"><form onSubmit={event => {
    event.preventDefault(); void run(async signal => {
      if (tab === 'join') await joinSharedRoom(server, documentId, projectName, secret, signal);
      else if (tab === 'create') await prepareSharedRoom(server, projectName, ownerName, signal);
      else if (session && creation) { await session.publishCreation(secret, signal); if (!signal.aborted) await session.connect(creation.serverUrl); }
      else if (session) await session.connect(server, secret);
    });
  }}>
    <header><strong>Share design</strong><button type="button" disabled={pending} onClick={close}>Close</button></header>
    <nav aria-label="Sharing options">{session && <button type="button" aria-pressed={tab === 'connection'} disabled={pending} onClick={() => changeTab('connection')}>This project</button>}<button type="button" aria-pressed={tab === 'create'} disabled={pending || readOnly} onClick={() => changeTab('create')}>Create room</button><button type="button" aria-pressed={tab === 'join'} disabled={pending} onClick={() => changeTab('join')}>Join room</button></nav>
    {!isTauri() && <p role="status">Open XDesign in Orion Terminal desktop to connect a shared room.</p>}
    <fieldset disabled={pending || !isTauri()}>
      {tab === 'connection' ? <><p role="status">{creation ? `Ready to publish ${creation.name}` : connectionLabel(state)}{state?.connection?.actor ? ` · ${state.connection.actor.name}` : ''}</p><label>Document ID<input aria-label="Shared document ID" readOnly value={session?.documentId ?? ''}/></label>{creation && <p>This saved copy stays read-only until its owner credential is stored. Publish or recover the same request after reopening.</p>}</> : <><p>{tab === 'create' ? 'Save a shared copy of this design. The original project is saved first. Publish the copy in the next step.' : 'Open a shared design as a new project. Your current project is saved first.'}</p><label>Project name<input aria-label="Shared project name" value={projectName} maxLength={128} onChange={event => setProjectName(event.target.value)}/></label>{tab === 'create' ? <label>Your display name<input aria-label="Room owner name" value={ownerName} maxLength={128} onChange={event => setOwnerName(event.target.value)}/></label> : <label>Document ID<input aria-label="Room document ID" value={documentId} autoComplete="off" spellCheck={false} onChange={event => setDocumentId(event.target.value)}/></label>}</>}
      <label>Room server<input aria-label="Room server" type="url" placeholder="https://design.example.com" value={creation && tab === 'connection' ? creation.serverUrl : server} readOnly={!!creation && tab === 'connection'} autoComplete="off" spellCheck={false} onChange={event => setServer(event.target.value)}/></label>
      {tab !== 'create' && <label>{creation && tab === 'connection' ? 'Administrator credential' : 'Membership credential'}<input aria-label={creation && tab === 'connection' ? 'Room administrator credential' : 'Room membership credential'} type="password" value={secret} autoComplete="off" spellCheck={false} placeholder="Leave empty to use the saved credential" onChange={event => setSecret(event.target.value)}/></label>}
      <p className="xd-sharing-help">{tab === 'create' || creation && tab === 'connection' ? 'Use a room service you administer. Administrator and membership credentials have separate OS keychain scopes.' : 'Credentials stay in your OS keychain. Connect to the server supplied by the room owner.'}</p>
      <div className="xd-pencil-buttons"><button type="submit" disabled={!(creation && tab === 'connection' ? creation.serverUrl : server) || tab === 'join' && (!documentId || !projectName.trim()) || tab === 'create' && (!projectName.trim() || !ownerName.trim() || readOnly)}>{pending ? 'Working…' : tab === 'create' ? 'Create shared copy' : tab === 'join' ? 'Join room' : creation ? 'Publish or recover room' : 'Connect'}</button>{tab === 'connection' && session && !creation && <><button type="button" disabled={!state?.connection} onClick={() => { try { session.disconnect(); } catch (error) { setError(String(error)); } }}>Disconnect</button><button type="button" disabled={!state?.connection} onClick={() => { try { session.retry(); } catch (error) { setError(String(error)); } }}>Retry connection</button></>}</div>
    </fieldset>
    {tab === 'connection' && owner && session && <section aria-label="Room members"><header><strong>Members</strong><button type="button" disabled={pending} onClick={() => void run(async () => { const result = await session.members(); if (alive.current) setMembers(result); })}>Refresh members</button></header>
      <fieldset disabled={pending}><legend>Invite a member</legend><label>Display name<input aria-label="Invitation member name" value={memberName} maxLength={128} onChange={event => setMemberName(event.target.value)}/></label><label>Access<select aria-label="Invitation access" value={access} onChange={event => setAccess(event.target.value as 'editor' | 'viewer')}><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label><button type="button" disabled={!memberName.trim() || !!handoff || invitations.some(invitation => invitation.name === memberName.trim() && invitation.role === access && invitation.documentId === session.documentId && invitation.serverUrl === state?.preference?.serverUrl)} onClick={() => void run(async signal => { try { const result = await session.invite(memberName, access, signal); if (alive.current) setHandoff({ ...result, copied: false }); } finally { await refreshInvitations(); } })}>Create invitation</button></fieldset>
      {members.map(member => <div className="xd-sharing-member" key={member.id}><span>{member.name}<small>{member.revoked ? 'Revoked' : member.role}</small></span>{member.role !== 'owner' && <><select aria-label={`Access for ${member.name}`} disabled={pending || member.revoked} value={member.role} onChange={event => { const role = event.target.value as 'editor' | 'viewer'; void run(async () => { const result = await session.changeMember(member.id, role); if (alive.current) setMembers(result); }); }}><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button type="button" disabled={pending || member.revoked} onClick={() => void run(async () => { const result = await session.revokeMember(member.id); if (alive.current) setMembers(result); })}>Revoke access</button></>}</div>)}
    </section>}
    {tab === 'connection' && session && <RoomAuthorsPanel session={session} owner={owner} pending={pending} run={run}/> }
    {tab === 'connection' && session && invitations.length > 0 && <section aria-label="Pending invitations"><header><strong>Pending invitations</strong></header><p className="xd-sharing-help">Recovery uses the saved request. Dismissal clears this device’s pending handoff; it does not revoke access.</p>{invitations.map(invitation => <div className="xd-sharing-member" key={invitation.requestId}><span>{invitation.name}<small>{invitation.role} · {invitation.serverUrl}</small></span><button type="button" disabled={pending || !owner || !!handoff} aria-label={`Recover invitation for ${invitation.name}`} onClick={() => void run(async signal => { const grant = await session.recoverInvitation(invitation, signal); if (alive.current) setHandoff({ pending: invitation, grant, copied: false }); })}>Recover</button><button type="button" disabled={pending} aria-label={`Dismiss request for ${invitation.name}`} onClick={() => void run(async () => { await forgetRoomGrant(invitation); if (alive.current && handoff?.pending.requestId === invitation.requestId) setHandoff(null); await refreshInvitations(); })}>Dismiss request</button></div>)}</section>}
    {handoff && <section aria-label="Invitation handoff"><strong>Invitation for {handoff.grant.actor.name}</strong><p>Copy this invitation and give it to this member. Anyone with its credential can use its {handoff.grant.actor.role} access.</p><label>Invitation credential<input aria-label="Invitation credential" type="password" readOnly value={handoff.grant.credential} autoComplete="off"/></label><div className="xd-pencil-buttons"><button type="button" disabled={pending} onClick={() => void run(async () => { await navigator.clipboard.writeText(`XDesign room invitation\nRoom server: ${handoff.pending.serverUrl}\nDocument ID: ${handoff.pending.documentId}\nName: ${handoff.grant.actor.name}\nAccess: ${handoff.grant.actor.role}\nMembership credential: ${handoff.grant.credential}`); if (alive.current) setHandoff({ ...handoff, copied: true }); })}>Copy invitation</button><button type="button" disabled={pending || !handoff.copied} onClick={() => void run(async () => { await forgetRoomGrant(handoff.pending); if (alive.current) setHandoff(null); await refreshInvitations(); })}>Done</button></div><p role="status">{handoff.copied ? 'Invitation copied. Choose Done after saving or handing it over.' : 'The pending request stays saved until you finish or dismiss it.'}</p></section>}
    {tab === 'connection' && session && recovery && <section aria-label="Recover local artwork"><strong>Keep your local work</strong><p>Your current project is saved before opening either copy. The original project and its unfinished requests stay available.</p><div className="xd-pencil-buttons"><button type="button" disabled={pending || !isTauri() || state?.opening} onClick={() => void run(async signal => { await session.recoverProject('local',signal); })}>Save local copy</button><button type="button" disabled={pending || !isTauri() || state?.opening || !state?.preference} onClick={() => void run(async signal => { await session.recoverProject('latest',signal); })}>Open latest shared version</button></div><p className="xd-sharing-help">A local copy is editable on this device. The shared version opens in a new project with the server's artwork.</p></section>}
    {(error || state?.error || state?.connection?.error) && <p role="alert">{error || state?.error || state?.connection?.error}</p>}
    {state?.connection?.unsent && <p role="status">Local changes are retained until this membership can upload them.</p>}
    <p className="xd-sharing-help">Design artwork and comments synchronize. Linked PSD/image documents stay on this device.</p>
  </form></div>;
}
export { connectionLabel };
