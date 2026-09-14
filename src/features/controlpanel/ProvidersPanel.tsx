import { useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RefreshCw, CheckCircle2, LogIn, ImageIcon } from "lucide-react";
import { CliEngineStatus } from "./CliEngineStatus";
import { BackgroundAiSettings } from "./BackgroundAiSettings";
import { ProviderConnectionToggle } from "./ProviderConnectionToggle";
import { useProvidersStore } from "@/store/providersStore";
import { ipc } from "@/lib/ipc";
import { toast } from "@/store/toastStore";
import { confirmAction } from "@/components/ConfirmModal";
import { ModelSelect } from "@/components/ModelSelect";
import type { Provider, ProviderKind } from "@/features/agents/agentTypes";
import {
  isImageProvider,
  defaultImageModelForProvider,
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

export function ProvidersPanel() {
  const providers = useProvidersStore((s) => s.providers);
  const save = useProvidersStore((s) => s.save);
  const remove = useProvidersStore((s) => s.remove);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const removeProvider = async (p: Provider) => {
    if (!await confirmAction({ title: `Remove ${p.name}?`, body: "Chats are kept. Selections using this provider will need a new model. Its unshared saved credential will be removed.", confirmLabel: "Remove", danger: true })) return;
    setRemoving(p.id);
    try {
      await remove(p.id);
      if (p.keyRef && !useProvidersStore.getState().providers.some((other) => other.keyRef === p.keyRef)) {
        if (p.kind === "nous_oauth") await ipc.nousOauthClear(p.keyRef);
        else await ipc.providerKeyClear(p.keyRef);
      }
    } catch (e) { toast.error("Provider removal failed", { body: String(e) }); }
    finally { setRemoving(null); }
  };

  return (
    <div>
      <div className="cp-card">
        <div className="cp-card-main"><div className="cp-card-title">Default AI</div><div className="cp-card-sub">Used by assistants without their own model choice. Connection status is not a live model-access test.</div></div>
        <ModelSelect surface="default" />
      </div>
      <p className="cp-card-sub" style={{ margin: "8px 0 14px" }}>Claude, ChatGPT/Codex and Gemini CLI use their subscription/login accounts. Cursor SDK and API providers use separate credentials/billing; a chat subscription does not automatically cover them.</p>
      <div className="cp-list">
        {providers.map((p) => {
          const isCli = p.kind === "codex_cli" || p.kind === "gemini_cli";
          const isCursor = p.kind === "cursor_sdk";
          return (
            <div key={p.id} className="cp-card">
              <div className="cp-card-main">
                <div className="cp-card-title">{p.name}</div>
                <div className="cp-card-sub">{p.kind}{p.models.length ? ` · ${p.models.length} models` : ""}</div>
                {p.enabled ? <>
                {p.kind === "anthropic" && <CliEngineStatus engine="claude" />}
                {isCli && <CliEngineStatus engine={p.kind as "codex_cli" | "gemini_cli"} />}
                {isCursor && <CursorProviderStatus />}
                {p.kind === "nous_oauth" && <NousProviderStatus keyRef={p.keyRef} />}
                {!p.builtin && !isCli && !isCursor && p.kind !== "nous_oauth" && (
                  <ApiProviderStatus provider={p} onSave={save} />
                )}
                {isImageProvider(p) && <ImageModelField provider={p} />}
                </> : <div className="cp-card-sub" style={{ marginTop: 8 }}><span className="cp-badge wait">Disconnected from Orion</span> Credentials retained. Enable to manage or reuse the account.</div>}
                <ProviderConnectionToggle provider={p} />
              </div>
              {p.enabled && isImageProvider(p) && (
                <span className="cp-badge live" title="Usable by XDesign 🖼️ Generate image">
                  <ImageIcon size={12} /> image
                </span>
              )}
              {isCli || isCursor || p.kind === "nous_oauth" || !p.builtin
                ? null
                : <span className="cp-badge live">built-in</span>}
              {!p.builtin && <button className="cp-link-danger" disabled={removing !== null} onClick={() => void removeProvider(p)}>Remove</button>}
            </div>
          );
        })}
      </div>
      <BackgroundAiSettings />
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
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [id] = useState(ulid);

  const applyPreset = (label: string) => {
    const p = PROVIDER_PRESETS.find((x) => x.label === label);
    if (!p) return;
    setKind(p.kind);
    setBaseUrl(p.baseUrl);
    setName(p.label);
    setModels((p.modelIds ?? [p.exampleModel]).join(", "));
    setKey("");
    setError(null);
  };

  // For OAuth providers the keyRef is created up-front so the device-code flow
  // can store the refresh token against it before the provider is saved.
  const [oauthRef, setOauthRef] = useState("");

  const submit = async () => {
    if (saving.current) return;
    const err = validateProviderDraft({ name, kind, baseUrl });
    if (err) { setError(err); return; }
    const modelIds = models.split(",").map((m) => m.trim()).filter(Boolean);
    if (modelIds.length === 0) {
      setError("Add at least one model id.");
      return;
    }
    if (usesOAuth(kind) && !oauthRef) {
      setError("Connect with Nous Portal first.");
      return;
    }
    if (!usesOAuth(kind) && !key.trim() && !((kind === "openai_compat" || kind === "custom") && isLocalBaseUrl(baseUrl))) {
      setError("API key is required for this provider.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      let keyRef = oauthRef;
      if (!usesOAuth(kind)) {
        keyRef = key.trim() ? id : "";
        if (keyRef) await ipc.providerKeySet(keyRef, key.trim());
      }
      await onSave({
        id, name: name.trim(), kind, baseUrl: baseUrl.trim(),
        models: [...new Set(modelIds)].map((m) => ({ id: m, label: m })),
        keyRef, enabled: true, builtin: false,
      });
      setKey("");
      onDone();
    } catch (e) { setError(String(e)); }
    finally { saving.current = false; setBusy(false); }
  };

  return (
    <fieldset className="cp-form" disabled={busy} style={{ border: 0, minWidth: 0 }}>
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
        <button className="cp-btn" onClick={() => void submit()}>{busy ? "Saving…" : "Add"}</button>
      </div>
    </fieldset>
  );
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

function isLocalProvider(provider: Provider): boolean {
  return (provider.kind === "openai_compat" || provider.kind === "custom") && isLocalBaseUrl(provider.baseUrl);
}

function ApiProviderStatus({ provider, onSave }: { provider: Provider; onSave: (p: Provider) => Promise<void> }) {
  const [keySaved, setKeySaved] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [err, setErr] = useState("");
  const local = isLocalProvider(provider);
  const hasModels = provider.models.length > 0;

  const refresh = async () => {
    setBusy(true);
    setErr("");
    try {
      setKeySaved(provider.keyRef ? await ipc.providerKeyStatus(provider.keyRef) : false);
    } catch (e) {
      setKeySaved(false);
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    setBusy(true);
    setErr("");
    setJustSaved(false);
    try {
      if (!key.trim() && keySaved) {
        if (provider.keyRef) await ipc.providerKeyClear(provider.keyRef);
        await onSave({ ...provider, keyRef: "" });
        setKeySaved(false);
      } else if (key.trim()) {
        const keyRef = provider.keyRef.trim() || provider.id;
        await ipc.providerKeySet(keyRef, key.trim());
        await onSave({ ...provider, keyRef });
        setKey("");
        setKeySaved(true);
        setJustSaved(true);
      } else {
        setErr("Paste an API key first.");
        return;
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (local) {
      setKeySaved(true);
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id, provider.keyRef, provider.baseUrl]);

  const ready = hasModels && (local || keySaved === true);
  const label = !hasModels
    ? "models needed"
    : local
      ? "local"
      : keySaved === null
        ? "checking"
        : keySaved
          ? "key saved"
          : "key needed";

  return (
    <div className="cp-cli-status">
      <span className={`cp-badge ${ready ? "live" : "wait"}`}>
        {keySaved === null && !local ? <RefreshCw size={12} /> : ready ? <CheckCircle2 size={12} /> : <LogIn size={12} />}
        {label}
      </span>
      <span className="cp-card-sub">
        {ready
          ? `${provider.models.length} model${provider.models.length === 1 ? "" : "s"} configured`
          : !hasModels
            ? "Add at least one model id."
            : "Paste and save an API key for this provider."}
      </span>
      {!local && (
        <>
          <input
            className="cp-input"
            type="password"
            placeholder={keySaved ? "API key saved - paste to replace" : "API key"}
            value={key}
            onChange={(e) => { setKey(e.target.value); setJustSaved(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") void saveKey(); }}
          />
          <div className="cp-form-actions" style={{ marginTop: 8 }}>
            <button className="cp-link" disabled={busy} onClick={() => void refresh()}>
              Re-check
            </button>
            <button className="cp-btn" disabled={busy || (!key.trim() && !keySaved)} onClick={() => void saveKey()}>
              {keySaved && !key.trim() ? "Clear key" : "Save key"}
            </button>
          </div>
        </>
      )}
      {justSaved && !err && <span className="cp-card-sub" style={{ color: "var(--neon-green)" }}>Key saved to keychain.</span>}
      {err && <span className="cp-form-error">{err}</span>}
    </div>
  );
}

function ImageModelField({ provider }: { provider: Provider }) {
  const [val, setVal] = useState(() => getImageModelOverride(provider.id));
  const fallback = defaultImageModelForProvider(provider);
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

function CursorProviderStatus() {
  const [stat, setStat] = useState<{ installed: boolean; keySaved: boolean; sdkReady: boolean; ready: boolean; version: string | null; detail: string } | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [err, setErr] = useState("");

  const refresh = async () => {
    setBusy(true);
    try {
      const [status, hasKey] = await Promise.all([
        ipc.cursorStatus(),
        ipc.cursorApiKeyStatus(),
      ]);
      setStat(status);
      setSaved(hasKey);
      if (!hasKey) setJustSaved(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveKey = async () => {
    setErr("");
    setJustSaved(false);
    setBusy(true);
    try {
      if (!key.trim() && saved) {
        await ipc.cursorApiKeyClear();
      } else if (key.trim()) {
        await ipc.cursorApiKeySet(key.trim());
        setJustSaved(true);
      } else {
        setErr("Paste your Cursor API key first.");
        return;
      }
      setKey("");
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const installSdk = async () => {
    if (busy || !await confirmAction({ title: "Install optional Cursor SDK?", body: "Downloads the pinned SDK and dependencies from npm into Orion's application-data directory. The SDK is proprietary and governed by Cursor's terms (cursor.com/terms-of-service), not Orion's Apache license. No API key or paid model request is needed for installation. This may take several minutes.", confirmLabel: "Install SDK" })) return;
    setBusy(true); setErr("");
    try { await ipc.cursorInstallSdk(); await refresh(); }
    catch (error) { setErr(String(error)); }
    finally { setBusy(false); }
  };

  const keySaved = stat?.keySaved ?? saved === true;
  const Icon = !stat ? RefreshCw : stat.ready ? CheckCircle2 : keySaved ? CheckCircle2 : LogIn;
  const cls = stat?.ready ? "live" : keySaved ? "live" : "wait";
  const label = !stat
    ? "checking"
    : stat.ready
      ? "ready"
      : keySaved
        ? "key saved"
        : "key needed";

  return (
    <div className="cp-cli-status">
      <span className={`cp-badge ${cls}`}>
        <Icon size={12} /> {label}
      </span>
      <span className="cp-card-sub">
        {stat?.detail ?? ""}
        {stat?.version ? ` · ${stat.version}` : ""}
      </span>
      <input
        className="cp-input"
        type="password"
        placeholder={keySaved ? "API key saved — paste to replace" : "Cursor API key (cursor.com/dashboard → Integrations)"}
        value={key}
        onChange={(e) => { setKey(e.target.value); setJustSaved(false); }}
        onKeyDown={(e) => { if (e.key === "Enter") void saveKey(); }}
      />
      <div className="cp-form-actions" style={{ marginTop: 8 }}>
        {!stat?.sdkReady && <button type="button" className="cp-btn" disabled={busy} onClick={() => void installSdk()}>Install SDK</button>}
        <button type="button" className="cp-link" disabled={busy} onClick={() => void refresh()}>Re-check</button>
        <button type="button" className="cp-btn" disabled={busy || (!key.trim() && !saved)} onClick={() => void saveKey()}>
          {saved && !key.trim() ? "Clear key" : "Save key"}
        </button>
      </div>
      {justSaved && !err && <span className="cp-card-sub" style={{ color: "var(--neon-green)" }}>Key saved to keychain.</span>}
      {err && <span className="cp-form-error">{err}</span>}
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
