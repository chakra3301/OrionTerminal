import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  Suspense,
  lazy,
} from "react";
import type { CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  X,
  KeyRound,
  Sun,
  Keyboard,
  Info,
  Check,
  Trash2,
  Eye,
  EyeOff,
  ExternalLink,
  Image as ImageIcon,
  Plug,
  Plus,
  Users,
  Package,
} from "lucide-react";
const CharacterPicker = lazy(() =>
  import("@/features/characters/CharacterPicker").then((m) => ({
    default: m.CharacterPicker,
  })),
);
import { useSettingsStore } from "@/store/settingsStore";
import { PluginManagerPanel } from "@/features/controlpanel/PluginManagerPanel";
import { useThemeStore, THEMES, isLightTheme } from "@/store/themeStore";
import { ThemeExtrasSection } from "./ThemeExtrasSection";
import { CustomThemeSection } from "./CustomThemeSection";
import { SettingsSlider } from "./SettingsSlider";
import { ThemeSphere } from "./ThemeSphere";
import { OverlayPreview } from "./OverlayPreview";
import { STOCK_WALLPAPER_URL, useWallpaperStore } from "@/store/wallpaperStore";
import { useMcpServers } from "@/store/mcpServersStore";
import { registry, type Command } from "@/commands/registry";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

type Section =
  | "plugins"
  | "key"
  | "theme"
  | "wallpaper"
  | "characters"
  | "mcp"
  | "shortcuts"
  | "about";

const SECTIONS: Array<{
  key: Section;
  label: string;
  Icon: typeof KeyRound;
}> = [
  { key: "plugins", label: "Plugins", Icon: Package },
  { key: "key", label: "API Key", Icon: KeyRound },
  { key: "theme", label: "Appearance", Icon: Sun },
  { key: "wallpaper", label: "Wallpaper", Icon: ImageIcon },
  { key: "characters", label: "Characters", Icon: Users },
  { key: "mcp", label: "MCP Servers", Icon: Plug },
  { key: "shortcuts", label: "Shortcuts", Icon: Keyboard },
  { key: "about", label: "About", Icon: Info },
];

export function SettingsPanel() {
  const open = useSettingsStore((s) => s.open);
  const hide = useSettingsStore((s) => s.hide);
  const [section, setSection] = useState<Section>("key");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  if (!open) return null;

  return (
    <div
      className="ot-settings-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div
        className="ot-settings-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ot-settings-header">
          <span className="ot-settings-title">Settings</span>
          <button type="button" className="icon-btn" onClick={hide}>
            <X size={14} />
          </button>
        </header>
        <div className="ot-settings-body">
          <nav className="ot-settings-nav">
            {SECTIONS.map((s) => {
              const Icon = s.Icon;
              return (
                <button
                  type="button"
                  key={s.key}
                  className={`ot-settings-nav-item${
                    section === s.key ? " active" : ""
                  }`}
                  onClick={() => setSection(s.key)}
                >
                  <Icon size={13} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="ot-settings-section">
            {section === "plugins" && <PluginManagerPanel />}
            {section === "key" && <APIKeySection />}
            {section === "theme" && <ThemeSection />}
            {section === "wallpaper" && <WallpaperSection />}
            {section === "characters" && (
              <Suspense fallback={<div className="ot-settings-p">Loading…</div>}>
                <CharacterPicker />
              </Suspense>
            )}
            {section === "mcp" && <McpSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

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
        Stored in your OS keychain. Used by the inline-edit DiffEditor (⌘K with
        a selection), Tab completion, and direct Messages-API flows. Chats,
        Learn, and FX use the AI selected in Control Panel → Providers or
        their model picker; subscription connectors do not use this key.
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
        . The key never leaves your machine — Tauri's `keyring` v3 plugin uses
        the platform keychain (Keychain Access on macOS).
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

// ─────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────

export function ThemeSection() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.set);
  const reduceGlass = useThemeStore((s) => s.reduceGlass);
  const setReduceGlass = useThemeStore((s) => s.setReduceGlass);

  return (
    <>
      <div className="cp-appearance-intro"><h2 className="ot-settings-h2">Your workspace, your way.</h2>
        <p className="ot-settings-p">Choose a theme, then adjust its surface finish. Your documents and artwork keep their own colors.</p>
      </div>
      {reduceGlass && (isLightTheme(theme) || theme === "liquid") && (
        <div className="ot-settings-glass-notice" role="status">
          <span>Glass is off because Reduce transparency is enabled.</span>
          <button type="button" className="ot-settings-btn" onClick={() => setReduceGlass(false)}>
            Enable glass
          </button>
        </div>
      )}
      <div className="cp-appearance-grid"><section className="cp-theme-section" aria-label="Visual theme">
      <div className="cp-setting-heading"><h3>Theme</h3><span>{THEMES.filter(t => isLightTheme(t.id)).length} light · {THEMES.filter(t => !isLightTheme(t.id)).length} dark</span></div>
      {([true, false] as const).map(light => <div className="ot-theme-group" key={String(light)}>
      <h4 className="ot-theme-group-title">{light ? "Light" : "Dark"}</h4>
      <div className="ot-theme-picker">
        {THEMES.filter(t => isLightTheme(t.id) === light).map((t) => (
          <button
            key={t.id}
            type="button"
            className={`ot-theme-card${theme === t.id ? " active" : ""}`}
            data-theme-swatch={t.id}
            aria-pressed={theme === t.id}
            onClick={() => setTheme(t.id)}
          >
            <ThemeSphere theme={t.id} />
            <span className="ot-theme-meta">
              <span className="ot-theme-name">{t.label}</span>
              <span className="ot-theme-blurb">{t.blurb}</span>
              {t.id === "liquid" && (
                <span className={`ot-theme-hint${reduceGlass ? " warn" : ""}`}>
                  {reduceGlass
                    ? "⚠ Turn off “Reduce transparency” below for the full effect"
                    : "Best with “Reduce transparency” off"}
                </span>
              )}
            </span>
            <span className="ot-theme-selected" aria-hidden="true">
              {theme === t.id && <Check size={14} />}
            </span>
          </button>
        ))}
      </div>
      </div>)}
      <div className="ot-settings-toggle">
        <div className="ot-settings-toggle-meta">
          <div className="ot-settings-toggle-name">Reduce transparency</div>
          <div className="ot-settings-toggle-blurb">
            Turns off light-theme glass and reduces blur. Also lighter on the GPU with several windows open.
          </div>
        </div>
        <button
          type="button"
          className={`ot-switch${reduceGlass ? " on" : ""}`}
          role="switch"
          aria-checked={reduceGlass}
          aria-label="Reduce transparency"
          onClick={() => setReduceGlass(!reduceGlass)}
        />
      </div>
      </section><ThemeExtrasSection /></div>
      <CustomThemeSection />
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Wallpaper
// ─────────────────────────────────────────────────────────────

// Add new overlays here (key must be in OVERLAY_KINDS).
const OVERLAY_OPTIONS: Array<{
  key: "none" | "matrix" | "core";
  label: string;
  hint: string;
}> = [
  { key: "none", label: "Off", hint: "Wallpaper only" },
  { key: "matrix", label: "Matrix", hint: "Katakana rain" },
  { key: "core", label: "Core", hint: "Reactor core" },
];

export function WallpaperSection() {
  const mode = useWallpaperStore((s) => s.mode);
  const customPath = useWallpaperStore((s) => s.customPath);
  const originalName = useWallpaperStore((s) => s.originalName);
  const overlay = useWallpaperStore((s) => s.overlay);
  const overlayIntensity = useWallpaperStore((s) => s.overlayIntensity);
  const matrixHue = useWallpaperStore((s) => s.matrixHue);
  const coreHue = useWallpaperStore((s) => s.coreHue);
  const setCustomFromPath = useWallpaperStore((s) => s.setCustomFromPath);
  const clearCustom = useWallpaperStore((s) => s.clearCustom);
  const setOverlay = useWallpaperStore((s) => s.setOverlay);
  const setOverlayIntensity = useWallpaperStore((s) => s.setOverlayIntensity);
  const setMatrixHue = useWallpaperStore((s) => s.setMatrixHue);
  const setCoreHue = useWallpaperStore((s) => s.setCoreHue);

  const head = `hsl(${matrixHue}, 100%, 92%)`;
  const glow = `hsl(${matrixHue}, 100%, 60%)`;
  const trail = `hsla(${matrixHue}, 100%, 60%, 0.55)`;

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const previewUrl = mode === "custom" && customPath ? convertFileSrc(customPath) : STOCK_WALLPAPER_URL;

  const pick = async () => {
    setMsg(null);
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Image",
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic", "avif", "bmp"],
          },
        ],
      });
      if (!picked || typeof picked !== "string") return;
      setBusy(true);
      await setCustomFromPath(picked);
    } catch (e) {
      log.error("wallpaper pick failed", e);
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await clearCustom();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="ot-settings-h2">Wallpaper</h2>
      <p className="ot-settings-p">
        Keep the stock wallpaper or choose your own image. Animated overlays
        are optional — choose Off for a still desktop.
      </p>

      <div className="ot-wp-preview">
        <img src={previewUrl} alt={mode === "custom" ? originalName ?? "Custom wallpaper" : "Stock wallpaper"} />
      </div>

      <div className="ot-settings-input-row">
        <button
          type="button"
          className="ot-settings-btn primary"
          disabled={busy}
          onClick={() => void pick()}
        >
          <ImageIcon size={12} /> Choose image…
        </button>
        {mode === "custom" && customPath && (
          <button
            type="button"
            className="ot-settings-btn danger"
            disabled={busy}
            onClick={() => void clear()}
          >
            <Trash2 size={12} /> Use default
          </button>
        )}
      </div>

      {originalName && mode === "custom" && (
        <div className="ot-settings-msg mono">{originalName}</div>
      )}

      <div className="ot-wp-overlay-picker">
        <div className="ot-wp-overlay-label">Overlay style</div>
        <div className="ot-wp-overlay-row">
          {OVERLAY_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`ot-wp-overlay-tile${overlay === opt.key ? " active" : ""}`}
              aria-pressed={overlay === opt.key}
              onClick={() => setOverlay(opt.key)}
            >
              <OverlayPreview kind={opt.key} />
              <div className="ot-wp-overlay-name">{opt.label}</div>
              <div className="ot-wp-overlay-hint">{opt.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {overlay === "matrix" && (
      <div className="ot-wp-slider-row">
        <div
          className="ot-wp-color-preview"
          style={{ "--mx-glow": glow } as CSSProperties}
        >
          <span className="swatch" style={{ background: glow }} />
          <span
            className="glyphs"
            style={{ color: head, textShadow: `0 0 8px ${glow}` }}
          >
            ア ナ <span style={{ color: trail, textShadow: "none" }}>ミ</span>{" "}
            タ 0 1 <span style={{ color: trail, textShadow: "none" }}>ワ</span> カ
          </span>
        </div>
        <SettingsSlider label="Matrix color" value={matrixHue} min={0} max={360} step={1} valueText={`${matrixHue}°`} onChange={setMatrixHue}
          gradient="linear-gradient(to right, #fa7272, #edda72, #77e49a, #6fdde7, #8a91ef, #df83de, #fa7272)" />
        <div className="ot-wp-slider-hint">
          Sets the glyph color of the Matrix rain.
        </div>
      </div>
      )}

      {overlay === "core" && (
      <div className="ot-wp-slider-row">
        <div
          className="ot-wp-color-preview"
          style={{ "--mx-glow": `hsl(${coreHue}, 100%, 60%)` } as CSSProperties}
        >
          <span
            className="swatch"
            style={{
              background: `radial-gradient(circle at 50% 50%, hsl(${coreHue},100%,96%) 0%, hsl(${coreHue},100%,55%) 45%, hsl(${(coreHue - 24 + 360) % 360},100%,40%) 100%)`,
            }}
          />
          <span
            className="glyphs"
            style={{
              color: `hsl(${coreHue}, 100%, 60%)`,
              textShadow: `0 0 10px hsl(${coreHue}, 100%, 55%)`,
            }}
          >
            reactor core
          </span>
        </div>
        <SettingsSlider label="Core color" value={coreHue} min={0} max={360} step={1} valueText={`${coreHue}°`} onChange={setCoreHue}
          gradient="linear-gradient(to right, #fa7272, #edda72, #77e49a, #6fdde7, #8a91ef, #df83de, #fa7272)" />
        <div className="ot-wp-slider-hint">
          Sets the energy color of the reactor core.
        </div>
      </div>
      )}

      {overlay !== "none" && <SettingsSlider label="Overlay intensity" value={overlayIntensity}
        valueText={`${Math.round(overlayIntensity * 100)}%`} onChange={setOverlayIntensity} hint="Adjusts the animation over your wallpaper." />}

      {msg && <div className="ot-settings-msg">{msg}</div>}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// MCP servers
// ─────────────────────────────────────────────────────────────

export function McpSection() {
  const servers = useMcpServers((s) => s.servers);
  const loaded = useMcpServers((s) => s.loaded);
  const load = useMcpServers((s) => s.load);
  const toggle = useMcpServers((s) => s.toggle);
  const remove = useMcpServers((s) => s.remove);
  const addStdio = useMcpServers((s) => s.addStdio);
  const addHttp = useMcpServers((s) => s.addHttp);

  const [adding, setAdding] = useState(false);
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");
  const [headerValue, setHeaderValue] = useState("");

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const canSubmit =
    name.trim().length > 0 &&
    (transport === "stdio" ? command.trim().length > 0 : url.trim().length > 0);

  const reset = () => {
    setName("");
    setCommand("");
    setUrl("");
    setHeaderValue("");
    setHeaderName("Authorization");
    setAdding(false);
  };

  const submit = () => {
    if (!canSubmit) return;
    if (transport === "stdio") {
      // Split command line into command + args (naïve whitespace split —
      // fine for the common `npx -y @scope/server` shape).
      const parts = command.trim().split(/\s+/);
      const cmd = parts[0]!;
      const args = parts.slice(1);
      addStdio(name, cmd, args, {});
    } else {
      const headers: Record<string, string> =
        headerName.trim() && headerValue.trim()
          ? { [headerName.trim()]: headerValue.trim() }
          : {};
      addHttp(name, url, headers);
    }
    reset();
  };

  return (
    <>
      <h2 className="ot-settings-h2">MCP servers</h2>
      <p className="ot-settings-p">
        Extra Model Context Protocol servers R.O.S.I.E can call — Linear,
        GitHub, Sentry, anything MCP-compatible. These merge with Orion's
        built-in tools and your globally-configured claude servers, and apply
        across R.O.S.I.E, the per-app rails, and the Claude Code tab. Changes
        take effect on the next R.O.S.I.E turn (a fresh subprocess).
      </p>

      <div className="ot-mcp-list">
        {servers.length === 0 && !adding && (
          <div className="ot-mcp-empty">
            No custom servers yet. Orion's own tools are always available.
          </div>
        )}
        {servers.map((s) => {
          const isHttp = "type" in s.config && s.config.type === "http";
          const detail = isHttp
            ? (s.config as { url: string }).url
            : [
                (s.config as { command: string }).command,
                ...((s.config as { args?: string[] }).args ?? []),
              ].join(" ");
          return (
            <div
              key={s.id}
              className={`ot-mcp-row${s.enabled ? "" : " disabled"}`}
            >
              <button
                type="button"
                className={`ot-mcp-toggle${s.enabled ? " on" : ""}`}
                onClick={() => toggle(s.id)}
                title={s.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
                aria-label="toggle"
              >
                <span className="knob" />
              </button>
              <div className="ot-mcp-meta">
                <div className="name">
                  {s.name}
                  <span className="badge">{isHttp ? "http" : "stdio"}</span>
                </div>
                <div className="detail mono">{detail}</div>
              </div>
              <button
                type="button"
                className="icon-btn-sm danger"
                onClick={() => remove(s.id)}
                title="Remove"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="ot-mcp-form">
          <div className="ot-settings-radio-row">
            <button
              type="button"
              className={`ot-settings-radio${transport === "stdio" ? " active" : ""}`}
              onClick={() => setTransport("stdio")}
            >
              stdio (command)
            </button>
            <button
              type="button"
              className={`ot-settings-radio${transport === "http" ? " active" : ""}`}
              onClick={() => setTransport("http")}
            >
              http (url)
            </button>
          </div>
          <input
            className="ot-mcp-input"
            placeholder="Name (e.g. linear)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
          />
          {transport === "stdio" ? (
            <input
              className="ot-mcp-input mono"
              placeholder="npx -y @modelcontextprotocol/server-…"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          ) : (
            <>
              <input
                className="ot-mcp-input mono"
                placeholder="https://mcp.example.dev/mcp"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
              <div className="ot-mcp-header-row">
                <input
                  className="ot-mcp-input mono"
                  placeholder="Header (optional)"
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  spellCheck={false}
                />
                <input
                  className="ot-mcp-input mono"
                  placeholder="Bearer sk-… (value)"
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                />
              </div>
            </>
          )}
          <div className="ot-settings-input-row">
            <button
              type="button"
              className="ot-settings-btn primary"
              disabled={!canSubmit}
              onClick={submit}
            >
              <Check size={12} /> Add server
            </button>
            <button
              type="button"
              className="ot-settings-btn"
              onClick={reset}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="ot-settings-btn primary"
          onClick={() => setAdding(true)}
        >
          <Plus size={12} /> Add MCP server
        </button>
      )}

      <p className="ot-settings-help">
        Tip: most MCP servers run via <span className="kbd">npx</span> — paste
        the full command. For HTTP servers that need auth, set a header (e.g.
        <span className="kbd">Authorization</span> → <span className="kbd">Bearer …</span>).
      </p>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Shortcuts
// ─────────────────────────────────────────────────────────────

function useCommandsSnapshot(): Command[] {
  return useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.list(),
    () => registry.list(),
  );
}

export function ShortcutsSection() {
  const commands = useCommandsSnapshot();
  const grouped = useMemo(() => {
    const bound = commands.filter((c) => !!c.hotkey);
    const m = new Map<string, Command[]>();
    for (const c of bound) {
      const key = c.group ?? "Other";
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [commands]);

  return (
    <>
      <h2 className="ot-settings-h2">Keyboard shortcuts</h2>
      <p className="ot-settings-p">
        Generated live from the command registry. Read-only for now — rebinding
        UI lands later. Press <span className="kbd">⌘K</span> for full
        Spotlight.
      </p>
      <div className="ot-settings-shortcuts">
        {grouped.map(([group, cmds]) => (
          <div key={group} className="ot-settings-shortcut-group">
            <div className="group-label">{group}</div>
            {cmds.map((c) => (
              <div className="row" key={c.id}>
                <span className="label">{c.label}</span>
                <span className="hk">{formatHotkey(c.hotkey ?? "")}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function formatHotkey(hk: string): string {
  if (!hk) return "";
  const isMac = /Mac|iP/.test(navigator.platform);
  return hk
    .split("+")
    .map((p) => {
      const k = p.toLowerCase();
      if (k === "mod") return isMac ? "⌘" : "Ctrl";
      if (k === "shift") return isMac ? "⇧" : "Shift";
      if (k === "alt") return isMac ? "⌥" : "Alt";
      if (k === "ctrl") return isMac ? "⌃" : "Ctrl";
      if (k === "meta") return isMac ? "⌘" : "Win";
      if (k === "left") return "←";
      if (k === "right") return "→";
      if (k === "up") return "↑";
      if (k === "down") return "↓";
      return k.length === 1 ? k.toUpperCase() : k;
    })
    .join(isMac ? "" : "+");
}

// ─────────────────────────────────────────────────────────────
// About
// ─────────────────────────────────────────────────────────────

export function AboutSection() {
  return (
    <>
      <h2 className="ot-settings-h2">About</h2>
      <p className="ot-settings-p">
        Orion Terminal — personal workstation. Tauri 2 + React 19 + Vite +
        SQLite. Three apps share one shell: Orion (code), Archives 47
        (knowledge), XDesign (design).
      </p>
      <dl className="ot-settings-meta">
        <dt>Bundle</dt>
        <dd>com.lucaorion.orion-terminal</dd>
        <dt>Data dir</dt>
        <dd className="mono">~/Library/Application Support/com.lucaorion.orion-terminal/</dd>
        <dt>Assets dir</dt>
        <dd className="mono">↳ /assets/</dd>
        <dt>DB</dt>
        <dd className="mono">↳ /orion.db</dd>
      </dl>
      <p className="ot-settings-help">
        Stack is locked per the master brief: Tauri 2, React 19, Monaco,
        BlockNote, xterm.js, Zustand. Migrations are append-only — never edit
        a prior one.
      </p>
      <p className="ot-settings-help">
        Website Ripper scaffold © JCodesMore (MIT) —
        github.com/JCodesMore/ai-website-cloner-template
      </p>
    </>
  );
}
