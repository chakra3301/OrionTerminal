import { useEffect, useRef, useState } from "react";
import { RefreshCw, CheckCircle2, LogIn, LogOut, Download, ImageIcon } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { confirmAction } from "@/components/ConfirmModal";
import { invalidateConnectorSessions } from "@/features/agents/dispatchSend";
import { invalidateCodexImageStatus } from "@/apps/xdesign/imageProviderRuntime";
import { CODEX_SUBSCRIPTION_IMAGE_MODEL } from "@/apps/xdesign/imageGen";

type Engine = "claude" | "codex_cli" | "gemini_cli";
type Status = { installed: boolean; loggedIn: boolean; version: string | null; detail: string; subscriptionReady?: boolean; imageReady?: boolean };

export function CliEngineStatus({ engine }: { engine: Engine }) {
  const [stat, setStat] = useState<Status | null>(null);
  const [scope, setScope] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true);
  const operation = useRef(false);
  const status = (): Promise<Status> => engine === "claude" ? ipc.claudeStatus() : ipc.cliStatus(engine);
  const connected = (s: Status) => engine === "codex_cli" ? s.subscriptionReady === true : s.loggedIn;
  const name = engine === "codex_cli" ? "ChatGPT" : engine === "claude" ? "Claude" : "Google";

  const run = async (work: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(""); setNote("");
    try { await work(); }
    catch (e) { if (alive.current) { setNote(""); setError(e instanceof Error ? e.message : String(e)); } }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const refresh = async () => {
    invalidateCodexImageStatus();
    const [next, location] = await Promise.all([status(), ipc.cliAuthScope(engine)]);
    if (alive.current) { setStat(next); setScope(location.directory); }
    return next;
  };
  useEffect(() => {
    alive.current = true;
    void run(async () => { await refresh(); });
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const login = () => run(async () => {
    const location = await ipc.cliAuthScope(engine);
    if (!alive.current) return;
    setScope(location.directory);
    setNote("Opening login in Terminal… approve the macOS automation prompt if shown.");
    await invalidateConnectorSessions(engine === "claude" ? "anthropic" : engine);
    await ipc.cliLogin(engine);
    if (!alive.current) return;
    setNote("Login window opened · finish signing in, then return here.");
    for (let attempt = 0; attempt < 150; attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      if (!alive.current) return;
      const next = await refresh();
      if (!alive.current) return;
      if (connected(next)) {
        setNote(engine === "codex_cli" ? "Connected · ChatGPT session detected. Model and image access still need a live test." : "Connected · live model access still needs testing.");
        return;
      }
    }
    setNote("Login is still pending. Finish in Terminal, then choose Re-check.");
  });
  const logout = () => run(async () => {
    if (engine === "gemini_cli") return;
    const location = await ipc.cliAuthScope(engine);
    if (!await confirmAction({ title: `Sign out of ${name}?`, body: `Runs the official CLI sign-out command for ${location.directory}. Other tools using that same profile will also be signed out. Chats and provider settings are kept. Stop all AI tasks first.`, confirmLabel: "Sign out", danger: true })) return;
    await ipc.cliLogout(engine);
    if (!alive.current) return;
    setNote("");
    const next = await refresh();
    await invalidateConnectorSessions(engine === "claude" ? "anthropic" : engine);
    if (!alive.current) return;
    if (next.loggedIn || connected(next)) throw new Error("The CLI finished sign-out but still reports a session. Close other clients and Re-check before switching accounts.");
    setNote("Signed out. Connect again to use a different account.");
  });

  const ready = stat ? connected(stat) : false;
  const Icon = !stat ? RefreshCw : !stat.installed ? Download : ready ? CheckCircle2 : LogIn;
  const label = !stat ? "checking" : ready ? "session connected" : stat.installed ? "login needed" : "not found";
  return <div className="cp-cli-status">
    <span className={`cp-badge ${ready ? "live" : "wait"}`}><Icon size={12} /> {label}</span>
    <span className="cp-card-sub">{stat?.detail ?? ""}{stat?.version ? ` · ${stat.version}` : ""}</span>
    {stat?.imageReady && engine === "codex_cli" && <span className="cp-badge live" title="ChatGPT subscription image capability; live access still needs testing"><ImageIcon size={12} /> image · {CODEX_SUBSCRIPTION_IMAGE_MODEL}</span>}
    {stat?.installed && !ready && <button type="button" className="cp-btn" disabled={busy} onClick={() => void login()}><LogIn size={13} /> Connect with {name}</button>}
    {stat?.loggedIn && engine !== "gemini_cli" && <button type="button" className="cp-link-danger" disabled={busy} onClick={() => void logout()}><LogOut size={13} /> Sign out of {name}</button>}
    <button type="button" className="cp-link" disabled={busy} onClick={() => void run(async () => { await refresh(); })}>Re-check</button>
    {scope && <span className="cp-card-sub" title={scope} style={{ flexBasis: "100%", overflowWrap: "anywhere" }}>CLI credential profile: {scope}</span>}
    {engine === "gemini_cli" && <span className="cp-card-sub" style={{ flexBasis: "100%" }}>Google account sign-out: run <code>/auth signout</code> inside Gemini CLI, then Re-check. Disconnect from Orion below keeps that session.</span>}
    {note && <span role="status" className="cp-card-sub" style={{ color: "var(--neon-cyan)" }}>{note}</span>}
    {error && <span role="alert" className="cp-form-error">{error}</span>}
  </div>;
}
