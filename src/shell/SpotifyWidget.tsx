import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Music,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSpotify } from "@/store/spotifyStore";

const REDIRECT_URI = "http://127.0.0.1:8765/callback";
const DASHBOARD = "https://developer.spotify.com/dashboard";

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Menubar Spotify widget driven by the Spotify Web API (OAuth). Always shows
 * when loaded — a "Connect Spotify" pill until linked, then now-playing with
 * transport controls. */
export function SpotifyWidget() {
  const now = useSpotify((s) => s.now);
  const loaded = useSpotify((s) => s.loaded);
  const linked = useSpotify((s) => s.connected);
  const poll = useSpotify((s) => s.poll);
  const refreshStatus = useSpotify((s) => s.refreshStatus);
  const control = useSpotify((s) => s.control);
  const seek = useSpotify((s) => s.seek);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Local playhead that advances between polls so the scrubber moves smoothly.
  const [, setTick] = useState(0);
  const polledAt = useRef(Date.now());
  const basePos = useRef(0);

  useEffect(() => {
    void refreshStatus();
    void poll();
    const id = setInterval(() => void poll(), 2500);
    return () => clearInterval(id);
  }, [poll, refreshStatus]);

  const playing = now?.is_playing ?? false;

  useEffect(() => {
    polledAt.current = Date.now();
    basePos.current = now?.position_s ?? 0;
  }, [now?.position_s, now?.track]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!loaded) return null;

  const connected = linked && !(now?.needs_reauth ?? false);
  const active = now?.active ?? false;
  const hasTrack = connected && active && !!now?.track;

  const durationS = (now?.duration_ms ?? 0) / 1000;
  const elapsed = playing ? (Date.now() - polledAt.current) / 1000 : 0;
  const pos = Math.min(basePos.current + elapsed, durationS || basePos.current);
  const pct = durationS ? Math.max(0, Math.min(100, (pos / durationS) * 100)) : 0;

  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!durationS) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    void seek(ratio * durationS);
  };

  const pillLabel = !connected
    ? "Connect Spotify"
    : hasTrack
      ? now!.track
      : "Spotify";

  return (
    <div className="ot-spotify" ref={ref}>
      <button
        type="button"
        className={`ot-spotify-pill${connected ? "" : " is-disconnected"}`}
        title={hasTrack ? `${now!.track} — ${now!.artist}` : pillLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {hasTrack && now!.artwork_url ? (
          <img className="ot-spotify-thumb" src={now!.artwork_url} alt="" />
        ) : (
          <Music size={12} color="var(--neon-green)" />
        )}
        <span className="ot-spotify-pill-text">{pillLabel}</span>
        {hasTrack && playing && (
          <span className="ot-spotify-eq" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        )}
      </button>

      {open && (
        <div className="ot-spotify-panel" role="dialog" aria-label="Spotify">
          {!connected ? (
            <SpotifyConnect onDone={() => poll()} />
          ) : hasTrack ? (
            <>
              {now!.artwork_url && (
                <img className="ot-spotify-art" src={now!.artwork_url} alt="" />
              )}
              <div className="ot-spotify-meta">
                <div className="ot-spotify-title">{now!.track}</div>
                <div className="ot-spotify-artist">{now!.artist}</div>
                {now!.album && (
                  <div className="ot-spotify-album">{now!.album}</div>
                )}
              </div>

              <div className="ot-spotify-scrub" onClick={onScrub}>
                <div
                  className="ot-spotify-scrub-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="ot-spotify-times">
                <span>{fmt(pos)}</span>
                <span>{fmt(durationS)}</span>
              </div>

              <div className="ot-spotify-controls">
                <button
                  type="button"
                  title="Previous"
                  onClick={() => void control("previous")}
                >
                  <SkipBack size={16} />
                </button>
                <button
                  type="button"
                  className="ot-spotify-play"
                  title={playing ? "Pause" : "Play"}
                  onClick={() => void control("playpause")}
                >
                  {playing ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button
                  type="button"
                  title="Next"
                  onClick={() => void control("next")}
                >
                  <SkipForward size={16} />
                </button>
              </div>
              <SpotifyFooter />
            </>
          ) : (
            <>
              <div className="ot-spotify-idle">
                Nothing playing. Start a track on any Spotify device — phone,
                desktop, or the web player — and it&rsquo;ll show here.
              </div>
              <SpotifyFooter />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SpotifyFooter() {
  const disconnect = useSpotify((s) => s.disconnect);
  return (
    <div className="ot-spotify-foot">
      <button type="button" onClick={() => void disconnect()}>
        Disconnect
      </button>
    </div>
  );
}

function SpotifyConnect({ onDone }: { onDone: () => void }) {
  const connect = useSpotify((s) => s.connect);
  const connecting = useSpotify((s) => s.connecting);
  const error = useSpotify((s) => s.error);
  const [clientId, setClientId] = useState("");

  const go = async () => {
    const ok = await connect(clientId.trim());
    if (ok) onDone();
  };

  return (
    <div className="ot-spotify-connect">
      <div className="ot-spotify-title">Link Spotify</div>
      <ol className="ot-spotify-steps">
        <li>
          Create a free app in the{" "}
          <button
            type="button"
            className="ot-spotify-link"
            onClick={() => void openUrl(DASHBOARD)}
          >
            Spotify Dashboard <ExternalLink size={10} />
          </button>
        </li>
        <li>
          Add this exact <b>Redirect URI</b>:
          <code className="ot-spotify-uri">{REDIRECT_URI}</code>
        </li>
        <li>Copy the app&rsquo;s Client ID and paste it below.</li>
      </ol>
      <input
        className="ot-spotify-input"
        placeholder="Spotify Client ID"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void go();
        }}
      />
      <button
        type="button"
        className="ot-spotify-connect-btn"
        disabled={!clientId.trim() || connecting}
        onClick={() => void go()}
      >
        {connecting ? (
          <>
            <Loader2 size={13} className="ot-spin" /> Waiting for approval…
          </>
        ) : (
          "Connect with Spotify"
        )}
      </button>
      {error && <div className="ot-spotify-err">{error}</div>}
    </div>
  );
}
