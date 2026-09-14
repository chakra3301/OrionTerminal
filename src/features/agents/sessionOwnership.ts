import { getAppState, setAppState } from "@/lib/db";
import { serialQueue } from "@/lib/serialQueue";
import { log } from "@/lib/log";

const KEY = "ai.sessionOwners" as const;
const LIMIT = 512;
type Owner = { identity: string; touched: number };
type Saved = { version: 1; owners: Record<string, Owner> };
const owners = new Map<string, Owner>();
const revoked = new Set<string>();
const writeInOrder = serialQueue();
let loaded = false;
let loading: Promise<void> | null = null;

async function load(): Promise<void> {
  if (loaded) return;
  if (!loading) loading = (async () => {
    const saved = await getAppState<Saved>(KEY);
    if (saved?.version === 1 && saved.owners && typeof saved.owners === "object") {
      const entries = Object.entries(saved.owners).filter(([id, entry]) =>
        id.length > 0 && id.length <= 1024 && entry && typeof entry.identity === "string" && entry.identity.length <= 8192 && Number.isFinite(entry.touched),
      ).sort((a, b) => b[1].touched - a[1].touched).slice(0, LIMIT);
      for (const [id, entry] of entries) owners.set(id, entry);
    }
    loaded = true;
  })().finally(() => { loading = null; });
  await loading;
}

export async function hasSessionOwner(sessionId: string, identity: string): Promise<boolean> {
  try { await load(); return !revoked.has(sessionId) && owners.get(sessionId)?.identity === identity; }
  catch (error) {
    log.warn("Session ownership unavailable; starting a fresh connector session", error);
    return false;
  }
}

export async function forgetSessionOwner(sessionId: string): Promise<void> {
  if (!sessionId || sessionId.length > 1024) return;
  revoked.add(sessionId);
  if (revoked.size > LIMIT) revoked.delete(revoked.values().next().value!);
  await load();
  owners.delete(sessionId);
  const snapshot: Saved = { version: 1, owners: Object.fromEntries(owners) };
  await writeInOrder(() => setAppState(KEY, snapshot));
}

export async function forgetSessionOwnersForKind(kind: string): Promise<void> {
  await load();
  for (const [id, owner] of owners) {
    try { if (JSON.parse(owner.identity)?.[1] === kind) owners.delete(id); }
    catch { owners.delete(id); }
  }
  const snapshot: Saved = { version: 1, owners: Object.fromEntries(owners) };
  await writeInOrder(() => setAppState(KEY, snapshot));
}

export async function rememberSessionOwner(sessionId: string, identity: string): Promise<void> {
  if (!sessionId || sessionId.length > 1024) return;
  await load();
  if (revoked.has(sessionId)) return;
  owners.delete(sessionId);
  owners.set(sessionId, { identity, touched: Date.now() });
  if (owners.size > LIMIT) {
    const oldest = [...owners].sort((a, b) => a[1].touched - b[1].touched)[0];
    if (oldest) owners.delete(oldest[0]);
  }
  const snapshot: Saved = { version: 1, owners: Object.fromEntries(owners) };
  await writeInOrder(() => setAppState(KEY, snapshot));
}
