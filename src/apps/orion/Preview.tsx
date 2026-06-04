import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import {
  FileText,
  Globe,
  RefreshCw,
  ExternalLink,
  Pin,
  PinOff,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { usePreviewStore } from "@/store/previewStore";
import { useTabsStore } from "@/store/tabsStore";
import { useWorkspace, activeFilePathInFocused } from "@/components/workspace/workspaceStore";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

const MD_EXT = /\.(md|markdown|mdx)$/i;

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function useActiveMarkdownPath(): string | null {
  const root = useWorkspace((s) => s.root);
  const focused = useWorkspace((s) => s.focusedPanelId);
  const active = activeFilePathInFocused(root, focused);
  return active && MD_EXT.test(active) ? active : null;
}

export function OrionPreview() {
  const mode = usePreviewStore((s) => s.mode);
  const setMode = usePreviewStore((s) => s.setMode);

  return (
    <div className="or-preview">
      <PreviewHeader />
      <div className="or-preview-body">
        {mode === "markdown" ? <MarkdownPreview /> : <WebPreview />}
      </div>
    </div>
  );

  function PreviewHeader() {
    return (
      <div className="or-preview-bar">
        <div className="or-preview-modes">
          <button
            type="button"
            className={`or-preview-mode${mode === "markdown" ? " active" : ""}`}
            onClick={() => setMode("markdown")}
            title="Markdown preview"
          >
            <FileText size={11} /> Markdown
          </button>
          <button
            type="button"
            className={`or-preview-mode${mode === "web" ? " active" : ""}`}
            onClick={() => setMode("web")}
            title="Web preview"
          >
            <Globe size={11} /> Web
          </button>
        </div>
        <div className="or-preview-bar-spacer" />
        {mode === "markdown" ? <MarkdownToolbar /> : <WebToolbar />}
      </div>
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Markdown
// ─────────────────────────────────────────────────────────────

function MarkdownToolbar() {
  const activePath = useActiveMarkdownPath();
  const followActive = usePreviewStore((s) => s.followActive);
  const pinnedPath = usePreviewStore((s) => s.pinnedPath);
  const pinPath = usePreviewStore((s) => s.pinPath);
  const setFollowActive = usePreviewStore((s) => s.setFollowActive);

  const shownPath = followActive ? activePath : pinnedPath;
  const isPinned = !!pinnedPath;

  return (
    <>
      <span className="or-preview-path" title={shownPath ?? ""}>
        {shownPath ? basename(shownPath) : "no markdown file"}
      </span>
      <button
        type="button"
        className="or-preview-icon-btn"
        title={isPinned ? "Unpin (follow active file)" : "Pin this file"}
        onClick={() => {
          if (isPinned) {
            pinPath(null);
            setFollowActive(true);
          } else if (activePath) {
            pinPath(activePath);
          }
        }}
        disabled={!isPinned && !activePath}
      >
        {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
      </button>
    </>
  );
}

function MarkdownPreview() {
  const activePath = useActiveMarkdownPath();
  const followActive = usePreviewStore((s) => s.followActive);
  const pinnedPath = usePreviewStore((s) => s.pinnedPath);
  const shownPath = followActive ? activePath : pinnedPath;

  const buffers = useTabsStore((s) => s.fileBuffers);
  const liveBuffer = shownPath ? buffers[shownPath] : null;

  const [diskContent, setDiskContent] = useState<string | null>(null);
  const [diskError, setDiskError] = useState<string | null>(null);

  // If the file isn't open in an editor tab, read it from disk so the user
  // can still preview it (e.g., a pinned README they haven't opened).
  useEffect(() => {
    let cancelled = false;
    setDiskError(null);
    if (!shownPath || liveBuffer) {
      setDiskContent(null);
      return () => {
        cancelled = true;
      };
    }
    ipc
      .readFile(shownPath)
      .then((text) => {
        if (!cancelled) setDiskContent(text);
      })
      .catch((err) => {
        if (!cancelled) {
          log.warn("preview read failed", err);
          setDiskError(String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shownPath, liveBuffer]);

  const markdown = liveBuffer?.contents ?? diskContent ?? "";

  if (!shownPath) {
    return (
      <div className="or-preview-empty">
        <FileText size={28} />
        <div className="or-preview-empty-title">No markdown file</div>
        <div className="or-preview-empty-hint">
          Open a <span className="kbd">.md</span> file in the editor, or pin one
          here. Switch to <span className="kbd">Web</span> mode for a live
          server preview.
        </div>
      </div>
    );
  }

  if (diskError && !liveBuffer) {
    return (
      <div className="or-preview-empty">
        <div className="or-preview-empty-title">Couldn't read file</div>
        <div className="or-preview-empty-hint mono">{diskError}</div>
      </div>
    );
  }

  return (
    <div className="or-preview-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Web (iframe)
// ─────────────────────────────────────────────────────────────

function WebToolbar() {
  const url = usePreviewStore((s) => s.url);
  const setUrl = usePreviewStore((s) => s.setUrl);
  const reload = usePreviewStore((s) => s.reload);
  const [draft, setDraft] = useState(url);

  useEffect(() => {
    setDraft(url);
  }, [url]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const next = trimmed.match(/^https?:\/\//i) ? trimmed : `http://${trimmed}`;
    setUrl(next);
  };

  return (
    <>
      <input
        type="text"
        className="or-preview-url"
        value={draft}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setDraft(url);
        }}
        onBlur={commit}
        placeholder="localhost:3000"
      />
      <button
        type="button"
        className="or-preview-icon-btn"
        title="Reload"
        onClick={() => reload()}
      >
        <RefreshCw size={11} />
      </button>
      <button
        type="button"
        className="or-preview-icon-btn"
        title="Open in browser"
        onClick={() => {
          openUrl(url).catch((err: unknown) => log.warn("openUrl failed", err));
        }}
      >
        <ExternalLink size={11} />
      </button>
    </>
  );
}

function WebPreview() {
  const url = usePreviewStore((s) => s.url);
  const reloadNonce = usePreviewStore((s) => s.reloadNonce);
  const reload = usePreviewStore((s) => s.reload);
  const ref = useRef<HTMLIFrameElement>(null);
  // Remount on URL change OR on an explicit reload — Zustand's value-equality
  // short-circuits a `setUrl(url)` re-trigger, so we use the bumpable nonce.
  const key = useMemo(() => `${url}#${reloadNonce}`, [url, reloadNonce]);

  // Track whether the iframe actually navigated. `onLoad` fires for any HTTP
  // response (200/404/500 — anything that returns a document), so it's a
  // reliable "the server is at least reachable" signal. If 5s pass with no
  // onLoad, the URL is unreachable (server not running, wrong port, firewall)
  // and we surface that instead of leaving the user staring at a white pane.
  const [phase, setPhase] = useState<"loading" | "loaded" | "unreachable">(
    "loading",
  );
  useEffect(() => {
    setPhase("loading");
    const t = window.setTimeout(() => {
      setPhase((p) => (p === "loading" ? "unreachable" : p));
    }, 5000);
    return () => window.clearTimeout(t);
  }, [url, reloadNonce]);

  if (!url.trim()) {
    return (
      <div className="or-preview-empty">
        <Globe size={28} />
        <div className="or-preview-empty-title">Enter a URL</div>
        <div className="or-preview-empty-hint">
          Type a dev-server address above. Local URLs work
          (<span className="kbd">localhost:3000</span>) — most production sites
          ship <span className="kbd">X-Frame-Options</span> so they won't load
          here.
        </div>
      </div>
    );
  }

  return (
    <div className="or-preview-web">
      <iframe
        key={key}
        ref={ref}
        className="or-preview-iframe"
        src={url}
        title="Web preview"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        onLoad={() => setPhase("loaded")}
      />
      {phase === "unreachable" && (
        <div className="or-preview-unreachable">
          <Globe size={28} />
          <div className="or-preview-empty-title">Couldn&apos;t reach {url}</div>
          <div className="or-preview-empty-hint">
            Is your dev server running on this port? Start it (e.g.{" "}
            <span className="kbd">npm run dev</span>) in a terminal, then hit
            reload. Some sites also send{" "}
            <span className="kbd">X-Frame-Options</span> and refuse to load
            in an iframe.
          </div>
          <button
            type="button"
            className="or-preview-retry"
            onClick={() => reload()}
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      )}
    </div>
  );
}
