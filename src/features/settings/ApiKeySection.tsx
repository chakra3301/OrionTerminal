import { useEffect, useState } from "react";
import { Check, Trash2, Eye, EyeOff, ExternalLink } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

// ─────────────────────────────────────────────────────────────
// API key
// ─────────────────────────────────────────────────────────────

export function APIKeySection() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setMsg(null);
    ipc
      .apiKeyStatus()
      .then(setHasKey)
      .catch((e) => {
        setHasKey(false);
        setMsg(String(e));
      });
  }, []);

  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await ipc.apiKeySet(draft.trim());
      setHasKey(true);
      setDraft("");
      setMsg("Saved to keychain.");
    } catch (e) {
      log.error("api key save failed", e);
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await ipc.apiKeyClear();
      setHasKey(false);
      setMsg("Cleared.");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="ot-settings-h2">Anthropic API key</h2>
      <p className="ot-settings-p">
        Used for inline edits (⌘K with a selection), Tab completion and other
        direct Anthropic API features. Chats, Learn and FX use the AI chosen in
        Providers or each app's model picker; subscriptions don't use this key.
      </p>
      <div className="ot-settings-status">
        <span
          className={`ot-settings-dot${hasKey ? " on" : ""}`}
          aria-hidden
        />
        <span>
          {hasKey === null
            ? "checking…"
            : hasKey
              ? "key configured"
              : "no key set"}
        </span>
      </div>

      <div className="ot-settings-input-row">
        <div className="ot-settings-input">
          <input
            type={reveal ? "text" : "password"}
            placeholder={hasKey ? "•••••••• (key set)" : "sk-ant-…"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
          <button
            type="button"
            className="icon-btn-sm"
            onClick={() => setReveal((r) => !r)}
            title={reveal ? "Hide" : "Show"}
          >
            {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <button
          type="button"
          className="ot-settings-btn primary"
          disabled={busy || !draft.trim()}
          onClick={() => void save()}
        >
          <Check size={12} /> Save
        </button>
        {hasKey && (
          <button
            type="button"
            className="ot-settings-btn danger"
            disabled={busy}
            onClick={() => void clear()}
          >
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>
      {msg && <div className="ot-settings-msg">{msg}</div>}

      <p className="ot-settings-help">
        Get a key from{" "}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer"
        >
          console.anthropic.com <ExternalLink size={10} />
        </a>
        . It's stored in your macOS Keychain and never leaves this Mac.
      </p>

      <GithubTokenField />
    </>
  );
}

function GithubTokenField() {
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    ipc
      .githubTokenStatus()
      .then(setHasToken)
      .catch(() => setHasToken(false));
  }, []);

  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await ipc.githubTokenSet(draft.trim());
      setHasToken(true);
      setDraft("");
      setMsg("Saved to keychain.");
    } catch (e) {
      log.error("github token save failed", e);
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await ipc.githubTokenClear();
      setHasToken(false);
      setMsg("Cleared.");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="ot-settings-h2" style={{ marginTop: 28 }}>
        GitHub token (RepoLens)
      </h2>
      <p className="ot-settings-p">
        Optional. RepoLens scans GitHub's public API unauthenticated (60
        requests/hour). A token raises that to 5000/hour — useful when scanning
        many repos. Read-only / no-scope is enough.
      </p>
      <div className="ot-settings-status">
        <span className={`ot-settings-dot${hasToken ? " on" : ""}`} aria-hidden />
        <span>
          {hasToken === null ? "checking…" : hasToken ? "token configured" : "no token set"}
        </span>
      </div>

      <div className="ot-settings-input-row">
        <div className="ot-settings-input">
          <input
            type={reveal ? "text" : "password"}
            placeholder={hasToken ? "•••••••• (token set)" : "ghp_…"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
          <button
            type="button"
            className="icon-btn-sm"
            onClick={() => setReveal((r) => !r)}
            title={reveal ? "Hide" : "Show"}
          >
            {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <button
          type="button"
          className="ot-settings-btn primary"
          disabled={busy || !draft.trim()}
          onClick={() => void save()}
        >
          <Check size={12} /> Save
        </button>
        {hasToken && (
          <button
            type="button"
            className="ot-settings-btn danger"
            disabled={busy}
            onClick={() => void clear()}
          >
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>
      {msg && <div className="ot-settings-msg">{msg}</div>}

      <p className="ot-settings-help">
        Create one at{" "}
        <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
          github.com/settings/tokens <ExternalLink size={10} />
        </a>
        . Stored in the same OS keychain as the API key above.
      </p>
    </>
  );
}
