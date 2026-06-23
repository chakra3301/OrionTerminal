import { useEffect, useState } from "react";
import { ulid } from "ulid";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RefreshCw, CheckCircle2, LogIn, Download, ImageIcon } from "lucide-react";
import { useProvidersStore } from "@/store/providersStore";
import { ipc } from "@/lib/ipc";
import type { Provider, ProviderKind } from "@/features/agents/agentTypes";
import {
  isImageProvider,
  defaultImageModel,
  getImageModelOverride,
  setImageModelOverride,
} from "@/apps/xdesign/imageGen";
import {
  PROVIDER_PRESETS,
  requiresBaseUrl,
  usesOAuth,
  validateProviderDraft,
} from "@/features/agents/providerDraft";

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
                {p.kind === "nous_oauth" && <NousProviderStatus keyRef={p.keyRef} />}
                {isImageProvider(p) && <ImageModelField provider={p} />}
              </div>
              {isImageProvider(p) && (
                <span className="cp-badge live" title="Usable by XDesign 🖼️ Generate image">
                  <ImageIcon size={12} /> image
                </span>
              )}
              {p.builtin
                ? <span className="cp-badge live">built-in</span>
                : <span className="cp-badge wait">chat ready</span>}
              {!p.builtin && <button className="cp-link-danger" onClick={() => {
                if (p.kind === "nous_oauth" && p.keyRef) void ipc.nousOauthClear(p.keyRef);
                void remove(p.id);
              }}>Remove</button>}
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
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (label: string) => {
    const p = PROVIDER_PRESETS.find((x) => x.label === label);
    if (!p) return;
    setKind(p.kind);
    setBaseUrl(p.baseUrl);
    if (!name.trim()) setName(p.label);
    if (!models.trim()) setModels(p.exampleModel);
    setError(null);
  };

  // For OAuth providers the keyRef is created up-front so the device-code flow
  // can store the refresh token against it before the provider is saved.
  const [oauthRef, setOauthRef] = useState("");

  const submit = async () => {
    const err = validateProviderDraft({ name, kind, baseUrl });
    if (err) { setError(err); return; }
    if (usesOAuth(kind) && !oauthRef) {
      setError("Connect with Nous Portal first.");
      return;
    }
    const id = ulid();
    let keyRef = oauthRef;
    if (!usesOAuth(kind)) {
      keyRef = key.trim() ? id : "";
      if (keyRef) await ipc.providerKeySet(keyRef, key.trim());
    }
    await onSave({
      id, name: name.trim(), kind, baseUrl: baseUrl.trim(),
      models: models.split(",").map((m) => m.trim()).filter(Boolean).map((m) => ({ id: m, label: m })),
      keyRef, enabled: true, builtin: false,
    });
    onDone();
  };

  return (
    <div className="cp-form">
      <div className="cp-presets">
        {PROVIDER_PRESETS.map((p) => (
          <button key={p.label} type="button" className="cp-chip" onClick={() => applyPreset(p.label)}>
            {p.label}
          </button>
        ))}
      </div>
      <input className="cp-input" placeholder="Name (e.g. OpenAI)" value={name} onChange={(e) => setName(e.target.value)} />
      {usesOAuth(kind)
        ? <div className="cp-card-sub">Nous Portal (OAuth · subscription)</div>
        : <select className="cp-input" value={kind} onChange={(e) => { setKind(e.target.value as ProviderKind); setError(null); }}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>}
      <input className="cp-input" placeholder={requiresBaseUrl(kind) ? "Base URL (required, e.g. https://integrate.api.nvidia.com/v1)" : "Base URL (optional — defaults to api.openai.com)"} value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setError(null); }} />
      <input className="cp-input" placeholder="Models, comma-separated (e.g. gpt-5, gpt-5-mini)" value={models} onChange={(e) => setModels(e.target.value)} />
      {usesOAuth(kind)
        ? <NousConnect connected={!!oauthRef} onConnected={(ref) => { setOauthRef(ref); setError(null); }} />
        : <input className="cp-input" type="password" placeholder="API key (stored in keychain)" value={key} onChange={(e) => setKey(e.target.value)} />}
      {error && <div className="cp-form-error">{error}</div>}
      <div className="cp-form-actions">
        <button className="cp-btn ghost" onClick={onDone}>Cancel</button>
        <button className="cp-btn" onClick={submit}>Add</button>
      </div>
    </div>
  );
}

function ImageModelField({ provider }: { provider: Provider }) {
  const [val, setVal] = useState(() => getImageModelOverride(provider.id));
  const fallback = defaultImageModel(provider.kind);
  return (
    <div className="cp-cli-status">
      <span className="cp-card-sub">Image model</span>
      <input
        className="cp-input"
        style={{ maxWidth: 240 }}
        placeholder={fallback}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => setImageModelOverride(provider.id, val)}
      />
    </div>
  );
}

function NousProviderStatus({ keyRef }: { keyRef: string }) {
  const [stored, setStored] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"idle" | "waiting">("idle");
  const [userCode, setUserCode] = useState("");
  const [err, setErr] = useState("");
  const check = async () => {
    try { setStored(await ipc.nousOauthStatus(keyRef)); } catch (e) { setStored(false); setErr(String(e)); }
  };
  useEffect(() => { void check(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [keyRef]);

  // Reconnect re-runs the device flow and stores the token under the SAME
  // keyRef the saved provider already references.
  const reconnect = async () => {
    setErr("");
    setPhase("waiting");
    try {
      const d = await ipc.nousDeviceStart();
      setUserCode(d.userCode);
      await openUrl(d.verificationUriComplete);
      await ipc.nousDevicePoll(keyRef, d.deviceCode, d.interval, d.expiresIn);
      await check();
    } catch (e) {
      setErr(String(e));
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div className="cp-cli-status">
      <span className={`cp-badge ${stored ? "live" : "wait"}`}>
        {stored === null ? <RefreshCw size={12} /> : stored ? <CheckCircle2 size={12} /> : <LogIn size={12} />}
        {stored === null ? "checking" : stored ? "connected" : "not connected"}
      </span>
      {stored === false && (
        <button className="cp-link" disabled={phase === "waiting"} onClick={() => void reconnect()}>
          {phase === "waiting" ? "Waiting for approval…" : "Reconnect"}
        </button>
      )}
      {phase === "waiting" && userCode
        ? <span className="cp-card-sub">Approve code <strong>{userCode}</strong> in your browser</span>
        : <span className="cp-card-sub">keyRef {keyRef ? keyRef.slice(0, 8) : "(none)"}</span>}
      {err && <span className="cp-form-error">{err}</span>}
    </div>
  );
}

function NousConnect({ connected, onConnected }: { connected: boolean; onConnected: (keyRef: string) => void }) {
  const [phase, setPhase] = useState<"idle" | "waiting" | "error">("idle");
  const [userCode, setUserCode] = useState("");
  const [err, setErr] = useState("");

  const connect = async () => {
    setErr("");
    setPhase("waiting");
    const keyRef = ulid();
    try {
      const d = await ipc.nousDeviceStart();
      setUserCode(d.userCode);
      await openUrl(d.verificationUriComplete);
      await ipc.nousDevicePoll(keyRef, d.deviceCode, d.interval, d.expiresIn);
      onConnected(keyRef);
      setPhase("idle");
    } catch (e) {
      setErr(String(e));
      setPhase("error");
    }
  };

  if (connected) {
    return (
      <span className="cp-badge live">
        <CheckCircle2 size={12} /> connected to Nous Portal
      </span>
    );
  }
  return (
    <div className="cp-cli-status">
      <button className="cp-btn" disabled={phase === "waiting"} onClick={() => void connect()}>
        <LogIn size={13} /> {phase === "waiting" ? "Waiting for approval…" : "Connect with Nous Portal"}
      </button>
      {phase === "waiting" && userCode && (
        <span className="cp-card-sub">Approve code <strong>{userCode}</strong> in your browser</span>
      )}
      {phase === "error" && <span className="cp-form-error">{err}</span>}
    </div>
  );
}
