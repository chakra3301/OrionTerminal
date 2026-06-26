import { useState } from "react";
import { Check, Eye, EyeOff, Lock, ShieldCheck, ShieldOff } from "lucide-react";
import { useAuth } from "./authStore";
import { useControlPanel } from "@/store/controlPanelStore";
import { toast } from "@/store/toastStore";
import "./auth.css";

const MIN_PW = 4;

/** Settings → Account. The opt-in "Enable sign-in" for existing (accountless)
 * installs, plus management once an account exists. Lives here so the
 * data-rich install is never gated until the owner asks for it. */
export function AccountSection() {
  const hasAccount = useAuth((s) => s.hasAccount);
  return hasAccount ? <ManageAccount /> : <EnableSignIn />;
}

function EnableSignIn() {
  const createAccount = useAuth((s) => s.createAccount);
  const busy = useAuth((s) => s.busy);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!username.trim()) return setErr("Pick a username.");
    if (password.length < MIN_PW)
      return setErr(`Password needs at least ${MIN_PW} characters.`);
    if (password !== confirm) return setErr("Passwords don't match.");
    try {
      await createAccount(username, password, displayName);
      toast.success("Sign-in enabled");
    } catch {
      setErr("Couldn't enable sign-in.");
    }
  };

  return (
    <>
      <h2 className="ot-settings-h2">Sign-in</h2>
      <p className="ot-settings-p">
        Optional. Add a username and password to lock Orion Terminal behind a
        sign-in screen on launch. This is a privacy gate, not disk encryption —
        and forgetting it never costs you data (there's a reset on the lock
        screen that keeps everything).
      </p>
      <div className="ot-settings-status">
        <span className="ot-settings-dot" aria-hidden />
        <span>sign-in disabled</span>
      </div>

      <label className="ot-auth-field" style={{ marginTop: 12 }}>
        <span>Display name</span>
        <input
          type="text"
          value={displayName}
          placeholder="What should I call you?"
          spellCheck={false}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <label className="ot-auth-field" style={{ marginTop: 10 }}>
        <span>Username</span>
        <input
          type="text"
          value={username}
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <div className="ot-auth-row" style={{ marginTop: 10 }}>
        <label className="ot-auth-field">
          <span>Password</span>
          <div className="ot-auth-input">
            <input
              type={reveal ? "text" : "password"}
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="ot-auth-reveal"
              onClick={() => setReveal((r) => !r)}
              tabIndex={-1}
            >
              {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </label>
        <label className="ot-auth-field">
          <span>Confirm</span>
          <input
            type={reveal ? "text" : "password"}
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
      </div>

      {err && <div className="ot-auth-error" style={{ marginTop: 12 }}>{err}</div>}

      <div className="ot-settings-input-row" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="ot-settings-btn primary"
          disabled={busy || !username.trim() || !password}
          onClick={() => void submit()}
        >
          <ShieldCheck size={12} /> Enable sign-in
        </button>
      </div>
    </>
  );
}

function ManageAccount() {
  const displayName = useAuth((s) => s.displayName);
  const username = useAuth((s) => s.username);
  const busy = useAuth((s) => s.busy);
  const changePassword = useAuth((s) => s.changePassword);
  const resetAuth = useAuth((s) => s.resetAuth);
  const lock = useAuth((s) => s.lock);
  const hideCp = useControlPanel((s) => s.hide);

  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  const submitPw = async () => {
    setErr(null);
    if (next.length < MIN_PW)
      return setErr(`New password needs at least ${MIN_PW} characters.`);
    if (next !== confirm) return setErr("New passwords don't match.");
    const ok = await changePassword(current, next);
    if (ok) {
      toast.success("Password changed");
      setChanging(false);
      setCurrent("");
      setNext("");
      setConfirm("");
    } else {
      setErr(useAuth.getState().error ?? "Couldn't change the password.");
    }
  };

  return (
    <>
      <h2 className="ot-settings-h2">Account</h2>
      <p className="ot-settings-p">
        Sign-in is enabled. Orion Terminal locks on launch (a valid session
        lasts 7 days).
      </p>
      <div className="ot-settings-status">
        <span className="ot-settings-dot on" aria-hidden />
        <span>
          signed in as {displayName || username}
          {username ? ` · ${username}` : ""}
        </span>
      </div>

      <div className="ot-settings-input-row" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="ot-settings-btn"
          onClick={() => {
            hideCp();
            void lock();
          }}
        >
          <Lock size={12} /> Lock now
        </button>
        {!changing && (
          <button
            type="button"
            className="ot-settings-btn primary"
            onClick={() => {
              setChanging(true);
              setErr(null);
            }}
          >
            Change password
          </button>
        )}
      </div>

      {changing && (
        <div style={{ marginTop: 14 }}>
          <label className="ot-auth-field">
            <span>Current password</span>
            <div className="ot-auth-input">
              <input
                type={reveal ? "text" : "password"}
                value={current}
                autoComplete="current-password"
                onChange={(e) => setCurrent(e.target.value)}
              />
              <button
                type="button"
                className="ot-auth-reveal"
                onClick={() => setReveal((r) => !r)}
                tabIndex={-1}
              >
                {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </label>
          <div className="ot-auth-row" style={{ marginTop: 10 }}>
            <label className="ot-auth-field">
              <span>New password</span>
              <input
                type={reveal ? "text" : "password"}
                value={next}
                autoComplete="new-password"
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <label className="ot-auth-field">
              <span>Confirm</span>
              <input
                type={reveal ? "text" : "password"}
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          </div>
          {err && <div className="ot-auth-error" style={{ marginTop: 12 }}>{err}</div>}
          <div className="ot-settings-input-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="ot-settings-btn primary"
              disabled={busy || !current || !next}
              onClick={() => void submitPw()}
            >
              <Check size={12} /> Save password
            </button>
            <button
              type="button"
              className="ot-settings-btn"
              onClick={() => {
                setChanging(false);
                setErr(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 22,
          paddingTop: 16,
          borderTop: "1px solid var(--glass-border, rgba(160,220,200,0.08))",
        }}
      >
        {confirmingDisable ? (
          <div className="ot-auth-reset-confirm" style={{ alignItems: "flex-start" }}>
            <span>
              Turn sign-in off and remove the password? Your notes, files and
              designs are kept — only the credential is deleted.
            </span>
            <div className="ot-auth-reset-actions">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  void resetAuth();
                  toast.success("Sign-in disabled");
                  setConfirmingDisable(false);
                }}
              >
                Disable sign-in
              </button>
              <button type="button" onClick={() => setConfirmingDisable(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="ot-settings-btn danger"
            onClick={() => setConfirmingDisable(true)}
          >
            <ShieldOff size={12} /> Disable sign-in
          </button>
        )}
      </div>
    </>
  );
}
