import { useEffect, useRef, useState } from "react";
import { Lock, Eye, EyeOff, LogIn, ShieldAlert } from "lucide-react";
import { SplashScreen } from "@/shell/Splash/SplashScreen";
import { useAuth } from "./authStore";
import "./auth.css";

/** Soft-lock login. The calmer idle energy core hovers behind. Forgetting the
 * password is non-fatal: "Reset" wipes only the credential and reopens the
 * vault unlocked (the data is never touched). */
export function LockScreen() {
  const storedUsername = useAuth((s) => s.username);
  const displayName = useAuth((s) => s.displayName);
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const unlock = useAuth((s) => s.unlock);
  const resetAuth = useAuth((s) => s.resetAuth);
  const clearError = useAuth((s) => s.clearError);

  const [username, setUsername] = useState(storedUsername ?? "");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(true);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => pwRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    await unlock(username, password, remember);
  };

  return (
    <>
      <SplashScreen mode="idle" ready={false} />
      <div className="ot-auth-overlay">
        <form className="ot-auth-card" onSubmit={submit}>
          <div className="ot-auth-badge">
            <Lock size={18} />
          </div>
          <div className="ot-auth-title">
            {displayName ? `Welcome back, ${displayName}.` : "Welcome back."}
          </div>
          <div className="ot-auth-sub">Orion Terminal is locked.</div>

          <label className="ot-auth-field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              autoCapitalize="off"
              autoComplete="username"
              spellCheck={false}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) clearError();
              }}
            />
          </label>

          <label className="ot-auth-field">
            <span>Password</span>
            <div className="ot-auth-input">
              <input
                ref={pwRef}
                type={reveal ? "text" : "password"}
                value={password}
                autoComplete="current-password"
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) clearError();
                }}
              />
              <button
                type="button"
                className="ot-auth-reveal"
                onClick={() => setReveal((r) => !r)}
                tabIndex={-1}
                aria-label={reveal ? "Hide password" : "Show password"}
              >
                {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </label>

          <label className="ot-auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Keep me signed in for 7 days</span>
          </label>

          {error && <div className="ot-auth-error">{error}</div>}

          <button
            type="submit"
            className="ot-auth-submit"
            disabled={busy || !password}
          >
            <LogIn size={14} />
            {busy ? "Unlocking…" : "Unlock"}
          </button>

          <div className="ot-auth-reset">
            {confirmingReset ? (
              <div className="ot-auth-reset-confirm">
                <ShieldAlert size={13} />
                <span>
                  Reset removes the password only — your notes, files and
                  designs are kept. Continue?
                </span>
                <div className="ot-auth-reset-actions">
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void resetAuth()}
                  >
                    Reset &amp; open
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingReset(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="ot-auth-reset-link"
                onClick={() => setConfirmingReset(true)}
              >
                Forgot password? Reset (keeps your data)
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
