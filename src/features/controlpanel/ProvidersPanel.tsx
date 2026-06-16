import { useState } from "react";
import { ulid } from "ulid";
import { useProvidersStore } from "@/store/providersStore";
import { ipc } from "@/lib/ipc";
import type { Provider, ProviderKind } from "@/features/agents/agentTypes";

const KINDS: ProviderKind[] = ["openai", "google", "openai_compat", "custom"];

export function ProvidersPanel() {
  const providers = useProvidersStore((s) => s.providers);
  const save = useProvidersStore((s) => s.save);
  const remove = useProvidersStore((s) => s.remove);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="cp-list">
        {providers.map((p) => (
          <div key={p.id} className="cp-card">
            <div className="cp-card-main">
              <div className="cp-card-title">{p.name}</div>
              <div className="cp-card-sub">{p.kind}{p.models.length ? ` · ${p.models.length} models` : ""}</div>
            </div>
            {p.builtin
              ? <span className="cp-badge live">live ✓</span>
              : <span className="cp-badge wait">chat ready · no tools yet</span>}
            {!p.builtin && <button className="cp-link-danger" onClick={() => remove(p.id)}>Remove</button>}
          </div>
        ))}
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
