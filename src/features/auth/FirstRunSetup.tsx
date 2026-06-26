import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Sparkles, ArrowRight } from "lucide-react";
import { SplashScreen } from "@/shell/Splash/SplashScreen";
import { useAuth } from "./authStore";
import "./auth.css";

const MIN_PW = 4;

/** First-run account creation, shown only for a truly empty vault. Collects the
 * required minimum (display name + username + password); accent, wallpaper and
 * provider keys stay in Settings. */
export function FirstRunSetup() {
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const createAccount = useAuth((s) => s.createAccount);
  const clearError = useAuth((s) => s.clearError);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalErr(null);
    if (!username.trim()) return setLocalErr("Pick a username.");
    if (password.length < MIN_PW)
      return setLocalErr(`Password needs at least ${MIN_PW} characters.`);
    if (password !== confirm) return setLocalErr("Passwords don't match.");
    await createAccount(username, password, displayName);
  };

  const shownErr = localErr ?? error;

  return (
    <>
      <SplashScreen mode="idle" ready={false} />
      <div className="ot-auth-overlay">
        <form className="ot-auth-card wide" onSubmit={submit}>
          <div className="ot-auth-badge">
            <Sparkles size={18} />
          </div>
          <div className="ot-auth-title">Welcome to Orion Terminal.</div>
          <div className="ot-auth-sub">
            Set up your sign-in. You can change everything later in Settings.
          </div>

          <label className="ot-auth-field">
            <span>Display name</span>
            <input
              ref={nameRef}
              type="text"
              value={displayName}
              placeholder="What should I call you?"
              spellCheck={false}
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (shownErr) {
                  setLocalErr(null);
                  clearError();
                }
              }}
            />
          </label>

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
                if (shownErr) {
                  setLocalErr(null);
                  clearError();
                }
              }}
            />
          </label>

          <div className="ot-auth-row">
            <label className="ot-auth-field">
              <span>Password</span>
              <div className="ot-auth-input">
                <input
                  type={reveal ? "text" : "password"}
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (shownErr) {
                      setLocalErr(null);
                      clearError();
                    }
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
            <label className="ot-auth-field">
              <span>Confirm</span>
              <input
                type={reveal ? "text" : "password"}
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => {
                  setConfirm(e.target.value);
                  if (shownErr) {
                    setLocalErr(null);
                    clearError();
                  }
                }}
              />
            </label>
          </div>

          {shownErr && <div className="ot-auth-error">{shownErr}</div>}

          <button
            type="submit"
            className="ot-auth-submit"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? "Setting up…" : "Enter Orion Terminal"}
            <ArrowRight size={14} />
          </button>
          <div className="ot-auth-fineprint">
            Local only. The password protects this workstation — it isn't disk
            encryption, and it never leaves this machine.
          </div>
        </form>
      </div>
    </>
  );
}
