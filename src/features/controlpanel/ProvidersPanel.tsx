import { useEffect, useState } from "react";
import { ulid } from "ulid";
import { RefreshCw, CheckCircle2, LogIn, Download } from "lucide-react";
import { useProvidersStore } from "@/store/providersStore";
import { ipc } from "@/lib/ipc";
import type { Provider, ProviderKind } from "@/features/agents/agentTypes";

const KINDS: ProviderKind[] = ["openai", "google", "openai_compat", "custom"];

type CliStat = { installed: boolean; loggedIn: boolean; version: string | null; detail: string };

function CliEngineStatus({ engine }: { engine: "codex_cli" | "gemini_cli" }) {
  const [stat, setStat] = useState<CliStat | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      setStat(await ipc.cliStatus(engine));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);
  const Icon = !stat
    ? RefreshCw
    : !stat.installed
      ? Download
      : !stat.loggedIn
        ? LogIn
        : CheckCircle2;
  const cls = stat?.loggedIn ? "live" : "wait";
  const label = !stat
    ? "checking"
    : stat.loggedIn
      ? "ready"
      : stat.installed
        ? "login needed"
        : "not found";
  return (
    <div className="cp-cli-status">
      <span className={`cp-badge ${cls}`}>
        <Icon size={12} /> {label}
      </span>
      <span className="cp-card-sub">{stat?.detail ?? ""}</span>
      <button className="cp-link" disabled={busy} onClick={() => void check()}>
        Re-check
      </button>
    </div>
  );
}

export function ProvidersPanel() {
  const providers = useProvidersStore((s) => s.providers);
  const save = useProvidersStore((s) => s.save);
  const remove = useProvidersStore((s) => s.remove);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="cp-list">
        {providers.map((p) => {
          const isCli = p.kind === "codex_cli" || p.kind === "gemini_cli";
          return (
            <div key={p.id} className="cp-card">
              <div className="cp-card-main">
                <div className="cp-card-title">{p.name}</div>
                <div className="cp-card-sub">{p.kind}{p.models.length ? ` · ${p.models.length} models` : ""}</div>
                {isCli && <CliEngineStatus engine={p.kind as "codex_cli" | "gemini_cli"} />}
              </div>
              {p.builtin
                ? <span className="cp-badge live">built-in</span>
                : <span className="cp-badge wait">chat ready</span>}
              {!p.builtin && <button className="cp-link-danger" onClick={() => remove(p.id)}>Remove</button>}
            </div>
          );
        })}
      </div>
      {adding
        ? <AddProvider onDone={() => setAdding(false)} onSave={save} />
        : <button className="cp-btn" onClick={() => setAdding(true)}>+ Add provider</button>}
    </div>
  );
}

function AddProvider({ onDone, onSave }: { onDone: () => void; onSave: (p: Provider) => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState("");
  const [key, setKey] = useState("");

  const submit = async () => {
    if (!name.trim()) return;
    const id = ulid();
    const keyRef = key.trim() ? id : "";
    if (keyRef) await ipc.providerKeySet(keyRef, key.trim());
    await onSave({
      id, name: name.trim(), kind, baseUrl: baseUrl.trim(),
      models: models.split(",").map((m) => m.trim()).filter(Boolean).map((m) => ({ id: m, label: m })),
      keyRef, enabled: true, builtin: false,
    });
    onDone();
  };

  return (
    <div className="cp-form">
      <input className="cp-input" placeholder="Name (e.g. OpenAI)" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="cp-input" value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <input className="cp-input" placeholder="Base URL (optional)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      <input className="cp-input" placeholder="Models, comma-separated (e.g. gpt-5, gpt-5-mini)" value={models} onChange={(e) => setModels(e.target.value)} />
      <input className="cp-input" type="password" placeholder="API key (stored in keychain)" value={key} onChange={(e) => setKey(e.target.value)} />
      <div className="cp-form-actions">
        <button className="cp-btn ghost" onClick={onDone}>Cancel</button>
        <button className="cp-btn" onClick={submit}>Add</button>
      </div>
    </div>
  );
}
