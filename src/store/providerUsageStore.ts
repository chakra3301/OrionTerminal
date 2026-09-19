import { create } from "zustand";
import { getAppState, setAppState } from "@/lib/db";
import { serialQueue } from "@/lib/serialQueue";
import { log } from "@/lib/log";
import type { Provider } from "@/features/agents/agentTypes";
import { addTokenTotals, count, parseProviderTokens, parseUsageHistory, pruneUsage, type UsageRecord } from "@/features/agents/providerUsage";

const enqueue = serialQueue();
let loadPromise: Promise<void> | null = null;
let writable = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;

type State = {
  records: UsageRecord[];
  active: Record<string, string>;
  since: number;
  limitedUntil: number;
  loaded: boolean;
  saveError: string | null;
  load: () => Promise<void>;
};

export const useProviderUsage = create<State>((set, get) => ({
  records: [], active: {}, since: Date.now(), limitedUntil: 0, loaded: false, saveError: null,
  load: () => {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const saved = parseUsageHistory(await getAppState("provider_usage", true));
        const current = get();
        const merged = new Map(saved.records.map(r => [r.id, r]));
        for (const record of current.records) merged.set(record.id, record);
        const pruned = pruneUsage([...merged.values()], Date.now());
        writable = true;
        set({ records: pruned.records, since: Math.min(saved.since, current.since), limitedUntil: Math.max(saved.limitedUntil, pruned.limitedUntil), loaded: true });
        if (current.records.length) scheduleSave();
      } catch (error) {
        log.warn("Provider usage history unavailable", error);
        set({ loaded: true, saveError: "Saved usage could not be loaded. New readings are session-only; the saved history has not been overwritten." });
      }
    })();
    return loadPromise;
  },
}));

function scheduleSave() {
  if (!writable) return;
  clearTimeout(saveTimer);
  const current = ++revision;
  saveTimer = setTimeout(() => {
    const { records, since, limitedUntil } = useProviderUsage.getState();
    void enqueue(() => setAppState("provider_usage", { version: 1, since, limitedUntil, records })).then(() => {
      if (current === revision) useProviderUsage.setState({ saveError: null });
    }).catch(() => {
      if (current === revision) useProviderUsage.setState({ saveError: "Usage is visible but wasn't saved. The next reading will retry." });
    });
  }, 500);
}

type TrackedRun = { record: UsageRecord; sequence: number; timer?: ReturnType<typeof setTimeout>; retire?: ReturnType<typeof setTimeout> };
const runs = new Map<string, TrackedRun>();
function flush(run: TrackedRun) {
  clearTimeout(run.timer); run.timer = undefined;
  const state = useProviderUsage.getState();
  const pruned = pruneUsage([run.record, ...state.records.filter(r => r.id !== run.record.id)], Date.now());
  useProviderUsage.setState({ records: pruned.records, limitedUntil: Math.max(state.limitedUntil, pruned.limitedUntil) });
  scheduleSave();
}

export function beginProviderUsage(runId: string | null, provider: Provider, model: string): () => void {
  // Claude already has a scoped transcript reader; don't count those tokens twice.
  if (!runId || provider.kind === "anthropic" || provider.id.length > 512) return () => {};
  void useProviderUsage.getState().load();
  const now = Date.now();
  const run: TrackedRun = { sequence: 0, record: { id: runId, providerId: provider.id, kind: provider.kind, model: model.slice(0, 256), startedAt: now, updatedAt: now, endedAt: null, tokens: null } };
  runs.set(runId, run);
  useProviderUsage.setState(s => ({ active: { ...s.active, [runId]: provider.id } }));
  flush(run);
  return () => {
    run.record = { ...run.record, endedAt: Date.now(), updatedAt: Date.now() };
    useProviderUsage.setState(s => { const active = { ...s.active }; delete active[runId]; return { active }; });
    flush(run);
    // Native event delivery can trail invoke completion. The immutable run ID
    // keeps those final counters attached to the original provider, even if
    // the same chat has already switched models or started another turn.
    run.retire = setTimeout(() => { clearTimeout(run.timer); runs.delete(runId); }, 30_000);
  };
}

export function observeProviderUsage(event: unknown): void {
  if (!event || typeof event !== "object") return;
  const e = event as Record<string, unknown>;
  if (typeof e.usage_run_id !== "string") return;
  const run = runs.get(e.usage_run_id);
  if (!run) return;
  const tokens = parseProviderTokens(run.record.kind, e.usage);
  if (!tokens) return;
  if (run.record.kind === "cursor_sdk") {
    const sequence = count(e.usage_sequence);
    if (sequence == null || sequence <= run.sequence) return;
    run.sequence = sequence;
    run.record = { ...run.record, tokens: addTokenTotals(run.record.tokens, tokens), updatedAt: Date.now() };
  } else {
    // Other engines report snapshots, including the final result's repeated
    // totals. Replacing by run ID makes replay and duplicate listeners harmless.
    run.record = { ...run.record, tokens, updatedAt: Date.now() };
  }
  if (run.record.endedAt != null) flush(run);
  else if (!run.timer) run.timer = setTimeout(() => flush(run), 250);
}
