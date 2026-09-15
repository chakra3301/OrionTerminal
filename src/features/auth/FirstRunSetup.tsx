import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ArrowRight, ArrowLeft, SkipForward, LoaderCircle } from "lucide-react";
import { STOCK_WALLPAPER_URL } from "@/store/wallpaperStore";
import { useAuth } from "./authStore";
import { LiquidGlassCard } from "./LiquidGlass";
import "./auth.css";

export function FirstRunSetup() {
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const createAccount = useAuth((s) => s.createAccount);
  const skipSetup = useAuth((s) => s.skipSetup);
  const clearError = useAuth((s) => s.clearError);
  const [step, setStep] = useState<"username" | "password">("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);

  useEffect(() => { inputRef.current?.focus(); }, [step]);
  const clear = () => { setLocalError(null); clearError(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || submitting.current) return;
    clear();
    if (!username.trim()) return setLocalError("Pick a username.");
    if (step === "username") { setStep("password"); return; }
    if (password.length < 4) return setLocalError("Password needs at least 4 characters.");
    submitting.current = true;
    try { await createAccount(username, password, username); }
    catch { /* The store preserves the form and exposes the save error. */ }
    finally { submitting.current = false; }
  };
  const shownError = localError ?? error;
  const fieldName = step === "username" ? "Username" : "Password";
  const submitLabel = step === "username" ? "Next" : "Enter Orion Terminal";

  return (
    <>
      <div className="ot-setup-backdrop" aria-hidden="true" style={{ backgroundImage: `linear-gradient(#03060a55, #03060a88), url("${STOCK_WALLPAPER_URL}")` }} />
      <div className="ot-auth-overlay ot-setup-overlay">
        <div className="ot-setup">
          <LiquidGlassCard onSubmit={submit}>
            <div className="ot-setup-input-row">
              <input
                key={step}
                ref={inputRef}
                type={step === "username" || reveal ? "text" : "password"}
                value={step === "username" ? username : password}
                placeholder={fieldName}
                aria-label={fieldName}
                autoComplete={step === "username" ? "username" : "new-password"}
                autoCapitalize="off"
                maxLength={step === "username" ? 64 : undefined}
                spellCheck={false}
                disabled={busy}
                aria-invalid={!!shownError}
                aria-describedby={shownError ? "setup-error" : undefined}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
                }}
                onChange={(event) => {
                  if (step === "username") setUsername(event.target.value);
                  else setPassword(event.target.value);
                  clear();
                }}
              />
              {step === "password" && <button type="button" disabled={busy} onClick={() => setReveal(!reveal)} aria-label={reveal ? "Hide password" : "Show password"} title={reveal ? "Hide password" : "Show password"}>
                {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>}
              <button type="submit" aria-label={busy ? "Setting up" : submitLabel} title={submitLabel} disabled={busy || (step === "username" ? !username.trim() : !password)}>
                {busy ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowRight size={17} />}
              </button>
            </div>
            {shownError && <div id="setup-error" role="alert" className="ot-auth-error">{shownError}</div>}
          </LiquidGlassCard>
          <div className="ot-setup-actions">
            {step === "password" && <button type="button" disabled={busy} aria-label="Back" title="Back" onClick={() => { clear(); setPassword(""); setReveal(false); setStep("username"); }}><ArrowLeft size={14} /></button>}
            <button type="button" disabled={busy} aria-label="Skip sign-in" title="Skip sign-in" onClick={() => { clear(); void skipSetup(); }}><SkipForward size={14} /></button>
          </div>
        </div>
      </div>
    </>
  );
}
